use std::path::PathBuf;
use std::process::Command;
use std::thread;
use std::time::Duration;

const DEFAULT_OLLAMA_ORIGINS: &str =
    "http://tauri.localhost,https://tauri.localhost,http://localhost:1420,http://127.0.0.1:1420";

#[cfg(not(target_os = "windows"))]
pub fn apply_ollama_models_path(_path: &str) -> Result<String, String> {
    Err("Настройка папки моделей Ollama доступна только в Windows.".into())
}

#[cfg(not(target_os = "windows"))]
pub fn ensure_ollama_origins() -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn apply_ollama_environment(_command: &mut Command) {}

#[cfg(not(target_os = "windows"))]
pub fn stop_ollama_processes() {}

#[cfg(not(target_os = "windows"))]
pub fn start_ollama_with_environment() -> Result<(), String> {
    Err("Запуск Ollama с окружением доступен только в Windows.".into())
}

#[cfg(windows)]
fn read_user_env(name: &str) -> Option<String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .ok()?
        .get_value::<String, _>(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(windows)]
fn write_user_env(name: &str, value: &str) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    let environment = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags("Environment", KEY_SET_VALUE)
        .map_err(|error| format!("Не удалось открыть переменные пользователя: {error}"))?;
    environment
        .set_value(name, &value)
        .map_err(|error| format!("Не удалось записать {name}: {error}"))?;
    Ok(())
}

#[cfg(windows)]
fn broadcast_environment_change() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    let wide: Vec<u16> = "Environment".encode_utf16().chain(Some(0)).collect();
    let mut result = 0usize;
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            wide.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            5000,
            &mut result,
        );
    }
}

#[cfg(windows)]
fn normalize_models_dir(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Укажи папку для моделей Ollama.".into());
    }
    if !trimmed.is_ascii() {
        return Err("Путь к моделям должен содержать только латиницу.".into());
    }

    let models_path = PathBuf::from(trimmed);
    std::fs::create_dir_all(&models_path)
        .map_err(|error| format!("Не удалось создать папку моделей {trimmed}: {error}"))?;

    Ok(trimmed.trim_end_matches(['\\', '/']).to_string())
}

#[cfg(windows)]
pub fn apply_ollama_models_path(path: &str) -> Result<String, String> {
    let normalized = normalize_models_dir(path)?;
    write_user_env("OLLAMA_MODELS", &normalized)?;
    broadcast_environment_change();
    Ok(normalized)
}

#[cfg(windows)]
pub fn ensure_ollama_origins() -> Result<(), String> {
    if read_user_env("OLLAMA_ORIGINS").is_some() {
        return Ok(());
    }
    write_user_env("OLLAMA_ORIGINS", DEFAULT_OLLAMA_ORIGINS)?;
    broadcast_environment_change();
    Ok(())
}

#[cfg(windows)]
pub fn apply_ollama_environment(command: &mut Command) {
    if let Some(path) = read_user_env("OLLAMA_MODELS") {
        command.env("OLLAMA_MODELS", path);
    }

    command.env(
        "OLLAMA_ORIGINS",
        read_user_env("OLLAMA_ORIGINS").unwrap_or_else(|| DEFAULT_OLLAMA_ORIGINS.to_string()),
    );
}

#[cfg(windows)]
pub fn stop_ollama_processes() {
    use std::os::windows::process::CommandExt;

    for process_name in [
        "ollama app.exe",
        "ollama.exe",
        "ollama_llama_server.exe",
        "llama-server.exe",
    ] {
        let mut command = Command::new("taskkill.exe");
        command.args(["/F", "/T", "/IM", process_name]);
        command.creation_flags(0x08000000);
        let _ = command.output();
    }
}

#[cfg(windows)]
fn ollama_app_executable() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| {
        PathBuf::from(base)
            .join("Programs")
            .join("Ollama")
            .join("ollama app.exe")
    })
}

#[cfg(windows)]
fn ollama_cli_executable() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("Programs").join("Ollama").join("ollama.exe"))
        .filter(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from("ollama"))
}

#[cfg(windows)]
pub fn start_ollama_with_environment() -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    ensure_ollama_origins()?;

    if let Some(app_executable) = ollama_app_executable().filter(|path| path.exists()) {
        let mut app_command = Command::new(app_executable);
        apply_ollama_environment(&mut app_command);
        app_command.creation_flags(0x08000000);
        app_command
            .spawn()
            .map_err(|error| format!("Не удалось запустить Ollama App: {error}"))?;
        thread::sleep(Duration::from_millis(1200));
    }

    let mut serve_command = Command::new(ollama_cli_executable());
    serve_command.arg("serve");
    apply_ollama_environment(&mut serve_command);
    serve_command.creation_flags(0x08000000);
    serve_command
        .spawn()
        .map_err(|error| format!("Не удалось запустить ollama serve: {error}"))?;

    Ok(())
}
