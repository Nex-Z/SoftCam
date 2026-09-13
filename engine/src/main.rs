mod audio;
mod capture;
mod compress;
mod media;
mod model;
mod record;
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::{
    io::{BufRead, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

fn send(value: Value) {
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let _ = writeln!(out, "{value}");
}
pub fn emit(event: &str, data: Value) {
    send(json!({"v":1,"event":event,"data":data}));
}
#[derive(Default)]
struct State {
    recording: Option<record::Recording>,
    job: Option<Arc<AtomicBool>>,
}
fn handle(method: &str, p: Value, state: &Arc<Mutex<State>>) -> Result<Value> {
    match method {
        "capabilities" => Ok(
            json!({"platform":"windows","encoders":media::encoders(),"microphones":audio::devices()?}),
        ),
        "sources" => capture::sources(),
        "windowBounds" => capture::window_bounds(p["id"].as_i64().context("缺少窗口 ID")? as isize),
        "probe" => media::probe(p["path"].as_str().context("缺少文件路径")?),
        "pause" | "resume" => {
            let s = state.lock().unwrap();
            let r = s.recording.as_ref().context("没有正在进行的录制")?;
            if method == "pause" {
                r.pause()?
            } else {
                r.resume()?
            }
            Ok(json!({}))
        }
        "stop" => {
            let r = {
                let mut s = state.lock().unwrap();
                let r = s.recording.take().context("没有正在进行的录制")?;
                s.job = Some(Arc::new(AtomicBool::new(false)));
                r
            };
            let result = r.stop();
            state.lock().unwrap().job = None;
            Ok(json!({"path":result?}))
        }
        "cancel" => {
            if let Some(c) = &state.lock().unwrap().job {
                c.store(true, Ordering::SeqCst);
            }
            Ok(json!({}))
        }
        "start" => {
            let mut s = state.lock().unwrap();
            if s.recording
                .as_ref()
                .is_some_and(|r| r.done.load(Ordering::SeqCst))
            {
                s.recording.take();
            }
            anyhow::ensure!(s.recording.is_none() && s.job.is_none(), "已有任务正在进行");
            s.recording = Some(record::start(serde_json::from_value(p)?)?);
            Ok(json!({}))
        }
        "screenshot" | "estimate" | "compress" | "recover" => {
            let cancel = Arc::new(AtomicBool::new(false));
            {
                let mut s = state.lock().unwrap();
                if s.recording
                    .as_ref()
                    .is_some_and(|r| r.done.load(Ordering::SeqCst))
                {
                    s.recording.take();
                }
                anyhow::ensure!(s.recording.is_none() && s.job.is_none(), "已有任务正在进行");
                s.job = Some(cancel.clone());
            }
            let result = (|| -> Result<Value> {
                match method {
                    "screenshot" => {
                        let output = p["output"].as_str().context("缺少输出路径")?;
                        media::safe_output(output, None)?;
                        capture::screenshot(&serde_json::from_value(p["source"].clone())?, output)
                    }
                    "estimate" => compress::estimate(&p, cancel),
                    "compress" => {
                        let input = p["input"].as_str().context("缺少输入文件")?;
                        let output = p["output"].as_str().context("缺少输出文件")?;
                        compress::transcode(
                            input,
                            output,
                            p["codec"].as_str().unwrap_or("h264"),
                            p["quality"].as_str().unwrap_or("balanced"),
                            None,
                            cancel,
                        )?;
                        Ok(json!({"path":output,"size":std::fs::metadata(output)?.len()}))
                    }
                    "recover" => {
                        let input = p["input"].as_str().context("缺少恢复文件")?;
                        let output = p["output"].as_str().context("缺少输出路径")?;
                        media::safe_output(output, Some(input))?;
                        media::remux(std::path::Path::new(input), std::path::Path::new(output))?;
                        Ok(json!({"path":output}))
                    }
                    _ => unreachable!(),
                }
            })();
            state.lock().unwrap().job = None;
            result
        }
        _ => anyhow::bail!("未知方法：{method}"),
    }
}
fn main() {
    unsafe {
        let _ = windows::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(
            windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        );
    }
    let state = Arc::new(Mutex::new(State::default()));
    let mut workers: Vec<std::thread::JoinHandle<()>> = Vec::new();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let request: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                send(
                    json!({"v":1,"id":null,"error":{"code":"INVALID_JSON","message":e.to_string()}}),
                );
                continue;
            }
        };
        let state = state.clone();
        workers.retain(|worker| !worker.is_finished());
        workers.push(std::thread::spawn(move || {
            let id = request["id"].clone();
            let result = if request["v"] != 1 {
                Err(anyhow::anyhow!("不支持的协议版本"))
            } else if let Some(method) = request["method"].as_str() {
                handle(method, request["params"].clone(), &state)
            } else {
                Err(anyhow::anyhow!("缺少方法"))
            };
            match result {
                Ok(result) => send(json!({"v":1,"id":id,"result":result})),
                Err(e) => send(
                    json!({"v":1,"id":id,"error":{"code":"ENGINE_ERROR","message":e.to_string()}}),
                ),
            }
        }));
    }
    let mut s = state.lock().unwrap();
    if let Some(c) = s.job.take() {
        c.store(true, Ordering::SeqCst);
    }
    let r = s.recording.take();
    drop(s);
    if let Some(r) = r {
        let _ = r.stop();
    }
    // Do not exit while a stop handler is remuxing or a cancelled encoder
    // still owns its output file. EOF is also used after an Electron crash.
    for worker in workers {
        let _ = worker.join();
    }
}
