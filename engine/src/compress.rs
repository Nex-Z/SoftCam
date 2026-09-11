use crate::media;
use anyhow::Result;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

pub fn transcode(
    input: &str,
    output: &str,
    codec: &str,
    quality: &str,
    range: Option<(f64, f64)>,
    cancel: Arc<AtomicBool>,
) -> Result<()> {
    media::safe_output(output, Some(input))?;
    let mut cmd = media::command();
    cmd.args(["-v", "error", "-n"]);
    if let Some((seek, _)) = range {
        cmd.args(["-ss", &seek.to_string()]);
    }
    cmd.args(["-i", input]);
    if let Some((_, duration)) = range {
        cmd.args(["-t", &duration.to_string()]);
    }
    cmd.args([
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    ])
    .args(media::encoding_args(&media::encoder(codec)?, quality));
    cmd.args([
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
        output,
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let err_thread = std::thread::spawn(move || {
        use std::io::Read;
        let mut s = String::new();
        let _ = BufReader::new(stderr).take(65536).read_to_string(&mut s);
        s
    });
    let progress = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(v) = line.strip_prefix("out_time_us=") {
                if let Ok(us) = v.parse::<f64>() {
                    crate::emit("compressionProgress", json!({"seconds":us/1e6}));
                }
            }
        }
    });
    let status = loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            break child.wait()?;
        }
        if let Some(s) = child.try_wait()? {
            break s;
        }
        std::thread::sleep(Duration::from_millis(60));
    };
    let _ = progress.join();
    let errors = err_thread.join().unwrap_or_default();
    if !status.success() || cancel.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(output);
        anyhow::bail!(
            "{}",
            if cancel.load(Ordering::SeqCst) {
                "已取消".to_string()
            } else {
                errors
            }
        );
    }
    Ok(())
}
pub fn estimate(p: &Value, cancel: Arc<AtomicBool>) -> Result<Value> {
    let input = p["input"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("缺少输入文件"))?;
    let dir = p["tempDir"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("缺少预览目录"))?;
    std::fs::create_dir_all(dir)?;
    let info = media::probe(input)?;
    let duration = info["duration"].as_f64().unwrap();
    let length = duration.min(3.0);
    let mut total_bytes = 0u64;
    let mut paths = vec![];
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_nanos();
    for (index, fraction) in [0.1, 0.5, 0.85].iter().enumerate() {
        let path = std::path::Path::new(dir).join(format!("preview-{stamp}-{index}.mp4"));
        let path = path.to_string_lossy().into_owned();
        let result = transcode(
            input,
            &path,
            p["codec"].as_str().unwrap_or("h264"),
            p["quality"].as_str().unwrap_or("balanced"),
            Some(((duration - length) * fraction, length)),
            cancel.clone(),
        );
        if let Err(e) = result {
            for p in &paths {
                let _ = std::fs::remove_file(p);
            }
            return Err(e);
        }
        total_bytes += std::fs::metadata(&path)?.len();
        paths.push(path);
    }
    let size = (total_bytes as f64 / (length * 3.0) * duration) as u64;
    Ok(
        json!({"estimatedSize":size,"saving":1.0-size as f64/info["size"].as_f64().unwrap_or(1.0),"previews":paths,"sampleSeconds":length*3.0}),
    )
}
