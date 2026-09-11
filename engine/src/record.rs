use crate::{
    audio, capture, media,
    model::{RecordConfig, Timeline},
};
use anyhow::Result;
use serde_json::json;
use std::{
    io::Write,
    net::TcpListener,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

pub struct Recording {
    pub clock: Arc<Mutex<Timeline>>,
    pub done: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<Result<String>>>,
}
impl Recording {
    pub fn pause(&self) -> Result<()> {
        anyhow::ensure!(!self.done.load(Ordering::SeqCst), "录制已经结束");
        self.clock.lock().unwrap().pause();
        crate::emit("recording", json!({"state":"paused"}));
        Ok(())
    }
    pub fn resume(&self) -> Result<()> {
        anyhow::ensure!(!self.done.load(Ordering::SeqCst), "录制已经结束");
        self.clock.lock().unwrap().resume();
        crate::emit("recording", json!({"state":"recording"}));
        Ok(())
    }
    pub fn stop(mut self) -> Result<String> {
        self.stop.store(true, Ordering::SeqCst);
        self.worker
            .take()
            .unwrap()
            .join()
            .map_err(|_| anyhow::anyhow!("录制线程异常"))?
    }
}
pub fn start(config: RecordConfig) -> Result<Recording> {
    config.validate()?;
    let output = media::safe_output(&config.output, None)?;
    let temp = output.with_extension("recording.mkv");
    anyhow::ensure!(!temp.exists(), "存在待恢复的录制文件，请换一个文件名");
    let session = capture::start(&config.source, config.cursor, config.fps)?;
    let first = session.shared.latest.lock().unwrap().clone().unwrap();
    let first = capture::crop_pixels(&first, &config.source)?;
    let (width, height) = (first.width / 2 * 2, first.height / 2 * 2);
    let encoder =
        media::recording_encoder(&config.codec, &config.quality, width, height, config.fps)?;
    let clock = Arc::new(Mutex::new(Timeline::new()));
    clock.lock().unwrap().pause();
    let mut audio_streams = vec![];
    if config.audio != "none" {
        audio_streams.push(audio::start(
            config.audio.clone(),
            config.pid,
            None,
            clock.clone(),
        )?);
    }
    if let Some(mic) = config.microphone.clone() {
        audio_streams.push(audio::start(
            "microphone".into(),
            None,
            Some(mic),
            clock.clone(),
        )?);
    }
    let listener = if audio_streams.is_empty() {
        None
    } else {
        Some(TcpListener::bind("127.0.0.1:0")?)
    };
    let mut cmd = media::command();
    cmd.args([
        "-v",
        "warning",
        "-n",
        "-thread_queue_size",
        "4",
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgba",
        "-video_size",
        &format!("{}x{}", first.width, first.height),
        "-framerate",
        &config.fps.to_string(),
        "-i",
        "pipe:0",
    ]);
    if let Some(l) = &listener {
        cmd.args([
            "-thread_queue_size",
            "16",
            "-probesize",
            "32",
            "-analyzeduration",
            "0",
            "-f",
            "f32le",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-i",
            &format!("tcp://{}", l.local_addr()?),
        ]);
    }
    cmd.args([
        "-vf",
        &format!("scale={width}:{height}:flags=fast_bilinear"),
    ])
    .args(media::encoding_args(&encoder, &config.quality));
    if listener.is_some() {
        cmd.args(["-c:a", "aac", "-b:a", "160k"]);
    }
    cmd.arg(&temp).stdin(Stdio::piped()).stdout(Stdio::null());
    let log = std::fs::File::create(output.with_extension("recording.log"))?;
    cmd.stderr(log);
    let mut child = cmd.spawn()?;
    let mut input = child.stdin.take().unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let done = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread_done = done.clone();
    let timeline = clock.clone();
    let worker = thread::spawn(move || {
        let run = || -> Result<String> {
            let sample_queues = audio_streams
                .iter()
                .map(|s| s.samples.clone())
                .collect::<Vec<_>>();
            let audio_stop = thread_stop.clone();
            let audio_clock = timeline.clone();
            let audio_worker = listener.map(|l| {
                thread::spawn(move || -> Result<()> {
                    l.set_nonblocking(true)?;
                    let (mut socket, _) = loop {
                        match l.accept() {
                            Ok(s) => break s,
                            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                if audio_stop.load(Ordering::SeqCst) {
                                    return Ok(());
                                }
                                thread::sleep(Duration::from_millis(5));
                            }
                            Err(e) => return Err(e.into()),
                        }
                    };
                    socket.set_write_timeout(Some(Duration::from_secs(3)))?;
                    let mut sent = 0u64;
                    loop {
                        let (paused, elapsed) = {
                            let c = audio_clock.lock().unwrap();
                            (c.paused(), c.elapsed())
                        };
                        let target = (elapsed.as_secs_f64() * 48000.0) as u64;
                        let stopped = audio_stop.load(Ordering::SeqCst);
                        let lead = if stopped || paused { 0 } else { 4800 };
                        if sent + 480 + lead <= target {
                            socket.write_all(&audio::mix(&sample_queues, sent, 480))?;
                            sent += 480;
                        } else if stopped {
                            break;
                        } else {
                            thread::sleep(Duration::from_millis(2));
                        }
                    }
                    Ok(())
                })
            });
            timeline.lock().unwrap().resume();
            crate::emit(
                "recording",
                json!({"state":"recording","encoder":encoder,"path":output}),
            );
            let mut sent = 0u64;
            let mut last_status = Instant::now();
            let mut auto_paused = false;
            let write_result = (|| -> Result<()> {
                while !thread_stop.load(Ordering::SeqCst) {
                    if session.shared.closed.load(Ordering::SeqCst) {
                        crate::emit("warning", json!({"message":"录制来源已关闭，正在保存"}));
                        break;
                    }
                    if last_status.elapsed() > Duration::from_millis(400) {
                        if config.source.kind == "window" {
                            use windows::Win32::{
                                Foundation::HWND,
                                UI::WindowsAndMessaging::{IsIconic, IsWindow},
                            };
                            let hwnd = HWND(config.source.id as *mut _);
                            if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
                                break;
                            }
                            if unsafe { IsIconic(hwnd) }.as_bool()
                                && !timeline.lock().unwrap().paused()
                            {
                                timeline.lock().unwrap().pause();
                                auto_paused = true;
                                crate::emit(
                                    "recording",
                                    json!({"state":"paused","reason":"窗口已最小化，恢复窗口后点击继续"}),
                                );
                            }
                        } else {
                            let exists = windows_capture::monitor::Monitor::enumerate()?
                                .iter()
                                .any(|m| m.as_raw_hmonitor() as isize == config.source.id);
                            if !exists {
                                break;
                            }
                        }
                        let c = timeline.lock().unwrap();
                        crate::emit(
                            "tick",
                            json!({"seconds":c.elapsed().as_secs_f64(),"paused":c.paused(),"frames":sent}),
                        );
                        last_status = Instant::now();
                        if !c.paused() {
                            auto_paused = false;
                        }
                    }
                    let (paused, elapsed) = {
                        let c = timeline.lock().unwrap();
                        (c.paused(), c.elapsed())
                    };
                    if paused {
                        thread::sleep(Duration::from_millis(8));
                        continue;
                    }
                    if sent as f64 / config.fps as f64 > elapsed.as_secs_f64() {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    let p = session.shared.latest.lock().unwrap().clone().unwrap();
                    let mut p = capture::crop_pixels(&p, &config.source)?;
                    if p.width != first.width || p.height != first.height {
                        let img = image::RgbaImage::from_raw(p.width, p.height, p.data)
                            .ok_or_else(|| anyhow::anyhow!("画面格式无效"))?;
                        p.data = image::imageops::resize(
                            &img,
                            first.width,
                            first.height,
                            image::imageops::FilterType::Triangle,
                        )
                        .into_raw();
                    }
                    input.write_all(&p.data)?;
                    sent += 1;
                }
                let _ = auto_paused;
                Ok(())
            })();
            timeline.lock().unwrap().pause();
            thread_stop.store(true, Ordering::SeqCst);
            drop(input);
            if let Some(w) = audio_worker {
                if let Ok(Err(e)) = w.join() {
                    crate::emit("warning", json!({"message":format!("音频管线：{e}")}));
                }
            }
            drop(audio_streams);
            drop(session);
            let deadline = Instant::now() + Duration::from_secs(15);
            let status = loop {
                if let Some(s) = child.try_wait()? {
                    break s;
                }
                if Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    anyhow::bail!("编码器未及时结束，临时文件已保留");
                }
                thread::sleep(Duration::from_millis(50));
            };
            write_result?;
            anyhow::ensure!(status.success(), "编码失败，请查看录制日志，临时文件已保留");
            crate::emit("recording", json!({"state":"saving"}));
            media::remux(&temp, &output)?;
            std::fs::remove_file(&temp)?;
            let _ = std::fs::remove_file(output.with_extension("recording.log"));
            let path = output.to_string_lossy().into_owned();
            crate::emit("recording", json!({"state":"completed","path":path}));
            Ok(path)
        };
        let result = run();
        thread_done.store(true, Ordering::SeqCst);
        if let Err(e) = &result {
            thread_stop.store(true, Ordering::SeqCst);
            crate::emit(
                "recording",
                json!({"state":"error","message":e.to_string()}),
            );
        }
        result
    });
    Ok(Recording {
        clock,
        done,
        stop,
        worker: Some(worker),
    })
}
