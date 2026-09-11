use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Clone, Deserialize, Serialize, Debug)]
pub struct Crop {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}
impl Crop {
    pub fn validate(&self, w: u32, h: u32) -> anyhow::Result<()> {
        anyhow::ensure!(self.width >= 2 && self.height >= 2, "区域至少为 2 × 2 像素");
        anyhow::ensure!(
            self.x.checked_add(self.width).is_some_and(|v| v <= w)
                && self.y.checked_add(self.height).is_some_and(|v| v <= h),
            "区域超出显示器范围"
        );
        Ok(())
    }
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Source {
    pub kind: String,
    pub id: isize,
    #[serde(default)]
    pub crop: Option<Crop>,
}
#[derive(Clone, Deserialize)]
pub struct RecordConfig {
    pub source: Source,
    pub output: String,
    pub fps: u32,
    pub codec: String,
    pub quality: String,
    pub audio: String,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(default)]
    pub microphone: Option<String>,
    #[serde(default = "yes")]
    pub cursor: bool,
}
fn yes() -> bool {
    true
}
impl RecordConfig {
    pub fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!([30, 60].contains(&self.fps), "帧率必须为 30 或 60");
        anyhow::ensure!(
            ["none", "system", "application"].contains(&self.audio.as_str()),
            "无效音频来源"
        );
        anyhow::ensure!(
            self.audio != "application" || self.pid.is_some_and(|p| p > 0),
            "请选择音频应用"
        );
        anyhow::ensure!(
            ["h264", "hevc", "av1"].contains(&self.codec.as_str()),
            "无效编码"
        );
        Ok(())
    }
}
pub struct Timeline {
    start: Instant,
    paused_at: Option<Instant>,
    excluded: Duration,
}
impl Timeline {
    pub fn new() -> Self {
        Self {
            start: Instant::now(),
            paused_at: None,
            excluded: Duration::ZERO,
        }
    }
    pub fn paused(&self) -> bool {
        self.paused_at.is_some()
    }
    pub fn pause(&mut self) {
        if self.paused_at.is_none() {
            self.paused_at = Some(Instant::now());
        }
    }
    pub fn resume(&mut self) {
        if let Some(p) = self.paused_at.take() {
            self.excluded += p.elapsed();
        }
    }
    pub fn elapsed(&self) -> Duration {
        self.paused_at
            .unwrap_or_else(Instant::now)
            .duration_since(self.start)
            .saturating_sub(self.excluded)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crop_rejects_overflow() {
        assert!(Crop {
            x: u32::MAX,
            y: 0,
            width: 20,
            height: 20
        }
        .validate(1920, 1080)
        .is_err());
    }
    #[test]
    fn crop_accepts_edge() {
        assert!(Crop {
            x: 100,
            y: 100,
            width: 1820,
            height: 980
        }
        .validate(1920, 1080)
        .is_ok());
    }
    #[test]
    fn pause_is_idempotent() {
        let mut t = Timeline::new();
        t.pause();
        let d = t.elapsed();
        std::thread::sleep(Duration::from_millis(15));
        t.pause();
        assert_eq!(d, t.elapsed());
        t.resume();
        assert!(!t.paused());
        assert!(t.elapsed() < Duration::from_millis(10));
    }
    #[test]
    fn invalid_audio_rejected() {
        let v = serde_json::json!({"source":{"kind":"monitor","id":1},"output":"x.mp4","fps":30,"codec":"h264","quality":"balanced","audio":"system+application"});
        assert!(serde_json::from_value::<RecordConfig>(v)
            .unwrap()
            .validate()
            .is_err());
    }
}
