# Third-party components

The package includes upstream licenses under `resources/licenses`, Electron's license and Chromium notices. Dependency versions are locked by `package-lock.json` and `engine/Cargo.lock`.

| Component | License / source |
| --- | --- |
| Electron / Chromium | MIT and bundled Chromium third-party notices; https://github.com/electron/electron |
| React / React DOM | MIT; https://github.com/facebook/react |
| Lucide | ISC; https://github.com/lucide-icons/lucide |
| windows-capture 1.5.0 | MIT; https://github.com/NiiightmareXD/windows-capture |
| wasapi 0.24.0 | MIT; https://github.com/HEnquist/wasapi-rs |
| windows-rs | MIT OR Apache-2.0; https://github.com/microsoft/windows-rs |
| Other Rust crates | Individual licenses and a versioned dependency manifest are copied into the package |
| FFmpeg / ffprobe | This development build uses FFmpeg 6.0 full_build from https://www.gyan.dev/ffmpeg/builds/ with GPL and version 3 enabled. The exact build configuration and license are copied into the package. Upstream source: https://github.com/FFmpeg/FFmpeg/tree/n6.0 ; build provenance: https://github.com/GyanD/codexffmpeg |

FFmpeg builds can contain additional libraries with their own notices and source requirements. The packaged `FFmpeg-build.txt` identifies the selected build and enabled libraries; changing the binary requires updating its provenance and accompanying licenses. The FFmpeg binary runs as a separate process. Public redistribution should include the corresponding source material for the exact selected build and its enabled components.
