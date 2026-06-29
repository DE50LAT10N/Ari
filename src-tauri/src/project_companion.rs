use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const DEFAULT_ALLOWED_EXTENSIONS: &[&str] = &[
    "md", "txt", "ts", "tsx", "js", "jsx", "json", "rs", "toml", "css", "html", "yaml", "yml",
];

const IGNORED_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    ".next",
    "coverage",
    ".cache",
    "__pycache__",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinderFileEntry {
    pub relative_path: String,
    pub modified_at: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSummary {
    pub branch: String,
    pub is_repo: bool,
    pub changed: Vec<String>,
    pub untracked: Vec<String>,
    pub staged: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitEntry {
    pub hash: String,
    pub subject: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinderListRequest {
    pub root_path: String,
    pub allowed_extensions: Option<Vec<String>>,
    pub max_depth: Option<u32>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinderReadRequest {
    pub root_path: String,
    pub relative_path: String,
    pub allowed_extensions: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffRequest {
    pub root_path: String,
    pub relative_path: Option<String>,
}

fn canonical_root(root_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(root_path.trim());
    if !path.is_absolute() {
        return Err("Корень проекта должен быть абсолютным путём.".into());
    }
    path.canonicalize()
        .map_err(|_| "Папка проекта не найдена.".to_string())
}

fn resolve_within_root(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative_path.trim());
    if rel.is_absolute() {
        return Err("Относительный путь не должен быть абсолютным.".into());
    }
    for component in rel.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Недопустимый путь внутри проекта.".into());
            }
            _ => {}
        }
    }
    let joined = root.join(rel);
    let canonical = joined
        .canonicalize()
        .map_err(|_| "Файл не найден в пределах проекта.".to_string())?;
    if !canonical.starts_with(root) {
        return Err("Путь выходит за пределы корня проекта.".into());
    }
    Ok(canonical)
}

fn normalize_extensions(allowed: Option<Vec<String>>) -> Vec<String> {
    allowed
        .unwrap_or_else(|| {
            DEFAULT_ALLOWED_EXTENSIONS
                .iter()
                .map(|value| value.to_string())
                .collect()
        })
        .into_iter()
        .map(|value| value.trim().trim_start_matches('.').to_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}

fn extension_allowed(path: &Path, allowed: &[String]) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    allowed.contains(&extension)
}

fn should_ignore_dir(name: &str) -> bool {
    IGNORED_DIR_NAMES
        .iter()
        .any(|ignored| ignored.eq_ignore_ascii_case(name))
}

fn modified_ms(path: &Path) -> u64 {
    path.metadata()
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn walk_files(
    root: &Path,
    current: &Path,
    depth: u32,
    max_depth: u32,
    allowed: &[String],
    entries: &mut Vec<BinderFileEntry>,
    limit: usize,
) {
    if entries.len() >= limit || depth > max_depth {
        return;
    }
    let read_dir = match std::fs::read_dir(current) {
        Ok(value) => value,
        Err(_) => return,
    };
    for entry in read_dir.flatten() {
        if entries.len() >= limit {
            break;
        }
        let path = entry.path();
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if path.is_dir() {
            if should_ignore_dir(&name) {
                continue;
            }
            walk_files(root, &path, depth + 1, max_depth, allowed, entries, limit);
            continue;
        }
        if !extension_allowed(&path, allowed) {
            continue;
        }
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let size_bytes = path.metadata().map(|meta| meta.len()).unwrap_or(0);
        entries.push(BinderFileEntry {
            relative_path: relative.to_string_lossy().replace('\\', "/"),
            modified_at: modified_ms(&path),
            size_bytes,
        });
    }
}

#[tauri::command]
pub fn binder_list_files(request: BinderListRequest) -> Result<Vec<BinderFileEntry>, String> {
    let root = canonical_root(&request.root_path)?;
    if !root.is_dir() {
        return Err("Корень проекта должен быть папкой.".into());
    }
    let allowed = normalize_extensions(request.allowed_extensions);
    let max_depth = request.max_depth.unwrap_or(6).min(12);
    let limit = request.limit.unwrap_or(200).min(500);
    let mut entries = Vec::new();
    walk_files(&root, &root, 0, max_depth, &allowed, &mut entries, limit);
    entries.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
    entries.truncate(limit);
    Ok(entries)
}

#[tauri::command]
pub fn binder_read_file(request: BinderReadRequest) -> Result<String, String> {
    let root = canonical_root(&request.root_path)?;
    let allowed = normalize_extensions(request.allowed_extensions);
    let path = resolve_within_root(&root, &request.relative_path)?;
    if !path.is_file() {
        return Err("Можно читать только файлы.".into());
    }
    if !extension_allowed(&path, &allowed) {
        return Err("Расширение файла не в allowlist.".into());
    }
    let metadata = path
        .metadata()
        .map_err(|error| format!("Не удалось прочитать метаданные: {error}"))?;
    if metadata.len() > 512_000 {
        return Err("Файл слишком большой для чтения (лимит 512 KB).".into());
    }
    std::fs::read_to_string(&path).map_err(|error| format!("Не удалось прочитать файл: {error}"))
}

fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(root).args(args);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let output = command
        .output()
        .map_err(|error| format!("Git недоступен: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Git-команда завершилась с ошибкой.".into()
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn is_git_repo(root: &Path) -> bool {
    root.join(".git").exists()
}

#[tauri::command]
pub fn git_status_summary(root_path: String) -> Result<GitStatusSummary, String> {
    let root = canonical_root(&root_path)?;
    if !is_git_repo(&root) {
        return Ok(GitStatusSummary {
            branch: "—".into(),
            is_repo: false,
            changed: Vec::new(),
            untracked: Vec::new(),
            staged: Vec::new(),
        });
    }
    let branch = run_git(&root, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|_| "—".into());
    let status = run_git(&root, &["status", "--porcelain=v1"])?;
    let mut changed = Vec::new();
    let mut untracked = Vec::new();
    let mut staged = Vec::new();
    for line in status.lines() {
        if line.len() < 4 {
            continue;
        }
        let code = &line[..2];
        let path = line[3..].trim().replace('\\', "/");
        if code.starts_with('?') {
            untracked.push(path);
        } else if code.starts_with('A') || code.starts_with('M') || code.starts_with('D') {
            staged.push(path.clone());
            if code.chars().nth(1) == Some('M') || code.chars().nth(1) == Some('D') {
                changed.push(path);
            }
        } else {
            changed.push(path);
        }
    }
    Ok(GitStatusSummary {
        branch,
        is_repo: true,
        changed,
        untracked,
        staged,
    })
}

#[tauri::command]
pub fn git_recent_commits(
    root_path: String,
    limit: Option<usize>,
) -> Result<Vec<GitCommitEntry>, String> {
    let root = canonical_root(&root_path)?;
    if !is_git_repo(&root) {
        return Ok(Vec::new());
    }
    let count = limit.unwrap_or(8).min(20);
    let output = run_git(
        &root,
        &[
            "log",
            &format!("-{count}"),
            "--pretty=format:%h\t%s",
        ],
    )?;
    Ok(output
        .lines()
        .filter_map(|line| {
            let (hash, subject) = line.split_once('\t')?;
            Some(GitCommitEntry {
                hash: hash.to_string(),
                subject: subject.to_string(),
            })
        })
        .collect())
}

#[tauri::command]
pub fn git_file_diff(request: GitDiffRequest) -> Result<String, String> {
    let root = canonical_root(&request.root_path)?;
    if !is_git_repo(&root) {
        return Err("Это не git-репозиторий.".into());
    }
    let mut args: Vec<String> = vec!["diff".into(), "--no-color".into()];
    if let Some(relative) = request.relative_path {
        if !relative.trim().is_empty() {
            let path = resolve_within_root(&root, &relative)?;
            let rel = path
                .strip_prefix(&root)
                .map_err(|_| "Не удалось вычислить относительный путь.")?
                .to_string_lossy()
                .replace('\\', "/");
            args.push("--".into());
            args.push(rel);
        }
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let diff = run_git(&root, &arg_refs)?;
    if diff.len() > 120_000 {
        return Ok(format!("{}\n\n… (обрезано)", &diff[..120_000]));
    }
    Ok(if diff.is_empty() {
        "Изменений нет.".into()
    } else {
        diff
    })
}
