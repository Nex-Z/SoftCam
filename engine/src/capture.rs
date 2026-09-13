use crate::model::Source;
use anyhow::{anyhow, Result};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use windows_capture::{
    capture::{Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::*,
    window::Window,
};

#[derive(Clone)]
pub struct Pixels {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}
#[derive(Clone)]
pub struct Shared {
    pub latest: Arc<Mutex<Option<Arc<Pixels>>>>,
    pub closed: Arc<AtomicBool>,
    pub fps: u32,
}
struct Handler {
    shared: Shared,
    last: Instant,
}
impl GraphicsCaptureApiHandler for Handler {
    type Flags = Shared;
    type Error = Box<dyn std::error::Error + Send + Sync>;
    fn new(ctx: Context<Shared>) -> Result<Self, Self::Error> {
        Ok(Self {
            shared: ctx.flags,
            last: Instant::now() - Duration::from_secs(1),
        })
    }
    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        _: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.last.elapsed() < Duration::from_secs_f64(0.85 / self.shared.fps as f64) {
            return Ok(());
        }
        self.last = Instant::now();
        let (width, height) = (frame.width(), frame.height());
        let data = frame.buffer()?.as_nopadding_buffer()?.to_vec();
        *self.shared.latest.lock().unwrap() = Some(Arc::new(Pixels {
            width,
            height,
            data,
        }));
        Ok(())
    }
    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.shared.closed.store(true, Ordering::SeqCst);
        Ok(())
    }
}
pub struct Session {
    pub shared: Shared,
    stop: Option<Box<dyn FnOnce() + Send>>,
}
impl Drop for Session {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            stop()
        }
    }
}
pub fn start(source: &Source, cursor: bool, fps: u32) -> Result<Session> {
    let shared = Shared {
        latest: Arc::new(Mutex::new(None)),
        closed: Arc::new(AtomicBool::new(false)),
        fps,
    };
    let cur = if cursor {
        CursorCaptureSettings::WithCursor
    } else {
        CursorCaptureSettings::WithoutCursor
    };
    let stop: Box<dyn FnOnce() + Send> = match source.kind.as_str() {
        "window" => {
            let item = Window::from_raw_hwnd(source.id as *mut std::ffi::c_void);
            let ctl = Handler::start_free_threaded(Settings::new(
                item,
                cur,
                DrawBorderSettings::Default,
                SecondaryWindowSettings::Default,
                MinimumUpdateIntervalSettings::Default,
                DirtyRegionSettings::Default,
                ColorFormat::Rgba8,
                shared.clone(),
            ))
            .map_err(|e| anyhow!("{e}"))?;
            Box::new(move || {
                let _ = ctl.stop();
            })
        }
        "monitor" => {
            let item = Monitor::from_raw_hmonitor(source.id as *mut std::ffi::c_void);
            let ctl = Handler::start_free_threaded(Settings::new(
                item,
                cur,
                DrawBorderSettings::Default,
                SecondaryWindowSettings::Default,
                MinimumUpdateIntervalSettings::Default,
                DirtyRegionSettings::Default,
                ColorFormat::Rgba8,
                shared.clone(),
            ))
            .map_err(|e| anyhow!("{e}"))?;
            Box::new(move || {
                let _ = ctl.stop();
            })
        }
        _ => return Err(anyhow!("未知捕获模式")),
    };
    let session = Session {
        shared,
        stop: Some(stop),
    };
    let deadline = Instant::now() + Duration::from_secs(8);
    while session.shared.latest.lock().unwrap().is_none() {
        anyhow::ensure!(
            Instant::now() < deadline,
            "无法取得画面，请检查窗口是否最小化或受保护"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    Ok(session)
}
pub fn crop_pixels(p: &Pixels, source: &Source) -> Result<Pixels> {
    if let Some(c) = &source.crop {
        c.validate(p.width, p.height)?;
        let mut data = Vec::with_capacity((c.width * c.height * 4) as usize);
        for y in c.y..c.y + c.height {
            let a = ((y * p.width + c.x) * 4) as usize;
            data.extend_from_slice(&p.data[a..a + (c.width * 4) as usize]);
        }
        Ok(Pixels {
            width: c.width,
            height: c.height,
            data,
        })
    } else {
        Ok(p.clone())
    }
}
pub fn screenshot(source: &Source, output: &str) -> Result<serde_json::Value> {
    let session = start(source, false, 30)?;
    let p = session.shared.latest.lock().unwrap().clone().unwrap();
    let p = crop_pixels(&p, source)?;
    image::save_buffer(output, &p.data, p.width, p.height, image::ColorType::Rgba8)?;
    Ok(serde_json::json!({"path":output,"width":p.width,"height":p.height}))
}
pub fn sources() -> Result<serde_json::Value> {
    let monitors=Monitor::enumerate()?.into_iter().map(|m|{ use windows::Win32::Graphics::Gdi::{GetMonitorInfoW,MONITORINFO,HMONITOR}; let mut info=MONITORINFO::default(); info.cbSize=std::mem::size_of::<MONITORINFO>() as u32; unsafe{let _=GetMonitorInfoW(HMONITOR(m.as_raw_hmonitor()),&mut info);} serde_json::json!({"id":m.as_raw_hmonitor() as isize,"kind":"monitor","title":m.name().unwrap_or_default(),"x":info.rcMonitor.left,"y":info.rcMonitor.top,"width":m.width().unwrap_or(0),"height":m.height().unwrap_or(0)})}).collect::<Vec<_>>();
    let windows=Window::enumerate()?.into_iter().filter(|w|w.is_valid()).filter_map(|w|{let title=w.title().ok()?;if title.trim().is_empty()||title=="SoftCam"||title.starts_with("SoftCam ·"){return None}let mut rect=windows::Win32::Foundation::RECT::default();unsafe {let _=windows::Win32::UI::WindowsAndMessaging::GetWindowRect(windows::Win32::Foundation::HWND(w.as_raw_hwnd()), &mut rect);} Some(serde_json::json!({"x":rect.left,"y":rect.top,"width":rect.right-rect.left,"height":rect.bottom-rect.top,"id":w.as_raw_hwnd() as isize,"kind":"window","title":title,"pid":w.process_id().unwrap_or(0),"process":w.process_name().unwrap_or_default()}))}).collect::<Vec<_>>();
    Ok(serde_json::json!({"monitors":monitors,"windows":windows}))
}

pub fn window_bounds(id: isize) -> Result<serde_json::Value> {
    use windows::Win32::{
        Foundation::{HWND, RECT},
        UI::WindowsAndMessaging::{GetWindowRect, IsIconic, IsWindow, IsWindowVisible},
    };
    let hwnd = HWND(id as *mut std::ffi::c_void);
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool()
            || !IsWindowVisible(hwnd).as_bool()
            || IsIconic(hwnd).as_bool()
        {
            return Ok(serde_json::Value::Null);
        }
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect)?;
        // WGC uses the visible DWM frame, not the invisible resize margins
        // returned by GetWindowRect on modern Windows.
        let mut visible = RECT::default();
        if windows::Win32::Graphics::Dwm::DwmGetWindowAttribute(
            hwnd,
            windows::Win32::Graphics::Dwm::DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut visible as *mut RECT as *mut std::ffi::c_void,
            std::mem::size_of::<RECT>() as u32,
        )
        .is_ok()
        {
            rect = visible;
        }
        Ok(
            serde_json::json!({"x":rect.left,"y":rect.top,"width":rect.right-rect.left,"height":rect.bottom-rect.top}),
        )
    }
}
