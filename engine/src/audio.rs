use crate::model::Timeline;
use anyhow::Result;
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    thread,
    time::Duration,
};
use wasapi::*;

pub struct Packet {
    start: i64,
    data: Vec<f32>,
}
pub type Samples = Arc<Mutex<VecDeque<Packet>>>;
pub struct AudioStream {
    pub samples: Samples,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Drop for AudioStream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}
fn qpc_seconds() -> f64 {
    use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
    static FREQ: OnceLock<i64> = OnceLock::new();
    let freq = FREQ.get_or_init(|| {
        let mut f = 0;
        unsafe {
            let _ = QueryPerformanceFrequency(&mut f);
        }
        f
    });
    let mut now = 0;
    unsafe {
        let _ = QueryPerformanceCounter(&mut now);
    }
    now as f64 / *freq as f64
}
pub fn devices() -> Result<serde_json::Value> {
    initialize_mta().ok()?;
    let e = DeviceEnumerator::new()?;
    let collection = e.get_device_collection(&Direction::Capture)?;
    let mut result = vec![];
    for d in &collection {
        if let Ok(d) = d {
            result.push(serde_json::json!({"id":d.get_id()?,"title":d.get_friendlyname()?}));
        }
    }
    Ok(serde_json::json!(result))
}
pub fn start(
    kind: String,
    pid: Option<u32>,
    device: Option<String>,
    clock: Arc<Mutex<Timeline>>,
) -> Result<AudioStream> {
    let samples: Samples = Arc::new(Mutex::new(VecDeque::new()));
    let stop = Arc::new(AtomicBool::new(false));
    let out = samples.clone();
    let stopped = stop.clone();
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let worker = thread::spawn(move || {
        let run = || -> Result<()> {
            initialize_mta().ok()?;
            let mut client = if kind == "application" {
                AudioClient::new_application_loopback_client(pid.unwrap(), true)?
            } else {
                let e = DeviceEnumerator::new()?;
                let d = if let Some(id) = device.filter(|id| id != "default") {
                    e.get_device(&id)?
                } else {
                    e.get_default_device(&if kind == "microphone" {
                        Direction::Capture
                    } else {
                        Direction::Render
                    })?
                };
                d.get_iaudioclient()?
            };
            let format = WaveFormat::new(32, 32, &SampleType::Float, 48000, 2, None);
            client.initialize_client(
                &format,
                &Direction::Capture,
                &StreamMode::EventsShared {
                    autoconvert: true,
                    buffer_duration_hns: 0,
                },
            )?;
            let event = client.set_get_eventhandle()?;
            let capture = client.get_audiocaptureclient()?;
            client.start_stream()?;
            let _ = ready_tx.send(Ok(()));
            while !stopped.load(Ordering::SeqCst) {
                while let Some(frames) = capture.get_next_packet_size()?.filter(|n| *n > 0) {
                    let mut raw = vec![0u8; frames as usize * 8];
                    let (frames, info) = capture.read_from_device(&mut raw)?;
                    let now = qpc_seconds();
                    let c = clock.lock().unwrap();
                    let elapsed = c.elapsed().as_secs_f64();
                    let paused = c.paused();
                    drop(c);
                    let mut q = out.lock().unwrap();
                    if paused {
                        // Retain already timestamped packets so the mixer can drain
                        // the last 100 ms before the pause boundary.
                        continue;
                    }
                    // Place packets on the recording clock using WASAPI's QPC timestamps.
                    let age = if info.timestamp > 0 && !info.flags.timestamp_error {
                        (now - info.timestamp as f64 / 1e7).max(0.0)
                    } else {
                        frames as f64 / 48000.0
                    };
                    let start = ((elapsed - age) * 48000.0).round() as i64;
                    let data = raw[..frames as usize * 8]
                        .chunks_exact(4)
                        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
                        .collect();
                    q.push_back(Packet { start, data });
                    while q.len() > 64 {
                        q.pop_front();
                    }
                }
                let _ = event.wait_for_event(20);
            }
            client.stop_stream()?;
            Ok(())
        };
        if let Err(e) = run() {
            let _ = ready_tx.send(Err(e.to_string()));
            crate::emit(
                "warning",
                serde_json::json!({"message":format!("音频捕获结束：{e}")}),
            );
        }
    });
    match ready_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(())) => Ok(AudioStream {
            samples,
            stop,
            worker: Some(worker),
        }),
        other => {
            stop.store(true, Ordering::SeqCst);
            Err(anyhow::anyhow!("无法启动音频：{other:?}"))
        }
    }
}
pub fn mix(streams: &[Samples], start: u64, frames: usize) -> Vec<u8> {
    let start = start as i64;
    let end = start + frames as i64;
    let mut mixed = vec![0f32; frames * 2];
    for stream in streams {
        let mut q = stream.lock().unwrap();
        while q
            .front()
            .is_some_and(|p| p.start + (p.data.len() / 2) as i64 <= start)
        {
            q.pop_front();
        }
        for packet in q.iter() {
            let a = start.max(packet.start);
            let b = end.min(packet.start + (packet.data.len() / 2) as i64);
            if b <= a {
                continue;
            }
            for frame in a..b {
                for channel in 0..2 {
                    mixed[(frame - start) as usize * 2 + channel] +=
                        packet.data[(frame - packet.start) as usize * 2 + channel];
                }
            }
        }
    }
    mixed
        .into_iter()
        .flat_map(|s| s.clamp(-1.0, 1.0).to_le_bytes())
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timestamp_mix_clips_and_fills_gaps() {
        let a = Arc::new(Mutex::new(VecDeque::from([Packet {
            start: 1,
            data: vec![0.8, 0.8],
        }])));
        let b = Arc::new(Mutex::new(VecDeque::from([Packet {
            start: 1,
            data: vec![0.8, 0.8],
        }])));
        let bytes = mix(&[a, b], 0, 3);
        let f: Vec<_> = bytes
            .chunks_exact(4)
            .map(|v| f32::from_le_bytes(v.try_into().unwrap()))
            .collect();
        assert_eq!(f, vec![0.0, 0.0, 1.0, 1.0, 0.0, 0.0]);
    }
    #[test]
    fn stale_packets_are_removed() {
        let q = Arc::new(Mutex::new(VecDeque::from([Packet {
            start: 0,
            data: vec![1.0; 20],
        }])));
        let _ = mix(&[q.clone()], 100, 10);
        assert!(q.lock().unwrap().is_empty());
    }
}
