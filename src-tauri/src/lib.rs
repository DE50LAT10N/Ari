use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewWindow,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use serde::{Deserialize, Serialize};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::path::{Path, PathBuf};

mod gigachat_http;
mod http_fetch;
mod ollama_env;
mod project_companion;
use gigachat_http::{gigachat_http_request, gigachat_upload_file};
use http_fetch::http_fetch;
use ollama_env::{apply_ollama_models_path, start_ollama_with_environment, stop_ollama_processes};
use project_companion::{
    binder_list_files, binder_read_file, git_file_diff, git_recent_commits, git_status_summary,
};

#[tauri::command]
fn restart_ollama(models_dir: Option<String>) -> Result<String, String> {
    let models_message = if let Some(path) = models_dir.filter(|value| !value.trim().is_empty()) {
        let normalized = apply_ollama_models_path(path.trim())?;
        format!("OLLAMA_MODELS={normalized}. ")
    } else {
        String::new()
    };

    #[cfg(target_os = "windows")]
    {
        stop_ollama_processes();
        std::thread::sleep(std::time::Duration::from_millis(1800));
        start_ollama_with_environment()?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        start_ollama()?;
    }

    Ok(format!("{models_message}Ollama перезапущена."))
}

#[tauri::command]
fn start_ollama() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return start_ollama_with_environment();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let executable = std::env::var_os("LOCALAPPDATA")
            .map(std::path::PathBuf::from)
            .map(|path| path.join("Programs").join("Ollama").join("ollama.exe"))
            .filter(|path| path.exists())
            .unwrap_or_else(|| std::path::PathBuf::from("ollama"));

        let mut command = Command::new(executable);
        command.arg("serve");

        command
            .spawn()
            .map(|child| {
                log::info!("Started Ollama process with PID {}", child.id());
            })
            .map_err(|error| {
                log::error!("Failed to start Ollama: {error}");
                format!("Не удалось запустить Ollama: {error}")
            })
    }
}

#[tauri::command]
fn stop_ollama_and_exit(app: AppHandle) -> Result<(), String> {
    log::info!("Full shutdown requested: stopping Ollama and Ari");

    #[cfg(target_os = "windows")]
    {
        stop_ollama_processes();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("pkill").arg("-f").arg("ollama").output();
    }

    app.exit(0);
    Ok(())
}

#[tauri::command]
fn exit_ari(app: AppHandle) {
    app.exit(0);
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_user_idle_seconds() -> Result<u64, String> {
    use windows_sys::Win32::{
        System::SystemInformation::GetTickCount64,
        UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
    };

    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info) == 0 {
            return Err("Не удалось определить время бездействия Windows.".into());
        }

        let current_low = GetTickCount64() as u32;
        let elapsed_ms = current_low.wrapping_sub(info.dwTime) as u64;
        Ok(elapsed_ms / 1000)
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_user_idle_seconds() -> Result<u64, String> {
    Ok(0)
}


#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SafeActionInput {
    action_type: String,
    target: Option<String>,
    content: Option<String>,
    filename: Option<String>,
}

fn validate_text(value: Option<String>, max_length: usize) -> Result<String, String> {
    let value = value.unwrap_or_default();
    if value.trim().is_empty() {
        return Err("Для действия не передан текст.".into());
    }
    if value.len() > max_length {
        return Err("Текст действия превышает безопасный лимит.".into());
    }
    Ok(value)
}

#[cfg(target_os = "windows")]
fn shell_open(target: &str) -> Result<(), String> {
    use std::{iter::once, ptr::null};
    use windows_sys::Win32::UI::{
        Shell::ShellExecuteW,
        WindowsAndMessaging::SW_SHOWNORMAL,
    };

    let operation: Vec<u16> = "open".encode_utf16().chain(once(0)).collect();
    let target: Vec<u16> = target.encode_utf16().chain(once(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        )
    };
    if result as usize <= 32 {
        return Err("Windows не смогла открыть выбранный объект.".into());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
    use std::{iter::once, ptr::copy_nonoverlapping};
    use windows_sys::Win32::System::{
        DataExchange::{
            CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
        },
        Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
    };

    let wide: Vec<u16> = text.encode_utf16().chain(once(0)).collect();
    const CF_UNICODETEXT: u32 = 13;
    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return Err("Буфер обмена сейчас занят другим приложением.".into());
        }
        if EmptyClipboard() == 0 {
            CloseClipboard();
            return Err("Не удалось очистить буфер обмена.".into());
        }
        let memory = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2);
        if memory.is_null() {
            CloseClipboard();
            return Err("Не удалось выделить память для буфера обмена.".into());
        }
        let destination = GlobalLock(memory) as *mut u16;
        if destination.is_null() {
            CloseClipboard();
            return Err("Не удалось подготовить буфер обмена.".into());
        }
        copy_nonoverlapping(wide.as_ptr(), destination, wide.len());
        GlobalUnlock(memory);
        if SetClipboardData(CF_UNICODETEXT, memory).is_null() {
            CloseClipboard();
            return Err("Не удалось записать текст в буфер обмена.".into());
        }
        CloseClipboard();
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn read_clipboard_text_impl() -> Result<String, String> {
    use std::ptr;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};

    const CF_UNICODETEXT: u32 = 13;
    unsafe {
        if OpenClipboard(ptr::null_mut()) == 0 {
            return Err("Буфер обмена сейчас занят другим приложением.".into());
        }
        if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 {
            CloseClipboard();
            return Ok(String::new());
        }
        let handle = GetClipboardData(CF_UNICODETEXT);
        if handle.is_null() {
            CloseClipboard();
            return Err("Не удалось прочитать буфер обмена.".into());
        }
        let data = GlobalLock(handle) as *const u16;
        if data.is_null() {
            CloseClipboard();
            return Err("Не удалось прочитать буфер обмена.".into());
        }
        let mut len = 0usize;
        while *data.add(len) != 0 {
            len += 1;
        }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(data, len));
        GlobalUnlock(handle);
        CloseClipboard();
        Ok(text)
    }
}

#[tauri::command]
fn read_clipboard_text() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        read_clipboard_text_impl()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Чтение буфера обмена поддерживается только в Windows.".into())
    }
}

fn safe_note_filename(filename: Option<String>) -> String {
    let raw = filename.unwrap_or_else(|| "Заметка Ari.md".into());
    let cleaned: String = raw
        .chars()
        .filter(|character| {
            !matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) && !character.is_control()
        })
        .take(100)
        .collect();
    let cleaned = cleaned.trim().trim_matches('.');
    let base = if cleaned.is_empty() { "Заметка Ari.md" } else { cleaned };
    let lower = base.to_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".txt") {
        base.to_string()
    } else {
        format!("{base}.md")
    }
}

fn validate_open_path(target: &str) -> Result<PathBuf, String> {
    let path = Path::new(target);
    if !path.is_absolute() {
        return Err("Можно открыть только абсолютный локальный путь.".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "Файл или папка не найдены.".to_string())?;
    if canonical.is_file() {
        let extension = canonical
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase();
        let forbidden = [
            "exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js",
            "jse", "wsf", "wsh", "msi", "msp", "scr", "reg", "lnk", "hta",
            "cpl", "jar", "scf", "url", "appref-ms",
        ];
        if forbidden.contains(&extension.as_str()) {
            return Err("Запуск исполняемых файлов и сценариев запрещён.".into());
        }
    }
    Ok(canonical)
}

#[tauri::command]
fn perform_safe_action(app: AppHandle, action: SafeActionInput) -> Result<String, String> {
    match action.action_type.as_str() {
        "open_url" => {
            let target = validate_text(action.target, 2_048)?;
            let lower = target.to_lowercase();
            if !(lower.starts_with("https://") || lower.starts_with("http://"))
                || target.chars().any(char::is_control)
            {
                return Err("Разрешены только обычные HTTP/HTTPS-ссылки.".into());
            }
            #[cfg(target_os = "windows")]
            {
                shell_open(&target)?;
                Ok("Ссылка открыта в системном браузере.".into())
            }
            #[cfg(not(target_os = "windows"))]
            Err("Поддерживается только на Windows.".into())
        }
        "open_path" => {
            let target = validate_text(action.target, 32_768)?;
            let canonical = validate_open_path(&target)?;
            #[cfg(target_os = "windows")]
            {
                shell_open(&canonical.to_string_lossy())?;
                Ok(format!("Открыто: {}", canonical.display()))
            }
            #[cfg(not(target_os = "windows"))]
            Err("Поддерживается только на Windows.".into())
        }
        "copy_text" => {
            let content = validate_text(action.content, 100_000)?;
            #[cfg(target_os = "windows")]
            {
                copy_text_to_clipboard(&content)?;
                Ok("Текст скопирован в буфер обмена.".into())
            }
            #[cfg(not(target_os = "windows"))]
            Err("Поддерживается только на Windows.".into())
        }
        "create_note" => {
            let content = validate_text(action.content, 100_000)?;
            let notes_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Не удалось определить папку данных: {error}"))?
                .join("notes");
            std::fs::create_dir_all(&notes_dir)
                .map_err(|error| format!("Не удалось создать папку заметок: {error}"))?;
            let filename = safe_note_filename(action.filename);
            let requested_path = notes_dir.join(&filename);
            let path = if requested_path.exists() {
                let source = Path::new(&filename);
                let stem = source
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Заметка Ari");
                let extension = source
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or("md");
                notes_dir.join(format!(
                    "{stem}-{}.{}",
                    chrono_free_timestamp(),
                    extension
                ))
            } else {
                requested_path
            };
            std::fs::write(&path, content)
                .map_err(|error| format!("Не удалось сохранить заметку: {error}"))?;
            #[cfg(target_os = "windows")]
            {
                shell_open(&path.to_string_lossy())?;
                Ok(format!("Заметка сохранена: {}", path.display()))
            }
            #[cfg(not(target_os = "windows"))]
            Err("Поддерживается только на Windows.".into())
        }
        _ => Err("Неизвестный или запрещённый тип действия.".into()),
    }
}

fn chrono_free_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn gigachat_key_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Не удалось определить папку данных: {error}"))?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Не удалось создать папку данных: {error}"))?;
    Ok(directory.join("gigachat-auth-key.dpapi"))
}

#[cfg(target_os = "windows")]
fn protect_for_current_user(value: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: value.len() as u32,
        pbData: value.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let succeeded = unsafe {
        CryptProtectData(
            &mut input,
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if succeeded == 0 {
        return Err("Windows не смогла зашифровать API-ключ.".into());
    }
    let protected =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }
            .to_vec();
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(protected)
}

#[cfg(target_os = "windows")]
fn unprotect_for_current_user(value: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: value.len() as u32,
        pbData: value.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let succeeded = unsafe {
        CryptUnprotectData(
            &mut input,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if succeeded == 0 {
        return Err("Windows не смогла расшифровать API-ключ.".into());
    }
    let plain =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }
            .to_vec();
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(plain)
}

#[tauri::command]
fn save_gigachat_auth_key(app: AppHandle, auth_key: String) -> Result<(), String> {
    let key = auth_key.trim();
    if key.len() < 20 || key.len() > 512 {
        return Err("Ключ авторизации GigaChat имеет некорректную длину.".into());
    }
    #[cfg(target_os = "windows")]
    let protected = protect_for_current_user(key.as_bytes())?;
    #[cfg(not(target_os = "windows"))]
    let protected = key.as_bytes().to_vec();
    std::fs::write(gigachat_key_path(&app)?, protected)
        .map_err(|error| format!("Не удалось сохранить ключ авторизации: {error}"))
}

#[tauri::command]
fn load_gigachat_auth_key(app: AppHandle) -> Result<Option<String>, String> {
    let path = gigachat_key_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let protected = std::fs::read(path)
        .map_err(|error| format!("Не удалось прочитать ключ авторизации: {error}"))?;
    #[cfg(target_os = "windows")]
    let plain = unprotect_for_current_user(&protected)?;
    #[cfg(not(target_os = "windows"))]
    let plain = protected;
    String::from_utf8(plain)
        .map(Some)
        .map_err(|_| "Сохранённый ключ авторизации повреждён.".into())
}

#[tauri::command]
fn delete_gigachat_auth_key(app: AppHandle) -> Result<(), String> {
    let path = gigachat_key_path(&app)?;
    if path.exists() {
        std::fs::remove_file(path)
            .map_err(|error| format!("Не удалось удалить ключ авторизации: {error}"))?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveWindowInfo {
    title: String,
    process_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenCaptureResult {
    image_base64: String,
    title: String,
    process_name: String,
    width: u32,
    height: u32,
}

#[cfg(target_os = "windows")]
fn capture_foreground_window_png() -> Result<ScreenCaptureResult, String> {
    use image::{
        imageops::FilterType, DynamicImage, GenericImageView, ImageFormat,
        RgbaImage,
    };
    use std::{io::Cursor, mem::zeroed, ptr::null_mut};
    use windows_sys::Win32::{
        Foundation::RECT,
        Graphics::Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC,
            DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject,
            BITMAPINFO, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, SRCCOPY,
        },
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowRect, GetWindowTextLengthW,
            GetWindowTextW,
        },
    };

    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return Err("Не удалось определить активное окно.".into());
        }

        let mut rect: RECT = zeroed();
        if GetWindowRect(window, &mut rect) == 0 {
            return Err("Не удалось определить размеры активного окна.".into());
        }
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 1 || height <= 1 || width > 16_384 || height > 16_384 {
            return Err("Активное окно имеет некорректный размер.".into());
        }

        let title_length = GetWindowTextLengthW(window);
        let mut title_buffer = vec![0_u16; (title_length.max(0) + 1) as usize];
        let copied = GetWindowTextW(
            window,
            title_buffer.as_mut_ptr(),
            title_buffer.len() as i32,
        );
        let title =
            String::from_utf16_lossy(&title_buffer[..copied.max(0) as usize]);

        let screen_dc = GetDC(null_mut());
        if screen_dc.is_null() {
            return Err("Windows не предоставила контекст экрана.".into());
        }
        let memory_dc = CreateCompatibleDC(screen_dc);
        let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
        if memory_dc.is_null() || bitmap.is_null() {
            if !memory_dc.is_null() {
                DeleteDC(memory_dc);
            }
            if !bitmap.is_null() {
                DeleteObject(bitmap);
            }
            ReleaseDC(null_mut(), screen_dc);
            return Err("Не удалось подготовить буфер снимка.".into());
        }

        let old_object = SelectObject(memory_dc, bitmap);
        let copied_ok = BitBlt(
            memory_dc,
            0,
            0,
            width,
            height,
            screen_dc,
            rect.left,
            rect.top,
            SRCCOPY | CAPTUREBLT,
        );

        let mut info: BITMAPINFO = zeroed();
        info.bmiHeader.biSize =
            std::mem::size_of_val(&info.bmiHeader) as u32;
        info.bmiHeader.biWidth = width;
        info.bmiHeader.biHeight = -height;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        let mut bgra = vec![0_u8; width as usize * height as usize * 4];
        let lines = if copied_ok != 0 {
            GetDIBits(
                memory_dc,
                bitmap,
                0,
                height as u32,
                bgra.as_mut_ptr().cast(),
                &mut info,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };

        SelectObject(memory_dc, old_object);
        DeleteObject(bitmap);
        DeleteDC(memory_dc);
        ReleaseDC(null_mut(), screen_dc);

        if lines == 0 {
            return Err("Не удалось получить пиксели активного окна.".into());
        }

        for pixel in bgra.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }
        let image = RgbaImage::from_raw(width as u32, height as u32, bgra)
            .ok_or_else(|| "Не удалось собрать изображение окна.".to_string())?;
        let image = DynamicImage::ImageRgba8(image);
        let image = if width > 1600 || height > 1600 {
            image.resize(1600, 1600, FilterType::Triangle)
        } else {
            image
        };
        let (encoded_width, encoded_height) = image.dimensions();
        let mut png = Cursor::new(Vec::new());
        image.write_to(&mut png, ImageFormat::Png)
            .map_err(|error| format!("Не удалось закодировать PNG: {error}"))?;

        Ok(ScreenCaptureResult {
            image_base64: BASE64.encode(png.into_inner()),
            title,
            process_name: "активное приложение".into(),
            width: encoded_width,
            height: encoded_height,
        })
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn capture_active_window(app: AppHandle) -> Result<ScreenCaptureResult, String> {
    let main_window = app.get_webview_window("main");
    if let Some(window) = &main_window {
        let _ = window.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(350));
    let result = capture_foreground_window_png();
    if let Some(window) = &main_window {
        show_window(window);
    }
    result
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn capture_active_window(_app: AppHandle) -> Result<ScreenCaptureResult, String> {
    Err("Захват активного окна поддерживается только в Windows.".into())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_active_window() -> Option<ActiveWindowInfo> {
    use std::{ffi::c_void, os::windows::ffi::OsStringExt, path::Path};

    type Hwnd = *mut c_void;
    type Handle = *mut c_void;

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowTextLengthW(window: Hwnd) -> i32;
        fn GetWindowTextW(window: Hwnd, text: *mut u16, max_count: i32) -> i32;
        fn GetWindowThreadProcessId(window: Hwnd, process_id: *mut u32) -> u32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit_handle: i32, process_id: u32) -> Handle;
        fn QueryFullProcessImageNameW(
            process: Handle,
            flags: u32,
            name: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return None;
        }

        let title_length = GetWindowTextLengthW(window);
        let mut title_buffer = vec![0_u16; (title_length.max(0) + 1) as usize];
        let copied = GetWindowTextW(
            window,
            title_buffer.as_mut_ptr(),
            title_buffer.len() as i32,
        );
        let title = String::from_utf16_lossy(&title_buffer[..copied.max(0) as usize]);

        let mut process_id = 0_u32;
        GetWindowThreadProcessId(window, &mut process_id);
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        let process_name = if process.is_null() {
            String::new()
        } else {
            let mut path_buffer = vec![0_u16; 32_768];
            let mut path_length = path_buffer.len() as u32;
            let succeeded = QueryFullProcessImageNameW(
                process,
                0,
                path_buffer.as_mut_ptr(),
                &mut path_length,
            );
            CloseHandle(process);

            if succeeded == 0 {
                String::new()
            } else {
                let path = std::ffi::OsString::from_wide(
                    &path_buffer[..path_length as usize],
                );
                Path::new(&path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default()
                    .to_owned()
            }
        };

        Some(ActiveWindowInfo {
            title,
            process_name,
        })
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_active_window() -> Option<ActiveWindowInfo> {
    None
}

fn show_window(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            _ => show_window(&window),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                show_window(&window);
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .rotation_strategy(RotationStrategy::KeepSome(5))
                .max_file_size(1_000_000)
                .clear_targets()
                .targets([
                    Target::new(TargetKind::LogDir {
                        file_name: Some("ari-desktop-character".into()),
                    }),
                    Target::new(TargetKind::Stdout),
                ])
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            log::info!(
                "Ari Desktop Character {} starting",
                app.package_info().version
            );
            let toggle_item = MenuItem::with_id(
                app,
                "toggle",
                "Показать / скрыть Ari",
                true,
                None::<&str>,
            )?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Desktop Character — Ari")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_ollama,
            restart_ollama,
            stop_ollama_and_exit,
            exit_ari,
            get_user_idle_seconds,
            get_active_window,
            capture_active_window,
            perform_safe_action,
            save_gigachat_auth_key,
            load_gigachat_auth_key,
            delete_gigachat_auth_key,
            gigachat_http_request,
            gigachat_upload_file,
            binder_list_files,
            binder_read_file,
            git_status_summary,
            git_recent_commits,
            git_file_diff,
            http_fetch,
            read_clipboard_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
