use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::{
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::OnceLock,
};

pub fn command() -> Command {
    let mut c =
        Command::new(std::env::var_os("SOFTCAM_FFMPEG").unwrap_or_else(|| "ffmpeg.exe".into()));
    c.creation_flags(0x08000000);
    c
}
pub fn probe(path: &str) -> Result<Value> {
    let mut c =
        Command::new(std::env::var_os("SOFTCAM_FFPROBE").unwrap_or_else(|| "ffprobe.exe".into()));
    c.creation_flags(0x08000000);
    let o = c
        .args([
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            path,
        ])
        .output()?;
    anyhow::ensure!(
        o.status.success(),
        "无法读取视频：{}",
        String::from_utf8_lossy(&o.stderr)
    );
    let v: Value = serde_json::from_slice(&o.stdout)?;
    let video = v["streams"]
        .as_array()
        .context("没有视频流")?
        .iter()
        .find(|s| s["codec_type"] == "video")
        .context("没有视频流")?;
    let duration = v["format"]["duration"]
        .as_str()
        .unwrap_or("0")
        .parse::<f64>()?;
    anyhow::ensure!(duration > 0.0, "视频时长无效");
    Ok(
        json!({"path":path,"duration":duration,"size":std::fs::metadata(path)?.len(),"width":video["width"],"height":video["height"],"fps":video["avg_frame_rate"],"codec":video["codec_name"]}),
    )
}
static ENCODERS: OnceLock<Vec<(String, String)>> = OnceLock::new();
pub fn encoders() -> &'static Vec<(String, String)> {
    ENCODERS.get_or_init(|| {
        let mut ok = vec![];
        for (codec, candidates) in [
            (
                "h264",
                vec!["h264_nvenc", "h264_qsv", "h264_amf", "libx264"],
            ),
            ("hevc", vec!["hevc_nvenc", "hevc_qsv", "hevc_amf"]),
            ("av1", vec!["av1_nvenc", "av1_qsv", "av1_amf"]),
        ] {
            for encoder in candidates {
                let result = command()
                    .args([
                        "-v",
                        "error",
                        "-f",
                        "lavfi",
                        "-i",
                        "color=c=black:s=1920x1080:r=30",
                        "-frames:v",
                        "2",
                        "-pix_fmt",
                        "yuv420p",
                        "-c:v",
                        encoder,
                        "-f",
                        "null",
                        "-",
                    ])
                    .stdin(Stdio::null())
                    .output();
                if result.is_ok_and(|o| o.status.success()) {
                    ok.push((codec.into(), encoder.into()));
                    break;
                }
            }
        }
        ok
    })
}
pub fn encoder(codec: &str) -> Result<String> {
    encoders()
        .iter()
        .find(|(c, _)| c == codec)
        .map(|(_, e)| e.clone())
        .context("该编码器不可用")
}
pub fn recording_encoder(
    codec: &str,
    quality: &str,
    width: u32,
    height: u32,
    fps: u32,
) -> Result<String> {
    let preferred = encoder(codec)?;
    let check = |name: &str| {
        command()
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                &format!("color=c=black:s={width}x{height}:r={fps}"),
                "-frames:v",
                "2",
            ])
            .args(encoding_args(name, quality))
            .args(["-f", "null", "-"])
            .output()
            .is_ok_and(|o| o.status.success())
    };
    if check(&preferred) {
        return Ok(preferred);
    }
    if codec == "h264" && preferred != "libx264" && check("libx264") {
        crate::emit(
            "warning",
            json!({"message":"当前录制参数无法使用硬件编码，已切换到软件编码"}),
        );
        return Ok("libx264".into());
    }
    anyhow::bail!("编码器无法处理当前分辨率，请改用 H.264 或调整录制区域")
}
pub fn encoding_args(encoder: &str, quality: &str) -> Vec<String> {
    let q = match quality {
        "high" => "20",
        "small" => "32",
        _ => "26",
    };
    let mut args = vec!["-c:v", encoder, "-pix_fmt", "yuv420p"];
    if encoder.ends_with("nvenc") {
        args.extend(["-preset", "p4", "-rc", "vbr", "-cq", q, "-b:v", "0"])
    } else if encoder == "libx264" {
        args.extend(["-preset", "veryfast", "-crf", q])
    } else if encoder.ends_with("qsv") {
        args.extend(["-global_quality", q])
    } else {
        args.extend(["-rc", "cqp", "-qp_i", q, "-qp_p", q])
    }
    args.into_iter().map(str::to_string).collect()
}
pub fn safe_output(output: &str, input: Option<&str>) -> Result<PathBuf> {
    let p = PathBuf::from(output);
    anyhow::ensure!(p.is_absolute(), "输出路径必须是绝对路径");
    anyhow::ensure!(!p.exists(), "目标文件已存在，请另选文件名");
    if let Some(input) = input {
        anyhow::ensure!(!output.eq_ignore_ascii_case(input), "不能覆盖源文件");
    }
    std::fs::create_dir_all(p.parent().context("无效输出目录")?)?;
    Ok(p)
}
pub fn remux(temp: &Path, output: &Path) -> Result<()> {
    let result = command()
        .args(["-v", "error", "-n", "-i"])
        .arg(temp)
        .args(["-map", "0", "-c", "copy", "-movflags", "+faststart"])
        .arg(output)
        .output()?;
    anyhow::ensure!(
        result.status.success(),
        "封装失败，临时文件已保留：{}",
        String::from_utf8_lossy(&result.stderr)
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_relative() {
        assert!(safe_output("x.mp4", None).is_err());
    }
    #[test]
    fn keeps_source() {
        assert!(safe_output("C:\\record.mp4", Some("c:\\RECORD.mp4")).is_err());
    }
}
