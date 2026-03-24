use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;
use toml::Value as TomlValue;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileSource {
    Manual,
    Captured,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub auth_label: String,
    pub auth_mode: String,
    pub email: Option<String>,
    pub account_id: Option<String>,
    pub plan_type: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub endpoint: Option<String>,
    pub has_api_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRecord {
    pub id: String,
    pub name: String,
    pub note: String,
    pub source: ProfileSource,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub fingerprint: String,
    pub auth_content: String,
    pub config_content: String,
    pub summary: ProfileSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentConfigState {
    pub codex_home: String,
    pub auth_path: String,
    pub config_path: String,
    pub auth_exists: bool,
    pub config_exists: bool,
    pub updated_at: Option<DateTime<Utc>>,
    pub fingerprint: Option<String>,
    pub summary: Option<ProfileSummary>,
    pub auth_content: Option<String>,
    pub config_content: Option<String>,
    pub match_status: MatchStatus,
    pub matched_profile_id: Option<String>,
    pub matched_profile_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MatchStatus {
    Missing,
    Exact,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub codex_home: String,
    pub default_codex_home: String,
    pub profiles_dir: String,
    pub state_path: String,
    pub backups_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub profiles: Vec<ProfileRecord>,
    pub current: CurrentConfigState,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub name: String,
    pub note: Option<String>,
    pub auth_content: String,
    pub config_content: String,
    pub source: ProfileSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProfileInput {
    pub id: String,
    pub name: String,
    pub note: Option<String>,
    pub auth_content: String,
    pub config_content: String,
    pub source: ProfileSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureCurrentInput {
    pub name: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCodexHomeInput {
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchProfileResult {
    pub switched_at: DateTime<Utc>,
    pub backup_dir: String,
    pub profile_id: String,
    pub profile_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    codex_home_override: Option<String>,
    active_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProfileMeta {
    id: String,
    name: String,
    note: String,
    source: ProfileSource,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_used_at: Option<DateTime<Utc>>,
    fingerprint: String,
    summary: ProfileSummary,
}

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("文件系统操作失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 解析失败: {0}")]
    Json(#[from] serde_json::Error),
    #[error("SQLite 操作失败: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("TOML 解析失败: {0}")]
    TomlDe(#[from] toml::de::Error),
    #[error("TOML 序列化失败: {0}")]
    TomlSer(#[from] toml::ser::Error),
    #[error("{0}")]
    Message(String),
}

pub struct ProfileStore {
    app_data_dir: PathBuf,
    profiles_dir: PathBuf,
    backups_dir: PathBuf,
    state_path: PathBuf,
}

impl ProfileStore {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, StoreError> {
        let store = Self {
            profiles_dir: app_data_dir.join("profiles"),
            backups_dir: app_data_dir.join("backups"),
            state_path: app_data_dir.join("state.json"),
            app_data_dir,
        };
        store.ensure_storage()?;
        Ok(store)
    }

    pub fn load_snapshot(&self) -> Result<AppSnapshot, StoreError> {
        let mut state = self.read_state()?;
        self.repair_profile_configs()?;
        let codex_home = resolve_codex_home(&state)?;
        let profiles = self.read_profiles()?;
        let mut current = self.read_current_config(&codex_home, &profiles)?;

        if matches!(current.match_status, MatchStatus::Exact) {
            if state.active_profile_id != current.matched_profile_id {
                state.active_profile_id = current.matched_profile_id.clone();
                self.write_state(&state)?;
            }
        }

        if current.matched_profile_id.is_none() {
            if let Some(active_profile_id) = state.active_profile_id.as_ref() {
                if let Some(active_profile) = profiles.iter().find(|profile| &profile.id == active_profile_id) {
                    current.matched_profile_id = Some(active_profile.id.clone());
                    current.matched_profile_name = Some(active_profile.name.clone());
                }
            }
        }

        Ok(AppSnapshot {
            profiles,
            current,
            settings: AppSettings {
                codex_home: codex_home.display().to_string(),
                default_codex_home: default_codex_home()?.display().to_string(),
                profiles_dir: self.profiles_dir.display().to_string(),
                state_path: self.state_path.display().to_string(),
                backups_dir: self.backups_dir.display().to_string(),
            },
        })
    }

    pub fn create_profile(&self, payload: ProfileInput) -> Result<AppSnapshot, StoreError> {
        let record = build_profile_record(payload, None)?;
        self.write_profile(&record)?;
        self.load_snapshot()
    }

    pub fn capture_current_profile(
        &self,
        payload: CaptureCurrentInput,
    ) -> Result<AppSnapshot, StoreError> {
        let mut state = self.read_state()?;
        let codex_home = resolve_codex_home(&state)?;
        let current = self.read_current_files(&codex_home)?;

        let auth_content = current
            .auth_content
            .ok_or_else(|| StoreError::Message("当前缺少 auth.json，无法保存 profile。".into()))?;
        let config_content = current
            .config_content
            .ok_or_else(|| StoreError::Message("当前缺少 config.toml，无法保存 profile。".into()))?;

        let record = build_profile_record(
            ProfileInput {
                name: payload.name,
                note: payload.note,
                auth_content,
                config_content,
                source: ProfileSource::Captured,
            },
            None,
        )?;

        self.write_profile(&record)?;
        state.active_profile_id = Some(record.id.clone());
        self.write_state(&state)?;
        self.load_snapshot()
    }

    pub fn update_profile(&self, payload: UpdateProfileInput) -> Result<AppSnapshot, StoreError> {
        let profile_dir = self.profile_dir(&payload.id);
        if !profile_dir.exists() {
            return Err(StoreError::Message("找不到要更新的 profile。".into()));
        }

        let meta = self.read_profile_meta(&profile_dir)?;
        let record = build_profile_record(
            ProfileInput {
                name: payload.name,
                note: payload.note,
                auth_content: payload.auth_content,
                config_content: payload.config_content,
                source: payload.source,
            },
            Some((&payload.id, meta.created_at, meta.last_used_at)),
        )?;
        self.write_profile(&record)?;
        self.load_snapshot()
    }

    pub fn delete_profile(&self, profile_id: &str) -> Result<AppSnapshot, StoreError> {
        let mut state = self.read_state()?;
        let profile_dir = self.profile_dir(profile_id);
        if !profile_dir.exists() {
            return Err(StoreError::Message("找不到要删除的 profile。".into()));
        }

        fs::remove_dir_all(profile_dir)?;
        if state.active_profile_id.as_deref() == Some(profile_id) {
            state.active_profile_id = None;
            self.write_state(&state)?;
        }
        self.load_snapshot()
    }

    pub fn switch_profile(&self, profile_id: &str) -> Result<SwitchProfileResult, StoreError> {
        let mut state = self.read_state()?;
        self.repair_profile_configs()?;
        let codex_home = resolve_codex_home(&state)?;
        let profile_dir = self.profile_dir(profile_id);

        if !profile_dir.exists() {
            return Err(StoreError::Message("找不到要切换的 profile。".into()));
        }

        fs::create_dir_all(&codex_home)?;
        self.sync_current_profile_state(&codex_home, &mut state)?;

        let meta = self.read_profile_meta(&profile_dir)?;
        let auth_content = fs::read_to_string(profile_dir.join("auth.json"))?;
        let config_content =
            sanitize_profile_config_content(&fs::read_to_string(profile_dir.join("config.toml"))?)?;
        let backup_dir = self.backup_current_state(&codex_home)?;

        fs::write(codex_home.join("auth.json"), normalize_text(&auth_content))?;
        fs::write(codex_home.join("config.toml"), normalize_text(&config_content))?;
        sync_history_provider_tags(&codex_home, &config_content)?;

        let now = Utc::now();
        let mut record = build_profile_record(
            ProfileInput {
                name: meta.name,
                note: Some(meta.note),
                auth_content,
                config_content,
                source: meta.source,
            },
            Some((&meta.id, meta.created_at, meta.last_used_at)),
        )?;
        record.last_used_at = Some(now);
        self.write_profile(&record)?;
        state.active_profile_id = Some(record.id.clone());
        self.write_state(&state)?;

        Ok(SwitchProfileResult {
            switched_at: now,
            backup_dir: backup_dir.display().to_string(),
            profile_id: record.id,
            profile_name: record.name,
        })
    }

    pub fn set_codex_home(&self, payload: SetCodexHomeInput) -> Result<AppSnapshot, StoreError> {
        let mut state = self.read_state()?;
        state.codex_home_override = payload
            .path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        state.active_profile_id = None;
        self.write_state(&state)?;
        self.load_snapshot()
    }

    pub fn open_codex_home(&self) -> Result<(), StoreError> {
        let state = self.read_state()?;
        let codex_home = resolve_codex_home(&state)?;
        fs::create_dir_all(&codex_home)?;

        #[cfg(target_os = "windows")]
        {
            Command::new("explorer").arg(&codex_home).spawn()?;
            return Ok(());
        }

        #[cfg(target_os = "macos")]
        {
            Command::new("open").arg(&codex_home).spawn()?;
            return Ok(());
        }

        #[cfg(target_os = "linux")]
        {
            Command::new("xdg-open").arg(&codex_home).spawn()?;
            return Ok(());
        }

        #[allow(unreachable_code)]
        Err(StoreError::Message("当前平台暂不支持打开目录。".into()))
    }

    fn ensure_storage(&self) -> Result<(), StoreError> {
        fs::create_dir_all(&self.app_data_dir)?;
        fs::create_dir_all(&self.profiles_dir)?;
        fs::create_dir_all(&self.backups_dir)?;

        if !self.state_path.exists() {
            self.write_state(&PersistedState::default())?;
        }

        Ok(())
    }

    fn read_state(&self) -> Result<PersistedState, StoreError> {
        read_json_or_default(&self.state_path)
    }

    fn write_state(&self, state: &PersistedState) -> Result<(), StoreError> {
        fs::write(&self.state_path, serde_json::to_string_pretty(state)?)?;
        Ok(())
    }

    fn read_profiles(&self) -> Result<Vec<ProfileRecord>, StoreError> {
        let mut profiles = Vec::new();

        for entry in fs::read_dir(&self.profiles_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            let profile_dir = entry.path();
            let meta = match self.read_profile_meta(&profile_dir) {
                Ok(meta) => meta,
                Err(_) => continue,
            };

            let auth_content = fs::read_to_string(profile_dir.join("auth.json")).unwrap_or_default();
            let config_content =
                fs::read_to_string(profile_dir.join("config.toml")).unwrap_or_default();

            profiles.push(ProfileRecord {
                id: meta.id,
                name: meta.name,
                note: meta.note,
                source: meta.source,
                created_at: meta.created_at,
                updated_at: meta.updated_at,
                last_used_at: meta.last_used_at,
                fingerprint: meta.fingerprint,
                summary: meta.summary,
                auth_content,
                config_content,
            });
        }

        profiles.sort_by(|left, right| {
            let left_time = left.last_used_at.unwrap_or(left.updated_at);
            let right_time = right.last_used_at.unwrap_or(right.updated_at);
            right_time.cmp(&left_time)
        });

        Ok(profiles)
    }

    fn repair_profile_configs(&self) -> Result<(), StoreError> {
        for entry in fs::read_dir(&self.profiles_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            let profile_dir = entry.path();
            let meta = match self.read_profile_meta(&profile_dir) {
                Ok(meta) => meta,
                Err(_) => continue,
            };

            let auth_content = match fs::read_to_string(profile_dir.join("auth.json")) {
                Ok(contents) => contents,
                Err(_) => continue,
            };
            let config_content = match fs::read_to_string(profile_dir.join("config.toml")) {
                Ok(contents) => contents,
                Err(_) => continue,
            };
            let sanitized_config = match sanitize_profile_config_content(&config_content) {
                Ok(contents) => contents,
                Err(_) => continue,
            };

            if normalize_text(&config_content) == sanitized_config {
                continue;
            }

            let mut record = match build_profile_record(
                ProfileInput {
                    name: meta.name,
                    note: Some(meta.note),
                    auth_content,
                    config_content: sanitized_config,
                    source: meta.source,
                },
                Some((&meta.id, meta.created_at, meta.last_used_at)),
            ) {
                Ok(record) => record,
                Err(_) => continue,
            };

            record.updated_at = meta.updated_at;
            record.last_used_at = meta.last_used_at;
            self.write_profile(&record)?;
        }

        Ok(())
    }

    fn read_current_files(&self, codex_home: &Path) -> Result<CurrentConfigState, StoreError> {
        let auth_path = codex_home.join("auth.json");
        let config_path = codex_home.join("config.toml");
        let auth_exists = auth_path.exists();
        let config_exists = config_path.exists();

        if !auth_exists || !config_exists {
            return Ok(CurrentConfigState {
                codex_home: codex_home.display().to_string(),
                auth_path: auth_path.display().to_string(),
                config_path: config_path.display().to_string(),
                auth_exists,
                config_exists,
                updated_at: None,
                fingerprint: None,
                summary: None,
                auth_content: None,
                config_content: None,
                match_status: MatchStatus::Missing,
                matched_profile_id: None,
                matched_profile_name: None,
            });
        }

        let auth_content = fs::read_to_string(&auth_path)?;
        let config_content = fs::read_to_string(&config_path)?;
        let updated_at = latest_modified(&[&auth_path, &config_path])?;

        Ok(CurrentConfigState {
            codex_home: codex_home.display().to_string(),
            auth_path: auth_path.display().to_string(),
            config_path: config_path.display().to_string(),
            auth_exists,
            config_exists,
            updated_at,
            fingerprint: Some(fingerprint_for_pair(&auth_content, &config_content)),
            summary: summarize_pair(&auth_content, &config_content).ok(),
            auth_content: Some(auth_content),
            config_content: Some(config_content),
            match_status: MatchStatus::Unknown,
            matched_profile_id: None,
            matched_profile_name: None,
        })
    }

    fn read_current_config(
        &self,
        codex_home: &Path,
        profiles: &[ProfileRecord],
    ) -> Result<CurrentConfigState, StoreError> {
        let mut current = self.read_current_files(codex_home)?;

        if let Some(fingerprint) = current.fingerprint.clone() {
            if let Some(matched) = profiles.iter().find(|profile| profile.fingerprint == fingerprint) {
                current.match_status = MatchStatus::Exact;
                current.matched_profile_id = Some(matched.id.clone());
                current.matched_profile_name = Some(matched.name.clone());
            }
        }

        Ok(current)
    }

    fn write_profile(&self, record: &ProfileRecord) -> Result<(), StoreError> {
        let profile_dir = self.profile_dir(&record.id);
        fs::create_dir_all(&profile_dir)?;

        let meta = StoredProfileMeta {
            id: record.id.clone(),
            name: record.name.clone(),
            note: record.note.clone(),
            source: record.source.clone(),
            created_at: record.created_at,
            updated_at: record.updated_at,
            last_used_at: record.last_used_at,
            fingerprint: record.fingerprint.clone(),
            summary: record.summary.clone(),
        };

        fs::write(profile_dir.join("meta.json"), serde_json::to_string_pretty(&meta)?)?;
        fs::write(profile_dir.join("auth.json"), normalize_text(&record.auth_content))?;
        fs::write(
            profile_dir.join("config.toml"),
            normalize_text(&record.config_content),
        )?;
        Ok(())
    }

    fn read_profile_meta(&self, profile_dir: &Path) -> Result<StoredProfileMeta, StoreError> {
        let raw = fs::read_to_string(profile_dir.join("meta.json"))?;
        Ok(serde_json::from_str::<StoredProfileMeta>(&raw)?)
    }

    fn profile_dir(&self, profile_id: &str) -> PathBuf {
        self.profiles_dir.join(profile_id)
    }

    fn sync_current_profile_state(
        &self,
        codex_home: &Path,
        state: &mut PersistedState,
    ) -> Result<(), StoreError> {
        let profiles = self.read_profiles()?;
        let current = self.read_current_files(codex_home)?;
        let exact_profile_id = current.fingerprint.as_ref().and_then(|fingerprint| {
            profiles
                .iter()
                .find(|profile| &profile.fingerprint == fingerprint)
                .map(|profile| profile.id.clone())
        });
        let current_profile_id = exact_profile_id.or_else(|| state.active_profile_id.clone());

        let Some(profile_id) = current_profile_id else {
            return Ok(());
        };

        let profile_dir = self.profile_dir(&profile_id);
        if !profile_dir.exists() {
            state.active_profile_id = None;
            return Ok(());
        }

        let Some(auth_content) = current.auth_content else {
            return Ok(());
        };
        let Some(config_content) = current.config_content else {
            return Ok(());
        };

        let meta = self.read_profile_meta(&profile_dir)?;
        let stored_config = fs::read_to_string(profile_dir.join("config.toml")).unwrap_or_default();
        let merged_config_content = merge_config_contents(&stored_config, &config_content)?;
        let now = Utc::now();
        let mut record = build_profile_record(
            ProfileInput {
                name: meta.name,
                note: Some(meta.note),
                auth_content,
                config_content: merged_config_content,
                source: meta.source,
            },
            Some((&profile_id, meta.created_at, meta.last_used_at)),
        )?;
        record.last_used_at = Some(now);
        self.write_profile(&record)?;
        state.active_profile_id = Some(profile_id);
        Ok(())
    }

    fn backup_current_state(&self, codex_home: &Path) -> Result<PathBuf, StoreError> {
        let backup_dir = self
            .backups_dir
            .join(format!("switch-{}-{}", Utc::now().format("%Y%m%d-%H%M%S"), short_id()));
        fs::create_dir_all(&backup_dir)?;

        let auth_path = codex_home.join("auth.json");
        let config_path = codex_home.join("config.toml");

        if auth_path.exists() {
            fs::copy(&auth_path, backup_dir.join("auth.json"))?;
        }

        if config_path.exists() {
            fs::copy(&config_path, backup_dir.join("config.toml"))?;
        }

        fs::write(
            backup_dir.join("meta.json"),
            serde_json::to_string_pretty(&serde_json::json!({
                "codexHome": codex_home.display().to_string(),
                "createdAt": Utc::now(),
            }))?,
        )?;

        Ok(backup_dir)
    }
}

fn merge_config_contents(base_config: &str, current_config: &str) -> Result<String, StoreError> {
    let mut base = toml::from_str::<TomlValue>(base_config).unwrap_or(TomlValue::Table(Default::default()));
    let current = toml::from_str::<TomlValue>(current_config)?;
    merge_toml_values(&mut base, &current);
    sanitize_profile_config_content(&toml::to_string(&base)?)
}

fn merge_toml_values(base: &mut TomlValue, overlay: &TomlValue) {
    match (base, overlay) {
        (TomlValue::Table(base_table), TomlValue::Table(overlay_table)) => {
            for (key, overlay_value) in overlay_table {
                if let Some(base_value) = base_table.get_mut(key) {
                    merge_toml_values(base_value, overlay_value);
                } else {
                    base_table.insert(key.clone(), overlay_value.clone());
                }
            }
        }
        (base_value, overlay_value) => {
            *base_value = overlay_value.clone();
        }
    }
}

fn sync_history_provider_tags(codex_home: &Path, config_content: &str) -> Result<(), StoreError> {
    let Some(target_provider) = detect_model_provider(config_content)? else {
        return Ok(());
    };

    sync_sqlite_thread_providers(codex_home, &target_provider)?;

    for session_root in ["sessions", "archived_sessions"] {
        let root = codex_home.join(session_root);
        if !root.exists() {
            continue;
        }

        let mut files = Vec::new();
        collect_session_files(&root, &mut files)?;
        for file in files {
            rewrite_session_file_provider(&file, &target_provider)?;
        }
    }

    Ok(())
}

fn collect_session_files(path: &Path, files: &mut Vec<PathBuf>) -> Result<(), StoreError> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            collect_session_files(&entry_path, files)?;
            continue;
        }

        if entry_path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("jsonl"))
        {
            files.push(entry_path);
        }
    }

    Ok(())
}

fn rewrite_session_file_provider(session_path: &Path, target_provider: &str) -> Result<(), StoreError> {
    let raw = fs::read_to_string(session_path)?;
    let Some(rewritten) = rewrite_session_provider(&raw, target_provider)? else {
        return Ok(());
    };

    fs::write(session_path, rewritten)?;
    Ok(())
}

fn rewrite_session_provider(raw: &str, target_provider: &str) -> Result<Option<String>, StoreError> {
    let normalized = raw.replace("\r\n", "\n");
    let mut lines = normalized
        .lines()
        .map(std::string::ToString::to_string)
        .collect::<Vec<_>>();

    let Some(first_non_empty_index) = lines.iter().position(|line| !line.trim().is_empty()) else {
        return Ok(None);
    };

    let mut value = match serde_json::from_str::<JsonValue>(&lines[first_non_empty_index]) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };

    let Some(payload) = value.get_mut("payload").and_then(|payload| payload.as_object_mut()) else {
        return Ok(None);
    };
    let Some(current_provider) = payload.get("model_provider").and_then(|value| value.as_str()) else {
        return Ok(None);
    };
    if current_provider == target_provider {
        return Ok(None);
    }

    payload.insert(
        "model_provider".into(),
        JsonValue::String(target_provider.to_string()),
    );
    lines[first_non_empty_index] = serde_json::to_string(&value)?;

    let rewritten = format!("{}\n", lines.join("\n").trim_end());
    Ok(Some(rewritten))
}

fn sync_sqlite_thread_providers(codex_home: &Path, target_provider: &str) -> Result<(), StoreError> {
    for state_db in discover_state_databases(codex_home)? {
        let connection = Connection::open_with_flags(
            &state_db,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        connection.busy_timeout(std::time::Duration::from_millis(750))?;

        if !has_table(&connection, "threads")? || !has_column(&connection, "threads", "model_provider")? {
            continue;
        }

        connection.execute(
            "UPDATE threads SET model_provider = ?1 WHERE COALESCE(model_provider, '') <> ?1",
            [target_provider],
        )?;
    }

    Ok(())
}

fn detect_model_provider(config_content: &str) -> Result<Option<String>, StoreError> {
    let config = toml::from_str::<TomlValue>(config_content)?;

    if let Some(provider) = get_toml_str(&config, "model_provider") {
        return Ok(Some(provider));
    }

    let fallback = config
        .get("model_providers")
        .and_then(|value| value.as_table())
        .and_then(|table| table.keys().next().cloned());

    Ok(fallback)
}

fn discover_state_databases(codex_home: &Path) -> Result<Vec<PathBuf>, StoreError> {
    let mut databases = Vec::new();

    for entry in fs::read_dir(codex_home)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }

        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        if file_name == "state.sqlite"
            || (file_name.starts_with("state_") && file_name.ends_with(".sqlite"))
        {
            databases.push(path);
        }
    }

    databases.sort();
    Ok(databases)
}

fn has_table(connection: &Connection, table_name: &str) -> Result<bool, StoreError> {
    let mut statement = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1")?;
    Ok(statement.exists([table_name])?)
}

fn has_column(connection: &Connection, table_name: &str, column_name: &str) -> Result<bool, StoreError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table_name})"))?;
    let mut rows = statement.query([])?;

    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column_name {
            return Ok(true);
        }
    }

    Ok(false)
}

fn sanitize_profile_config_content(config_content: &str) -> Result<String, StoreError> {
    let normalized = normalize_text(config_content);
    let mut config = toml::from_str::<TomlValue>(&normalized)
        .map_err(|error| StoreError::Message(format!("config.toml 不是合法的 TOML: {error}")))?;

    if !repair_reserved_openai_provider(&mut config) {
        return Ok(normalized);
    }

    Ok(normalize_text(&toml::to_string(&config)?))
}

fn repair_reserved_openai_provider(config: &mut TomlValue) -> bool {
    let Some(root) = config.as_table_mut() else {
        return false;
    };
    let Some(providers) = root
        .get_mut("model_providers")
        .and_then(|value| value.as_table_mut())
    else {
        return false;
    };
    let Some(mut openai_provider) = providers.remove("openai") else {
        return false;
    };

    let replacement = next_available_provider_key(providers, "openai_custom");
    if let Some(provider_table) = openai_provider.as_table_mut() {
        if provider_table
            .get("name")
            .and_then(|value| value.as_str())
            .is_some_and(|value| value == "openai")
        {
            provider_table.insert("name".into(), TomlValue::String(replacement.clone()));
        }
    }
    providers.insert(replacement.clone(), openai_provider);

    if root
        .get("model_provider")
        .and_then(|value| value.as_str())
        .is_some_and(|value| value == "openai")
    {
        root.insert("model_provider".into(), TomlValue::String(replacement));
    }

    true
}

fn next_available_provider_key(
    providers: &toml::map::Map<String, TomlValue>,
    preferred: &str,
) -> String {
    if !providers.contains_key(preferred) {
        return preferred.to_string();
    }

    let mut index = 2;
    loop {
        let candidate = format!("{preferred}_{index}");
        if !providers.contains_key(&candidate) {
            return candidate;
        }
        index += 1;
    }
}

fn read_json_or_default<T>(path: &Path) -> Result<T, StoreError>
where
    T: DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }

    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str::<T>(&raw)?)
}

fn build_profile_record(
    payload: ProfileInput,
    existing: Option<(&str, DateTime<Utc>, Option<DateTime<Utc>>)>,
) -> Result<ProfileRecord, StoreError> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(StoreError::Message("Profile 名称不能为空。".into()));
    }

    validate_auth_json(&payload.auth_content)?;
    validate_config_toml(&payload.config_content)?;

    let now = Utc::now();
    let auth_content = normalize_text(&payload.auth_content);
    let config_content = sanitize_profile_config_content(&payload.config_content)?;
    let summary = summarize_pair(&auth_content, &config_content)?;
    let fingerprint = fingerprint_for_pair(&auth_content, &config_content);

    let (id, created_at, last_used_at) = existing
        .map(|(id, created_at, last_used_at)| (id.to_string(), created_at, last_used_at))
        .unwrap_or_else(|| (Uuid::new_v4().to_string(), now, None));

    Ok(ProfileRecord {
        id,
        name: name.to_string(),
        note: payload.note.unwrap_or_default().trim().to_string(),
        source: payload.source,
        created_at,
        updated_at: now,
        last_used_at,
        fingerprint,
        auth_content,
        config_content,
        summary,
    })
}

fn resolve_codex_home(state: &PersistedState) -> Result<PathBuf, StoreError> {
    Ok(state
        .codex_home_override
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or(default_codex_home()?))
}

fn default_codex_home() -> Result<PathBuf, StoreError> {
    let home = dirs::home_dir()
        .ok_or_else(|| StoreError::Message("无法读取当前用户主目录。".into()))?;
    Ok(home.join(".codex"))
}

fn validate_auth_json(contents: &str) -> Result<(), StoreError> {
    serde_json::from_str::<JsonValue>(contents)
        .map(|_| ())
        .map_err(|error| StoreError::Message(format!("auth.json 不是合法的 JSON: {error}")))
}

fn validate_config_toml(contents: &str) -> Result<(), StoreError> {
    if contents.trim().is_empty() {
        return Err(StoreError::Message("config.toml 不能为空。".into()));
    }

    toml::from_str::<TomlValue>(contents)
        .map(|_| ())
        .map_err(|error| StoreError::Message(format!("config.toml 不是合法的 TOML: {error}")))
}

fn summarize_pair(auth_content: &str, config_content: &str) -> Result<ProfileSummary, StoreError> {
    let auth = serde_json::from_str::<JsonValue>(auth_content).map_err(|error| {
        StoreError::Message(format!("auth.json 不是合法的 JSON: {error}"))
    })?;
    let config = toml::from_str::<TomlValue>(config_content).map_err(|error| {
        StoreError::Message(format!("config.toml 不是合法的 TOML: {error}"))
    })?;

    let access_payload = get_token_payload(&auth, "access_token");
    let id_payload = get_token_payload(&auth, "id_token");
    let access_auth = access_payload
        .as_ref()
        .and_then(|value| value.get("https://api.openai.com/auth"));
    let access_profile = access_payload
        .as_ref()
        .and_then(|value| value.get("https://api.openai.com/profile"));
    let id_auth = id_payload
        .as_ref()
        .and_then(|value| value.get("https://api.openai.com/auth"));

    let auth_mode = get_json_str(&auth, "auth_mode").unwrap_or_else(|| "unknown".into());
    let has_api_key = get_json_str(&auth, "OPENAI_API_KEY")
        .map(|value| !value.is_empty())
        .unwrap_or(false);
    let auth_label = if auth_mode == "chatgpt" || auth.get("tokens").is_some() {
        "官方 OAuth".to_string()
    } else if has_api_key {
        "API Key".to_string()
    } else {
        "未识别".to_string()
    };

    Ok(ProfileSummary {
        auth_label,
        auth_mode,
        email: access_profile
            .and_then(|value| get_nested_json_str(value, "email"))
            .or_else(|| id_payload.as_ref().and_then(|value| get_nested_json_str(value, "email")))
            .or_else(|| get_json_str(&auth, "email")),
        account_id: auth
            .get("tokens")
            .and_then(|tokens| tokens.get("account_id"))
            .and_then(json_str)
            .or_else(|| access_auth.and_then(|value| get_nested_json_str(value, "chatgpt_account_id")))
            .or_else(|| id_auth.and_then(|value| get_nested_json_str(value, "chatgpt_account_id"))),
        plan_type: access_auth
            .and_then(|value| get_nested_json_str(value, "chatgpt_plan_type"))
            .or_else(|| id_auth.and_then(|value| get_nested_json_str(value, "chatgpt_plan_type"))),
        model: get_toml_str(&config, "model"),
        reasoning_effort: get_toml_str(&config, "model_reasoning_effort"),
        endpoint: get_toml_str(&config, "api_base_url")
            .or_else(|| get_toml_str(&config, "base_url"))
            .or_else(|| get_toml_str(&config, "chatgpt_base_url"))
            .or_else(|| get_toml_str(&config, "api_url")),
        has_api_key,
    })
}

fn get_token_payload(auth: &JsonValue, key: &str) -> Option<JsonValue> {
    auth.get("tokens")
        .and_then(|tokens| tokens.get(key))
        .and_then(json_str)
        .and_then(|token| decode_jwt_payload(&token))
}

fn decode_jwt_payload(token: &str) -> Option<JsonValue> {
    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice::<JsonValue>(&decoded).ok()
}

fn json_str(value: &JsonValue) -> Option<String> {
    value.as_str().map(|value| value.trim().to_string()).filter(|value| !value.is_empty())
}

fn get_json_str(value: &JsonValue, key: &str) -> Option<String> {
    value.get(key).and_then(json_str)
}

fn get_nested_json_str(value: &JsonValue, key: &str) -> Option<String> {
    value.get(key).and_then(json_str)
}

fn get_toml_str(value: &TomlValue, key: &str) -> Option<String> {
    value.get(key)
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn fingerprint_for_pair(auth_content: &str, config_content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(normalize_text(auth_content));
    hasher.update("\n---codex-profile-divider---\n");
    hasher.update(normalize_text(config_content));
    format!("{:x}", hasher.finalize())
}

fn normalize_text(value: &str) -> String {
    let normalized = value.replace("\r\n", "\n");
    format!("{}\n", normalized.trim_end())
}

fn latest_modified(paths: &[&Path]) -> Result<Option<DateTime<Utc>>, StoreError> {
    let mut timestamps = Vec::new();

    for path in paths {
        if !path.exists() {
            continue;
        }

        let modified = fs::metadata(path)?.modified()?;
        timestamps.push(DateTime::<Utc>::from(modified));
    }

    Ok(timestamps.into_iter().max())
}

fn short_id() -> String {
    Uuid::new_v4().simple().to_string()[..8].to_string()
}
