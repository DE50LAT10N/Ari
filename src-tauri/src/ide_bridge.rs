use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const PROTOCOL_VERSION: u64 = 1;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_HEADER_BYTES: usize = 32 * 1024;
const MAX_CONNECTIONS: usize = 16;
const MAX_CLOCK_SKEW_MS: u64 = 30_000;
const MAX_MESSAGE_AGE_MS: u64 = 5 * 60_000;
const PAIRING_TTL_MS: u64 = 2 * 60_000;
const AUTH_SESSION_TTL_MS: u64 = 8 * 60 * 60_000;
const CONNECTION_FILE_NAME: &str = "ide-bridge-connection.json";
const UPDATE_EVENT: &str = "ari://ide-bridge-updated";

type SharedBridge = Arc<Mutex<BridgeCore>>;

struct BridgeRuntime {
    core: SharedBridge,
    running: Arc<std::sync::atomic::AtomicBool>,
}

static BRIDGE: Lazy<Mutex<Option<BridgeRuntime>>> = Lazy::new(|| Mutex::new(None));

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeBridgeStatus {
    protocol_version: u64,
    running: bool,
    connection: String,
    endpoint: Option<String>,
    session_id: Option<String>,
    expires_at: Option<u64>,
    client: Option<String>,
    client_instance_id: Option<String>,
    last_sequence: Option<u64>,
    latest_workspace_id: Option<String>,
    latest_revision: Option<u64>,
    last_message_at: Option<u64>,
    connection_file: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionFile<'a> {
    protocol_version: u64,
    endpoint: &'a str,
    session_id: &'a str,
    token: &'a str,
    expires_at: u64,
}

#[derive(Clone, Debug)]
struct ClientIdentity {
    kind: String,
    instance_id: String,
}

struct BridgeCore {
    endpoint: String,
    session_id: String,
    token: String,
    pairing_expires_at: u64,
    auth_expires_at: Option<u64>,
    connection_file: Option<String>,
    paired_client: Option<ClientIdentity>,
    last_sequences: HashMap<String, u64>,
    workspace_revisions: HashMap<String, u64>,
    latest_snapshot: Option<Value>,
    latest_workspace_id: Option<String>,
    latest_revision: Option<u64>,
    last_message_at: Option<u64>,
    next_server_message_id: u64,
}

struct ProcessOutcome {
    response: Value,
    update: Option<Value>,
}

#[derive(Debug, PartialEq, Eq)]
enum HttpReadError {
    BadRequest(String),
    PayloadTooLarge,
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

struct ActiveConnection(Arc<AtomicUsize>);

impl Drop for ActiveConnection {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

impl BridgeCore {
    fn new(
        endpoint: String,
        session_id: String,
        token: String,
        pairing_expires_at: u64,
        connection_file: Option<String>,
    ) -> Self {
        Self {
            endpoint,
            session_id,
            token,
            pairing_expires_at,
            auth_expires_at: None,
            connection_file,
            paired_client: None,
            last_sequences: HashMap::new(),
            workspace_revisions: HashMap::new(),
            latest_snapshot: None,
            latest_workspace_id: None,
            latest_revision: None,
            last_message_at: None,
            next_server_message_id: 0,
        }
    }

    fn status(&self, now: u64) -> IdeBridgeStatus {
        let expires_at = self.auth_expires_at.unwrap_or(self.pairing_expires_at);
        let connection = if now >= expires_at {
            "expired"
        } else if self.paired_client.is_some() {
            "paired"
        } else {
            "waiting"
        };
        let paired = self.paired_client.as_ref();
        IdeBridgeStatus {
            protocol_version: PROTOCOL_VERSION,
            running: true,
            connection: connection.to_string(),
            endpoint: Some(self.endpoint.clone()),
            session_id: Some(self.session_id.clone()),
            expires_at: Some(expires_at),
            client: paired.map(|client| client.kind.clone()),
            client_instance_id: paired.map(|client| client.instance_id.clone()),
            last_sequence: paired
                .and_then(|client| self.last_sequences.get(&client.instance_id).copied()),
            latest_workspace_id: self.latest_workspace_id.clone(),
            latest_revision: self.latest_revision,
            last_message_at: self.last_message_at,
            connection_file: if connection == "waiting" {
                self.connection_file.clone()
            } else {
                None
            },
        }
    }

    fn process(&mut self, message: Value, now: u64) -> ProcessOutcome {
        let reply_to = bounded_string(message.get("messageId"), 256);
        let fail = |this: &mut Self, code: &str, text: &str, retryable: bool| ProcessOutcome {
            response: this.error(reply_to.as_deref(), code, text, retryable, now),
            update: None,
        };

        let Some(object) = message.as_object() else {
            return fail(
                self,
                "INVALID_MESSAGE",
                "Message must be a JSON object",
                false,
            );
        };
        if object.get("protocolVersion").and_then(Value::as_u64) != Some(PROTOCOL_VERSION) {
            return fail(
                self,
                "INVALID_MESSAGE",
                "Unsupported IDE bridge protocol version",
                false,
            );
        }
        let Some(message_id) = bounded_string(object.get("messageId"), 256) else {
            return fail(self, "INVALID_MESSAGE", "Message id is malformed", false);
        };
        let Some(sequence) = object.get("sequence").and_then(Value::as_u64) else {
            return fail(
                self,
                "INVALID_MESSAGE",
                "Message sequence is malformed",
                false,
            );
        };
        let Some(sent_at) = object.get("sentAt").and_then(Value::as_u64) else {
            return fail(
                self,
                "INVALID_MESSAGE",
                "Message timestamp is malformed",
                false,
            );
        };
        let Some(message_type) = bounded_string(object.get("type"), 64) else {
            return fail(self, "INVALID_MESSAGE", "Message type is malformed", false);
        };
        let Some(auth) = object.get("auth").and_then(Value::as_object) else {
            return fail(
                self,
                "UNAUTHORIZED",
                "IDE bridge credentials are missing",
                false,
            );
        };
        let Some(received_session_id) = bounded_string(auth.get("sessionId"), 256) else {
            return fail(
                self,
                "UNAUTHORIZED",
                "IDE bridge credentials are malformed",
                false,
            );
        };
        let Some(received_token) = bounded_string(auth.get("token"), 512) else {
            return fail(
                self,
                "UNAUTHORIZED",
                "IDE bridge credentials are malformed",
                false,
            );
        };

        let active_expires_at = self.auth_expires_at.unwrap_or(self.pairing_expires_at);
        if now >= active_expires_at {
            return fail(
                self,
                "SESSION_EXPIRED",
                "IDE pairing session expired",
                false,
            );
        }
        let session_matches = constant_time_equal(&received_session_id, &self.session_id);
        let token_matches = constant_time_equal(&received_token, &self.token);
        if !(session_matches & token_matches) {
            return fail(
                self,
                "UNAUTHORIZED",
                "IDE bridge credentials were rejected",
                false,
            );
        }
        if sent_at > now.saturating_add(MAX_CLOCK_SKEW_MS)
            || now.saturating_sub(sent_at) > MAX_MESSAGE_AGE_MS
        {
            return fail(
                self,
                "REPLAYED_MESSAGE",
                "IDE message timestamp is stale",
                false,
            );
        }

        let client_instance_id = if message_type == "hello" {
            let Some(value) = bounded_string(object.get("clientInstanceId"), 256) else {
                return fail(
                    self,
                    "INVALID_MESSAGE",
                    "Hello client id is malformed",
                    false,
                );
            };
            value
        } else if let Some(client) = self.paired_client.as_ref() {
            client.instance_id.clone()
        } else {
            return fail(
                self,
                "CLIENT_NOT_PAIRED",
                "Send an authenticated hello first",
                true,
            );
        };

        if self
            .last_sequences
            .get(&client_instance_id)
            .is_some_and(|last| sequence <= *last)
        {
            return fail(
                self,
                "REPLAYED_MESSAGE",
                "IDE message sequence was already used",
                false,
            );
        }

        match message_type.as_str() {
            "hello" => {
                let Some(client_kind) = bounded_string(object.get("client"), 32) else {
                    return fail(self, "INVALID_MESSAGE", "Hello client is malformed", false);
                };
                let capability_keys = [
                    "snapshots",
                    "activeFile",
                    "selections",
                    "unsavedBuffers",
                    "diagnostics",
                    "git",
                    "tests",
                ];
                let capabilities = object.get("capabilities").and_then(Value::as_object);
                if !matches!(
                    client_kind.as_str(),
                    "vscode" | "jetbrains" | "terminal" | "test"
                ) || capabilities
                    .and_then(|value| value.get("snapshots"))
                    .and_then(Value::as_bool)
                    != Some(true)
                    || !capabilities.is_some_and(|value| {
                        capability_keys
                            .iter()
                            .all(|key| value.get(*key).and_then(Value::as_bool).is_some())
                    })
                {
                    return fail(self, "INVALID_MESSAGE", "Hello payload is malformed", false);
                }
                if self
                    .paired_client
                    .as_ref()
                    .is_some_and(|client| client.instance_id != client_instance_id)
                {
                    return fail(
                        self,
                        "UNAUTHORIZED",
                        "Pairing session is already in use",
                        false,
                    );
                }
                if let Err(error) = self.retire_connection_file() {
                    log::warn!("IDE Bridge could not retire pairing file: {error}");
                    return fail(
                        self,
                        "UNAUTHORIZED",
                        "Pairing secret could not be retired",
                        true,
                    );
                }
                let auth_expires_at = now.saturating_add(AUTH_SESSION_TTL_MS);
                self.auth_expires_at = Some(
                    self.auth_expires_at
                        .map_or(auth_expires_at, |current| current.max(auth_expires_at)),
                );
                self.paired_client = Some(ClientIdentity {
                    kind: client_kind,
                    instance_id: client_instance_id.clone(),
                });
                self.last_sequences
                    .insert(client_instance_id.clone(), sequence);
                self.last_message_at = Some(now);
                log::info!(
                    "IDE Bridge paired with {} client; session expires in {}s",
                    self.paired_client
                        .as_ref()
                        .map(|client| client.kind.as_str())
                        .unwrap_or("unknown"),
                    self.auth_expires_at.unwrap_or(now).saturating_sub(now) / 1_000
                );
                ProcessOutcome {
                    response: json!({
                        "protocolVersion": PROTOCOL_VERSION,
                        "type": "welcome",
                        "messageId": self.next_message_id(now),
                        "replyTo": message_id,
                        "sentAt": now,
                        "sessionId": self.session_id,
                        "expiresAt": self.auth_expires_at,
                        "acceptedClientInstanceId": client_instance_id,
                    }),
                    update: Some(json!({
                        "protocolVersion": PROTOCOL_VERSION,
                        "type": "hello",
                        "client": self.paired_client.as_ref().map(|client| &client.kind),
                        "clientInstanceId": self.paired_client.as_ref().map(|client| &client.instance_id),
                        "receivedAt": now,
                    })),
                }
            }
            "snapshot.publish" => {
                let Some(snapshot) = object.get("snapshot") else {
                    return fail(self, "INVALID_SNAPSHOT", "Snapshot is missing", false);
                };
                let snapshot = snapshot.clone();
                let (workspace_id, revision) = match self.inspect_snapshot(&snapshot, now) {
                    Ok(value) => value,
                    Err((code, text, retryable)) => {
                        let expected_revision = snapshot
                            .get("workspaceId")
                            .and_then(Value::as_str)
                            .and_then(|workspace_id| {
                                self.workspace_revisions.get(workspace_id).copied()
                            });
                        let mut outcome = fail(self, code, text, retryable);
                        if code == "STALE_REVISION" {
                            if let Some(expected_revision) = expected_revision {
                                outcome.response["expectedRevision"] = json!(expected_revision);
                            }
                        }
                        return outcome;
                    }
                };
                let diagnostics_count = snapshot
                    .get("diagnostics")
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len);
                let tests_count = snapshot
                    .get("recentTests")
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len);
                let has_active_editor = snapshot
                    .get("activeEditor")
                    .is_some_and(|value| !value.is_null());
                let active_buffer_chars = snapshot
                    .get("activeEditor")
                    .and_then(|editor| editor.get("unsavedBuffer"))
                    .and_then(|buffer| buffer.get("value"))
                    .and_then(Value::as_str)
                    .map_or(0, |value| value.chars().count());
                let selection_chars = snapshot
                    .get("activeEditor")
                    .and_then(|editor| editor.get("selection"))
                    .and_then(|selection| selection.get("text"))
                    .and_then(Value::as_str)
                    .map_or(0, |value| value.chars().count());
                self.commit_snapshot(snapshot, &workspace_id, revision);
                self.last_sequences.insert(client_instance_id, sequence);
                self.last_message_at = Some(now);
                log::info!(
                    "IDE Bridge accepted snapshot revision {revision}; active_editor={has_active_editor}, buffer_chars={active_buffer_chars}, selection_chars={selection_chars}, diagnostics={diagnostics_count}, tests={tests_count}"
                );
                ProcessOutcome {
                    response: self.ack(&message_id, sequence, Some(revision), now),
                    update: Some(update_payload(
                        "snapshot.publish",
                        &workspace_id,
                        revision,
                        now,
                    )),
                }
            }
            "event.publish" => {
                let Some(event) = object.get("event").and_then(Value::as_object) else {
                    return fail(self, "INVALID_MESSAGE", "IDE event is malformed", false);
                };
                let Some(kind) = bounded_string(event.get("kind"), 64) else {
                    return fail(
                        self,
                        "INVALID_MESSAGE",
                        "IDE event kind is malformed",
                        false,
                    );
                };
                if !is_event_kind(&kind) {
                    return fail(self, "INVALID_MESSAGE", "IDE event kind is unknown", false);
                }
                let Some(workspace_id) = bounded_string(event.get("workspaceId"), 256) else {
                    return fail(
                        self,
                        "INVALID_MESSAGE",
                        "IDE workspace id is malformed",
                        false,
                    );
                };
                let Some(revision) = event.get("revision").and_then(Value::as_u64) else {
                    return fail(
                        self,
                        "INVALID_MESSAGE",
                        "IDE event revision is malformed",
                        false,
                    );
                };
                if event
                    .get("uri")
                    .is_some_and(|uri| bounded_string(Some(uri), 4096).is_none())
                {
                    return fail(self, "INVALID_MESSAGE", "IDE event URI is malformed", false);
                }

                let snapshot_to_commit = if let Some(snapshot) = object.get("snapshot") {
                    let snapshot = snapshot.clone();
                    let (snapshot_workspace, snapshot_revision) = match self
                        .inspect_snapshot(&snapshot, now)
                    {
                        Ok(value) => value,
                        Err((code, text, retryable)) => {
                            let expected_revision =
                                self.workspace_revisions.get(&workspace_id).copied();
                            let mut outcome = fail(self, code, text, retryable);
                            if code == "STALE_REVISION" {
                                if let Some(expected_revision) = expected_revision {
                                    outcome.response["expectedRevision"] = json!(expected_revision);
                                }
                            }
                            return outcome;
                        }
                    };
                    if snapshot_workspace != workspace_id || snapshot_revision != revision {
                        return fail(
                            self,
                            "INVALID_SNAPSHOT",
                            "Event and snapshot revisions do not match",
                            false,
                        );
                    }
                    Some(snapshot)
                } else {
                    if self
                        .workspace_revisions
                        .get(&workspace_id)
                        .is_some_and(|current| revision < *current)
                    {
                        let expected_revision = self.workspace_revisions[&workspace_id];
                        let mut outcome =
                            fail(self, "STALE_REVISION", "Event revision is stale", false);
                        outcome.response["expectedRevision"] = json!(expected_revision);
                        return outcome;
                    }
                    None
                };

                if kind == "workspace.closed" {
                    if snapshot_to_commit.is_some() {
                        return fail(
                            self,
                            "INVALID_SNAPSHOT",
                            "Workspace close events must not include a snapshot",
                            false,
                        );
                    }
                    if self.latest_snapshot.is_some()
                        && (self.latest_workspace_id.as_deref() != Some(workspace_id.as_str())
                            || self.latest_revision != Some(revision))
                    {
                        return fail(
                            self,
                            "STALE_REVISION",
                            "Workspace close event does not match the accepted snapshot",
                            true,
                        );
                    }
                    self.clear_workspace(&workspace_id);
                } else {
                    let Some(snapshot) = snapshot_to_commit.as_ref() else {
                        return fail(
                            self,
                            "INVALID_SNAPSHOT",
                            "IDE state events require a complete snapshot",
                            true,
                        );
                    };
                    if event.get("uri").is_some() && !event_uri_has_consent(&kind, snapshot) {
                        return fail(
                            self,
                            "INVALID_SNAPSHOT",
                            "IDE event URI was included without source consent",
                            false,
                        );
                    }
                }

                if let Some(snapshot) = snapshot_to_commit {
                    self.commit_snapshot(snapshot, &workspace_id, revision);
                }
                self.last_sequences.insert(client_instance_id, sequence);
                self.last_message_at = Some(now);
                ProcessOutcome {
                    response: self.ack(&message_id, sequence, Some(revision), now),
                    update: Some(update_payload(&kind, &workspace_id, revision, now)),
                }
            }
            _ => fail(
                self,
                "INVALID_MESSAGE",
                "Unknown IDE bridge message type",
                false,
            ),
        }
    }

    fn inspect_snapshot(
        &self,
        snapshot: &Value,
        now: u64,
    ) -> Result<(String, u64), (&'static str, &'static str, bool)> {
        let Some(object) = snapshot.as_object() else {
            return Err(("INVALID_SNAPSHOT", "Snapshot must be an object", false));
        };
        let Some(workspace_id) = bounded_string(object.get("workspaceId"), 256) else {
            return Err((
                "INVALID_SNAPSHOT",
                "Snapshot workspace id is malformed",
                false,
            ));
        };
        if bounded_string(object.get("projectId"), 256).is_none()
            || !object
                .get("roots")
                .and_then(Value::as_array)
                .is_some_and(|roots| {
                    roots.len() <= 20
                        && roots.iter().all(|root| {
                            root.as_object().is_some_and(|root| {
                                bounded_string(root.get("uri"), 4096).is_some()
                                    && bounded_string(root.get("name"), 256).is_some()
                            })
                        })
                })
        {
            return Err((
                "INVALID_SNAPSHOT",
                "Snapshot project or roots are malformed",
                false,
            ));
        }
        let Some(revision) = object.get("revision").and_then(Value::as_u64) else {
            return Err(("INVALID_SNAPSHOT", "Snapshot revision is malformed", false));
        };
        if revision == 0
            || object
                .get("parentRevision")
                .and_then(Value::as_u64)
                .is_some_and(|parent| parent >= revision)
        {
            return Err((
                "INVALID_SNAPSHOT",
                "Snapshot revision chain is malformed",
                false,
            ));
        }
        let Some(captured_at) = object.get("capturedAt").and_then(Value::as_u64) else {
            return Err(("INVALID_SNAPSHOT", "Snapshot timestamp is malformed", false));
        };
        let Some(expires_at) = object.get("expiresAt").and_then(Value::as_u64) else {
            return Err(("INVALID_SNAPSHOT", "Snapshot expiry is malformed", false));
        };
        if captured_at > now.saturating_add(MAX_CLOCK_SKEW_MS)
            || expires_at <= captured_at
            || expires_at.saturating_sub(captured_at) > 5 * 60_000
            || expires_at <= now
        {
            return Err(("INVALID_SNAPSHOT", "Snapshot timestamp is stale", false));
        }
        let Some(snapshot_hash) = object.get("snapshotSha256").and_then(Value::as_str) else {
            return Err(("INVALID_SNAPSHOT", "Snapshot hash is missing", false));
        };
        if snapshot_hash.len() != 64 || !snapshot_hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(("INVALID_SNAPSHOT", "Snapshot hash is malformed", false));
        }
        let Some(provenance) = object.get("provenance").and_then(Value::as_object) else {
            return Err(("INVALID_SNAPSHOT", "Snapshot provenance is missing", false));
        };
        let Some(paired) = self.paired_client.as_ref() else {
            return Err((
                "CLIENT_NOT_PAIRED",
                "Send an authenticated hello first",
                true,
            ));
        };
        if provenance.get("source").and_then(Value::as_str) != Some("ide_bridge")
            || provenance.get("trust").and_then(Value::as_str) != Some("untrusted_external_data")
            || provenance.get("client").and_then(Value::as_str) != Some(paired.kind.as_str())
            || provenance.get("clientInstanceId").and_then(Value::as_str)
                != Some(paired.instance_id.as_str())
        {
            return Err(("INVALID_SNAPSHOT", "Snapshot provenance is invalid", false));
        }
        let Some(collected_at) = provenance.get("collectedAt").and_then(Value::as_u64) else {
            return Err((
                "INVALID_SNAPSHOT",
                "Snapshot provenance timestamp is missing",
                false,
            ));
        };
        if collected_at.abs_diff(captured_at) > MAX_CLOCK_SKEW_MS {
            return Err((
                "INVALID_SNAPSHOT",
                "Snapshot provenance timestamp is inconsistent",
                false,
            ));
        }
        let sharing_keys = [
            "shareActiveFile",
            "shareSelection",
            "shareUnsavedBuffers",
            "shareDiagnostics",
            "shareGitStatus",
            "shareTestResults",
        ];
        let Some(sharing) = object.get("sharing").and_then(Value::as_object) else {
            return Err((
                "INVALID_SNAPSHOT",
                "Snapshot sharing policy is malformed",
                false,
            ));
        };
        if !sharing_keys
            .iter()
            .all(|key| sharing.get(*key).and_then(Value::as_bool).is_some())
        {
            return Err((
                "INVALID_SNAPSHOT",
                "Snapshot sharing policy is malformed",
                false,
            ));
        }
        let active_editor = match object.get("activeEditor") {
            Some(value) => Some(value.as_object().ok_or((
                "INVALID_SNAPSHOT",
                "Active editor payload is malformed",
                false,
            ))?),
            None => None,
        };
        if sharing.get("shareActiveFile").and_then(Value::as_bool) == Some(false)
            && active_editor.is_some()
        {
            return Err((
                "INVALID_SNAPSHOT",
                "Active editor was included without consent",
                false,
            ));
        }
        if let Some(editor) = active_editor {
            if sharing.get("shareSelection").and_then(Value::as_bool) == Some(false)
                && editor.get("selection").is_some()
            {
                return Err((
                    "INVALID_SNAPSHOT",
                    "Selection was included without consent",
                    false,
                ));
            }
            if sharing.get("shareUnsavedBuffers").and_then(Value::as_bool) == Some(false)
                && editor.get("unsavedBuffer").is_some()
            {
                return Err((
                    "INVALID_SNAPSHOT",
                    "Unsaved buffer was included without consent",
                    false,
                ));
            }
        }
        validate_shared_array(
            object.get("diagnostics"),
            sharing.get("shareDiagnostics").and_then(Value::as_bool) == Some(true),
            500,
            "Diagnostics",
        )?;
        validate_shared_array(
            object.get("recentTests"),
            sharing.get("shareTestResults").and_then(Value::as_bool) == Some(true),
            100,
            "Test results",
        )?;
        let git = validate_shared_array(
            object.get("git"),
            sharing.get("shareGitStatus").and_then(Value::as_bool) == Some(true),
            20,
            "Git data",
        )?;
        if git.is_some_and(|repositories| {
            repositories.iter().any(|repository| {
                repository
                    .get("changes")
                    .and_then(Value::as_array)
                    .is_none_or(|changes| changes.len() > 1_000)
            })
        }) {
            return Err((
                "PAYLOAD_TOO_LARGE",
                "Git snapshot contains too many changes",
                false,
            ));
        }
        if let Some(current) = self.workspace_revisions.get(&workspace_id) {
            if revision <= *current {
                return Err(("STALE_REVISION", "Snapshot revision is stale", false));
            }
            if object.get("parentRevision").and_then(Value::as_u64) != Some(*current) {
                return Err((
                    "STALE_REVISION",
                    "Snapshot does not extend the accepted revision",
                    true,
                ));
            }
        }
        Ok((workspace_id, revision))
    }

    fn commit_snapshot(&mut self, snapshot: Value, workspace_id: &str, revision: u64) {
        self.workspace_revisions
            .insert(workspace_id.to_string(), revision);
        self.latest_snapshot = Some(snapshot);
        self.latest_workspace_id = Some(workspace_id.to_string());
        self.latest_revision = Some(revision);
    }

    fn clear_workspace(&mut self, workspace_id: &str) {
        self.workspace_revisions.remove(workspace_id);
        if self.latest_workspace_id.as_deref() == Some(workspace_id) {
            self.latest_snapshot = None;
            self.latest_workspace_id = None;
            self.latest_revision = None;
        }
    }

    fn ack(&mut self, reply_to: &str, sequence: u64, revision: Option<u64>, now: u64) -> Value {
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "type": "ack",
            "messageId": self.next_message_id(now),
            "replyTo": reply_to,
            "sentAt": now,
            "acceptedSequence": sequence,
            "acceptedRevision": revision,
        })
    }

    fn error(
        &mut self,
        reply_to: Option<&str>,
        code: &str,
        message: &str,
        retryable: bool,
        now: u64,
    ) -> Value {
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "type": "error",
            "messageId": self.next_message_id(now),
            "replyTo": reply_to,
            "sentAt": now,
            "code": code,
            "message": message,
            "retryable": retryable,
        })
    }

    fn next_message_id(&mut self, now: u64) -> String {
        self.next_server_message_id = self.next_server_message_id.saturating_add(1);
        format!("native-{now}-{}", self.next_server_message_id)
    }

    fn retire_connection_file(&mut self) -> Result<(), String> {
        let Some(path) = self.connection_file.as_ref() else {
            return Ok(());
        };
        match fs::remove_file(path) {
            Ok(()) => {
                self.connection_file = None;
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                self.connection_file = None;
                Ok(())
            }
            Err(error) => Err(format!("Не удалось удалить pairing file: {error}")),
        }
    }

    fn retire_expired_pairing(&mut self, now: u64) {
        if self.paired_client.is_none() && now >= self.pairing_expires_at {
            if let Err(error) = self.retire_connection_file() {
                log::warn!("IDE Bridge could not remove expired pairing file: {error}");
            }
        }
    }

    fn invalidate(&mut self) -> Result<(), String> {
        let file_result = self.retire_connection_file();
        self.token.clear();
        self.session_id.clear();
        self.pairing_expires_at = 0;
        self.auth_expires_at = None;
        self.paired_client = None;
        self.last_sequences.clear();
        self.workspace_revisions.clear();
        self.latest_snapshot = None;
        self.latest_workspace_id = None;
        self.latest_revision = None;
        self.last_message_at = None;
        file_result
    }
}

#[tauri::command]
pub fn ide_bridge_start(app: AppHandle) -> Result<IdeBridgeStatus, String> {
    let mut registry = BRIDGE
        .lock()
        .map_err(|_| "IDE Bridge registry is unavailable.".to_string())?;
    if let Some(runtime) = registry.as_ref() {
        return runtime
            .core
            .lock()
            .map_err(|_| "IDE Bridge state is unavailable.".to_string())
            .map(|core| core.status(now_ms()));
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Не удалось запустить IDE Bridge: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("Не удалось определить адрес IDE Bridge: {error}"))?;
    if !address.ip().is_loopback() {
        return Err("IDE Bridge отказался запускаться вне loopback.".into());
    }
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Не удалось включить IDE nonblocking listener: {error}"))?;

    let now = now_ms();
    let expires_at = now.saturating_add(PAIRING_TTL_MS);
    let session_id = format!("ide-{}", random_hex(16)?);
    let token = random_hex(32)?;
    let endpoint = format!("http://127.0.0.1:{}/ide/v1/messages", address.port());
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Не удалось определить app data dir: {error}"))?;
    create_private_directory(&app_data_dir)?;
    let connection_path = app_data_dir.join(CONNECTION_FILE_NAME);
    let connection = ConnectionFile {
        protocol_version: PROTOCOL_VERSION,
        endpoint: &endpoint,
        session_id: &session_id,
        token: &token,
        expires_at,
    };
    let connection_json = serde_json::to_vec_pretty(&connection)
        .map_err(|error| format!("Не удалось сериализовать IDE Bridge connection: {error}"))?;
    write_private_file(&connection_path, &connection_json, &session_id)?;

    let core = Arc::new(Mutex::new(BridgeCore::new(
        endpoint.clone(),
        session_id.clone(),
        token,
        expires_at,
        Some(connection_path.to_string_lossy().into_owned()),
    )));
    let server_core = Arc::clone(&core);
    let server_app = app.clone();
    let running = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let server_running = Arc::clone(&running);
    if let Err(error) = thread::Builder::new()
        .name("ari-ide-bridge".into())
        .spawn(move || serve(listener, server_core, server_app, server_running))
    {
        running.store(false, Ordering::Release);
        let _ = fs::remove_file(&connection_path);
        return Err(format!("Не удалось запустить поток IDE Bridge: {error}"));
    }

    let status = core
        .lock()
        .map_err(|_| "IDE Bridge state is unavailable.".to_string())?
        .status(now);
    *registry = Some(BridgeRuntime { core, running });
    log::info!("IDE Bridge listening at {endpoint}");
    Ok(status)
}

#[tauri::command]
pub fn ide_bridge_stop() -> Result<IdeBridgeStatus, String> {
    let runtime = BRIDGE
        .lock()
        .map_err(|_| "IDE Bridge registry is unavailable.".to_string())?
        .take();
    let Some(runtime) = runtime else {
        return stopped_status();
    };
    runtime.running.store(false, Ordering::Release);
    let invalidate_result = runtime
        .core
        .lock()
        .map_err(|_| "IDE Bridge state is unavailable.".to_string())?
        .invalidate();
    invalidate_result?;
    stopped_status()
}

#[tauri::command]
pub fn ide_bridge_status() -> Result<IdeBridgeStatus, String> {
    let registry = BRIDGE
        .lock()
        .map_err(|_| "IDE Bridge registry is unavailable.".to_string())?;
    let Some(runtime) = registry.as_ref() else {
        return stopped_status();
    };
    runtime
        .core
        .lock()
        .map_err(|_| "IDE Bridge state is unavailable.".to_string())
        .map(|core| core.status(now_ms()))
}

#[tauri::command]
pub fn ide_bridge_snapshot() -> Result<Option<Value>, String> {
    let registry = BRIDGE
        .lock()
        .map_err(|_| "IDE Bridge registry is unavailable.".to_string())?;
    let Some(runtime) = registry.as_ref() else {
        return Ok(None);
    };
    runtime
        .core
        .lock()
        .map_err(|_| "IDE Bridge state is unavailable.".to_string())
        .map(|core| core.latest_snapshot.clone())
}

fn serve(
    listener: TcpListener,
    core: SharedBridge,
    app: AppHandle,
    running: Arc<std::sync::atomic::AtomicBool>,
) {
    let active = Arc::new(AtomicUsize::new(0));
    let mut last_pairing_cleanup = 0;
    while running.load(Ordering::Acquire) {
        let stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                let now = now_ms();
                if now.saturating_sub(last_pairing_cleanup) >= 1_000 {
                    if let Ok(mut state) = core.lock() {
                        state.retire_expired_pairing(now);
                    }
                    last_pairing_cleanup = now;
                }
                thread::sleep(Duration::from_millis(25));
                continue;
            }
            Err(error) => {
                log::warn!("IDE Bridge accept failed: {error}");
                thread::sleep(Duration::from_millis(50));
                continue;
            }
        };
        let previous = active.fetch_add(1, Ordering::AcqRel);
        if previous >= MAX_CONNECTIONS {
            active.fetch_sub(1, Ordering::AcqRel);
            let mut stream = stream;
            let _ = write_json_response(
                &mut stream,
                503,
                "Service Unavailable",
                &json!({ "error": "IDE Bridge is busy" }),
            );
            continue;
        }
        let connection_active = Arc::clone(&active);
        let connection_core = Arc::clone(&core);
        let connection_app = app.clone();
        let connection_running = Arc::clone(&running);
        if let Err(error) = thread::Builder::new()
            .name("ari-ide-connection".into())
            .spawn(move || {
                let _active = ActiveConnection(connection_active);
                if let Err(error) =
                    handle_connection(stream, connection_core, connection_app, connection_running)
                {
                    log::warn!("IDE Bridge connection failed: {error}");
                }
            })
        {
            active.fetch_sub(1, Ordering::AcqRel);
            log::warn!("IDE Bridge could not spawn connection worker: {error}");
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    core: SharedBridge,
    app: AppHandle,
    running: Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    if !running.load(Ordering::Acquire) {
        return write_json_response(
            &mut stream,
            503,
            "Service Unavailable",
            &json!({ "error": "IDE Bridge is stopped" }),
        );
    }
    let peer = stream
        .peer_addr()
        .map_err(|error| format!("Не удалось определить IDE peer: {error}"))?;
    if !peer.ip().is_loopback() {
        return Err("IDE Bridge rejected a non-loopback peer.".into());
    }
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| format!("Не удалось установить IDE read timeout: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| format!("Не удалось установить IDE write timeout: {error}"))?;

    let request = match read_http_request(&mut stream) {
        Ok(request) => request,
        Err(HttpReadError::PayloadTooLarge) => {
            return write_json_response(
                &mut stream,
                413,
                "Payload Too Large",
                &json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "error",
                    "code": "PAYLOAD_TOO_LARGE",
                    "message": "IDE bridge message exceeds the 2 MiB limit",
                    "retryable": false,
                }),
            );
        }
        Err(HttpReadError::BadRequest(message)) => {
            return write_json_response(
                &mut stream,
                400,
                "Bad Request",
                &json!({ "error": message }),
            );
        }
    };

    if request.method == "GET" && request.path == "/ide/v1/health" {
        return write_json_response(
            &mut stream,
            200,
            "OK",
            &json!({
                "protocolVersion": PROTOCOL_VERSION,
                "status": "ready",
            }),
        );
    }
    if request.path != "/ide/v1/messages" {
        return write_json_response(
            &mut stream,
            404,
            "Not Found",
            &json!({ "error": "Not found" }),
        );
    }
    if request.method != "POST" {
        return write_json_response(
            &mut stream,
            405,
            "Method Not Allowed",
            &json!({ "error": "POST required" }),
        );
    }
    if !request
        .headers
        .get("content-type")
        .is_some_and(|value| value.to_ascii_lowercase().starts_with("application/json"))
    {
        return write_json_response(
            &mut stream,
            415,
            "Unsupported Media Type",
            &json!({ "error": "application/json required" }),
        );
    }
    let message: Value = match serde_json::from_slice(&request.body) {
        Ok(message) => message,
        Err(error) => {
            return write_json_response(
                &mut stream,
                400,
                "Bad Request",
                &json!({ "error": format!("Некорректный IDE JSON: {error}") }),
            );
        }
    };
    let outcome = core
        .lock()
        .map_err(|_| "IDE Bridge state is unavailable.".to_string())?
        .process(message, now_ms());
    if !running.load(Ordering::Acquire) {
        return write_json_response(
            &mut stream,
            503,
            "Service Unavailable",
            &json!({ "error": "IDE Bridge is stopped" }),
        );
    }
    if let Some(update) = outcome.update.as_ref() {
        if let Err(error) = app.emit(UPDATE_EVENT, update) {
            log::warn!("IDE Bridge could not emit update: {error}");
        }
    }
    write_json_response(&mut stream, 200, "OK", &outcome.response)
}

fn stopped_status() -> Result<IdeBridgeStatus, String> {
    Ok(IdeBridgeStatus {
        protocol_version: PROTOCOL_VERSION,
        running: false,
        connection: "stopped".into(),
        endpoint: None,
        session_id: None,
        expires_at: None,
        client: None,
        client_instance_id: None,
        last_sequence: None,
        latest_workspace_id: None,
        latest_revision: None,
        last_message_at: None,
        connection_file: None,
    })
}

fn read_http_request(reader: &mut impl Read) -> Result<HttpRequest, HttpReadError> {
    let mut buffer = Vec::with_capacity(8 * 1024);
    let header_end = loop {
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
        if buffer.len() >= MAX_HEADER_BYTES {
            return Err(HttpReadError::BadRequest(
                "HTTP headers are too large".into(),
            ));
        }
        let mut chunk = [0_u8; 8 * 1024];
        let read = reader
            .read(&mut chunk)
            .map_err(|error| HttpReadError::BadRequest(format!("HTTP read failed: {error}")))?;
        if read == 0 {
            return Err(HttpReadError::BadRequest("Incomplete HTTP request".into()));
        }
        buffer.extend_from_slice(&chunk[..read]);
    };
    if header_end > MAX_HEADER_BYTES {
        return Err(HttpReadError::BadRequest(
            "HTTP headers are too large".into(),
        ));
    }

    let header_text = std::str::from_utf8(&buffer[..header_end])
        .map_err(|_| HttpReadError::BadRequest("HTTP headers must be UTF-8".into()))?;
    let mut lines = header_text.split("\r\n");
    let mut request_line = lines
        .next()
        .ok_or_else(|| HttpReadError::BadRequest("Missing request line".into()))?
        .split_whitespace();
    let method = request_line
        .next()
        .ok_or_else(|| HttpReadError::BadRequest("Missing HTTP method".into()))?
        .to_ascii_uppercase();
    let path = request_line
        .next()
        .ok_or_else(|| HttpReadError::BadRequest("Missing HTTP path".into()))?
        .to_string();
    let version = request_line
        .next()
        .ok_or_else(|| HttpReadError::BadRequest("Missing HTTP version".into()))?;
    if request_line.next().is_some() || !matches!(version, "HTTP/1.0" | "HTTP/1.1") {
        return Err(HttpReadError::BadRequest("Malformed request line".into()));
    }

    let mut headers = HashMap::new();
    let mut content_length = None;
    for (index, line) in lines.enumerate() {
        if index >= 100 {
            return Err(HttpReadError::BadRequest("Too many HTTP headers".into()));
        }
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| HttpReadError::BadRequest("Malformed HTTP header".into()))?;
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim().to_string();
        if name.is_empty() || headers.contains_key(&name) {
            return Err(HttpReadError::BadRequest(
                "Duplicate or empty HTTP header".into(),
            ));
        }
        if name == "transfer-encoding" {
            return Err(HttpReadError::BadRequest(
                "Transfer-Encoding is not supported".into(),
            ));
        }
        if name == "content-length" {
            content_length = Some(
                value
                    .parse::<usize>()
                    .map_err(|_| HttpReadError::BadRequest("Invalid Content-Length".into()))?,
            );
        }
        headers.insert(name, value);
    }
    let content_length = content_length.unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Err(HttpReadError::PayloadTooLarge);
    }
    if method == "POST" && !headers.contains_key("content-length") {
        return Err(HttpReadError::BadRequest(
            "Content-Length is required".into(),
        ));
    }
    if method != "POST" && content_length != 0 {
        return Err(HttpReadError::BadRequest(
            "Request body is not allowed for this method".into(),
        ));
    }

    let body_start = header_end + 4;
    let mut body = buffer.get(body_start..).unwrap_or_default().to_vec();
    if body.len() > content_length {
        body.truncate(content_length);
    }
    while body.len() < content_length {
        let remaining = content_length - body.len();
        let mut chunk = vec![0_u8; remaining.min(64 * 1024)];
        let read = reader
            .read(&mut chunk)
            .map_err(|error| HttpReadError::BadRequest(format!("HTTP read failed: {error}")))?;
        if read == 0 {
            return Err(HttpReadError::BadRequest("Incomplete HTTP body".into()));
        }
        body.extend_from_slice(&chunk[..read]);
    }

    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn find_header_end(value: &[u8]) -> Option<usize> {
    value.windows(4).position(|window| window == b"\r\n\r\n")
}

fn write_json_response(
    stream: &mut impl Write,
    status: u16,
    reason: &str,
    value: &Value,
) -> Result<(), String> {
    let body = serde_json::to_vec(value)
        .map_err(|error| format!("Не удалось сериализовать IDE response: {error}"))?;
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n",
        body.len()
    );
    stream
        .write_all(headers.as_bytes())
        .and_then(|_| stream.write_all(&body))
        .and_then(|_| stream.flush())
        .map_err(|error| format!("Не удалось отправить IDE response: {error}"))
}

fn bounded_string(value: Option<&Value>, max_len: usize) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= max_len)
        .map(str::to_string)
}

fn validate_shared_array<'a>(
    value: Option<&'a Value>,
    allowed: bool,
    max_items: usize,
    label: &'static str,
) -> Result<Option<&'a Vec<Value>>, (&'static str, &'static str, bool)> {
    let Some(value) = value else {
        return Ok(None);
    };
    let Some(items) = value.as_array() else {
        return Err(("INVALID_SNAPSHOT", "Shared payload is malformed", false));
    };
    if !allowed && !items.is_empty() {
        return Err((
            "INVALID_SNAPSHOT",
            match label {
                "Diagnostics" => "Diagnostics were included without consent",
                "Test results" => "Test results were included without consent",
                "Git data" => "Git data was included without consent",
                _ => "Data was included without consent",
            },
            false,
        ));
    }
    if items.len() > max_items {
        return Err((
            "PAYLOAD_TOO_LARGE",
            match label {
                "Diagnostics" => "Snapshot contains too many diagnostics",
                "Test results" => "Snapshot contains too many test results",
                "Git data" => "Snapshot contains too many Git repositories",
                _ => "Snapshot contains too many items",
            },
            false,
        ));
    }
    Ok(Some(items))
}

#[inline(never)]
fn constant_time_equal(received: &str, expected: &str) -> bool {
    let received = received.as_bytes();
    let expected = expected.as_bytes();
    let mut mismatch = received.len() ^ expected.len();
    for (index, expected_byte) in expected.iter().enumerate() {
        mismatch |= usize::from(received.get(index).copied().unwrap_or(0) ^ expected_byte);
    }
    std::hint::black_box(mismatch) == 0
}

fn is_event_kind(value: &str) -> bool {
    matches!(
        value,
        "workspace.opened"
            | "workspace.changed"
            | "activeEditor.changed"
            | "document.changed"
            | "selection.changed"
            | "diagnostics.changed"
            | "git.changed"
            | "testRun.finished"
            | "workspace.closed"
    )
}

fn event_uri_has_consent(kind: &str, snapshot: &Value) -> bool {
    let sharing = snapshot.get("sharing").and_then(Value::as_object);
    let enabled = |key: &str| {
        sharing
            .and_then(|policy| policy.get(key))
            .and_then(Value::as_bool)
            == Some(true)
    };
    match kind {
        "activeEditor.changed" | "document.changed" | "selection.changed" => {
            enabled("shareActiveFile")
        }
        "diagnostics.changed" => enabled("shareDiagnostics"),
        "git.changed" => enabled("shareGitStatus"),
        _ => false,
    }
}

fn update_payload(kind: &str, workspace_id: &str, revision: u64, now: u64) -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "type": kind,
        "workspaceId": workspace_id,
        "revision": revision,
        "receivedAt": now,
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn random_hex(byte_count: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; byte_count];
    fill_os_random(&mut bytes)?;
    let mut result = String::with_capacity(byte_count * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut result, "{byte:02x}")
            .map_err(|_| "Не удалось закодировать IDE Bridge secret.".to_string())?;
    }
    Ok(result)
}

#[cfg(target_os = "windows")]
fn fill_os_random(bytes: &mut [u8]) -> Result<(), String> {
    use windows_sys::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            bytes.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status < 0 {
        return Err(format!("Windows OS RNG завершился с NTSTATUS {status}."));
    }
    Ok(())
}

#[cfg(unix)]
fn fill_os_random(bytes: &mut [u8]) -> Result<(), String> {
    let mut random = fs::File::open("/dev/urandom")
        .map_err(|error| format!("Не удалось открыть OS RNG: {error}"))?;
    random
        .read_exact(bytes)
        .map_err(|error| format!("Не удалось прочитать OS RNG: {error}"))
}

#[cfg(not(any(target_os = "windows", unix)))]
fn fill_os_random(_bytes: &mut [u8]) -> Result<(), String> {
    Err("OS RNG недоступен на этой платформе.".into())
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("Не удалось создать IDE Bridge data dir: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Не удалось защитить IDE Bridge data dir: {error}"))?;
    }
    Ok(())
}

fn write_private_file(path: &Path, bytes: &[u8], session_id: &str) -> Result<(), String> {
    let temporary = path.with_extension(format!("tmp-{session_id}"));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| format!("Не удалось создать IDE Bridge connection file: {error}"))?;
    file.write_all(bytes)
        .and_then(|_| file.flush())
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Не удалось записать IDE Bridge connection file: {error}"))?;
    drop(file);
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Не удалось заменить IDE Bridge connection file: {error}"))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("Не удалось активировать IDE Bridge connection file: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const NOW: u64 = 1_750_000_000_000;
    const SESSION: &str = "ide-session-test";
    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn core() -> BridgeCore {
        BridgeCore::new(
            "http://127.0.0.1:12345/ide/v1/messages".into(),
            SESSION.into(),
            TOKEN.into(),
            NOW + 60_000,
            None,
        )
    }

    fn envelope(message_type: &str, sequence: u64) -> Value {
        json!({
            "protocolVersion": 1,
            "type": message_type,
            "messageId": format!("message-{sequence}"),
            "sequence": sequence,
            "sentAt": NOW,
            "auth": { "sessionId": SESSION, "token": TOKEN },
        })
    }

    fn hello(sequence: u64) -> Value {
        let mut value = envelope("hello", sequence);
        let object = value.as_object_mut().expect("hello object");
        object.insert("client".into(), json!("test"));
        object.insert("clientInstanceId".into(), json!("client-1"));
        object.insert(
            "capabilities".into(),
            json!({
                "snapshots": true,
                "activeFile": true,
                "selections": true,
                "unsavedBuffers": true,
                "diagnostics": true,
                "git": true,
                "tests": true
            }),
        );
        value
    }

    fn snapshot_message(sequence: u64, revision: u64, parent: Option<u64>) -> Value {
        let mut value = envelope("snapshot.publish", sequence);
        let mut snapshot = json!({
            "workspaceId": "workspace-1",
            "projectId": "project-1",
            "roots": [],
            "revision": revision,
            "capturedAt": NOW,
            "expiresAt": NOW + 30_000,
            "snapshotSha256": "0".repeat(64),
            "provenance": {
                "source": "ide_bridge",
                "client": "test",
                "clientInstanceId": "client-1",
                "collectedAt": NOW,
                "trust": "untrusted_external_data"
            },
            "sharing": {
                "shareActiveFile": false,
                "shareSelection": false,
                "shareUnsavedBuffers": false,
                "shareDiagnostics": false,
                "shareGitStatus": false,
                "shareTestResults": false
            }
        });
        if let Some(parent) = parent {
            snapshot
                .as_object_mut()
                .expect("snapshot object")
                .insert("parentRevision".into(), json!(parent));
        }
        value
            .as_object_mut()
            .expect("message object")
            .insert("snapshot".into(), snapshot);
        value
    }

    fn event_message(
        sequence: u64,
        kind: &str,
        revision: u64,
        snapshot: Option<Value>,
        uri: Option<&str>,
    ) -> Value {
        let mut value = envelope("event.publish", sequence);
        value["event"] = json!({
            "kind": kind,
            "workspaceId": "workspace-1",
            "revision": revision,
        });
        if let Some(uri) = uri {
            value["event"]["uri"] = json!(uri);
        }
        if let Some(snapshot) = snapshot {
            value["snapshot"] = snapshot;
        }
        value
    }

    #[test]
    fn authenticates_session_and_token_without_accepting_prefixes() {
        assert!(constant_time_equal(TOKEN, TOKEN));
        assert!(!constant_time_equal(&TOKEN[..32], TOKEN));
        assert!(!constant_time_equal(
            "1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            TOKEN
        ));

        let mut bridge = core();
        let mut invalid = hello(1);
        invalid["auth"]["token"] = json!("wrong-token-value-that-is-long-enough");
        let outcome = bridge.process(invalid, NOW);
        assert_eq!(outcome.response["type"], "error");
        assert_eq!(outcome.response["code"], "UNAUTHORIZED");
    }

    #[test]
    fn rejects_replayed_client_sequence() {
        let mut bridge = core();
        assert_eq!(bridge.process(hello(1), NOW).response["type"], "welcome");
        let replay = bridge.process(hello(1), NOW);
        assert_eq!(replay.response["type"], "error");
        assert_eq!(replay.response["code"], "REPLAYED_MESSAGE");
    }

    #[test]
    fn retires_pairing_file_and_switches_to_in_memory_auth_expiry() {
        let path = std::env::temp_dir().join(format!(
            "ari-ide-pairing-{}-{}.json",
            std::process::id(),
            NOW
        ));
        fs::write(&path, b"pairing-secret").expect("pairing fixture");
        let mut bridge = BridgeCore::new(
            "http://127.0.0.1:12345/ide/v1/messages".into(),
            SESSION.into(),
            TOKEN.into(),
            NOW + PAIRING_TTL_MS,
            Some(path.to_string_lossy().into_owned()),
        );
        let waiting = bridge.status(NOW);
        assert_eq!(waiting.connection, "waiting");
        assert_eq!(waiting.expires_at, Some(NOW + PAIRING_TTL_MS));
        assert!(waiting.connection_file.is_some());

        let welcome = bridge.process(hello(1), NOW);
        assert_eq!(welcome.response["type"], "welcome");
        assert_eq!(welcome.response["expiresAt"], NOW + AUTH_SESSION_TTL_MS);
        assert!(!path.exists());
        let paired = bridge.status(NOW);
        assert_eq!(paired.connection, "paired");
        assert_eq!(paired.expires_at, Some(NOW + AUTH_SESSION_TTL_MS));
        assert!(paired.connection_file.is_none());

        let renewed = bridge.process(hello(2), NOW + 1_000);
        assert_eq!(renewed.response["type"], "welcome");
        assert_eq!(
            renewed.response["expiresAt"],
            NOW + 1_000 + AUTH_SESSION_TTL_MS
        );
    }

    #[test]
    fn rejects_stale_snapshot_revision() {
        let mut bridge = core();
        assert_eq!(bridge.process(hello(1), NOW).response["type"], "welcome");
        let accepted = bridge.process(snapshot_message(2, 1, None), NOW);
        assert_eq!(accepted.response["type"], "ack");
        let stale = bridge.process(snapshot_message(3, 1, None), NOW);
        assert_eq!(stale.response["type"], "error");
        assert_eq!(stale.response["code"], "STALE_REVISION");
        assert_eq!(stale.response["expectedRevision"], 1);
        assert_eq!(bridge.latest_snapshot.as_ref().unwrap()["revision"], 1);

        let recovered = bridge.process(snapshot_message(4, 2, Some(1)), NOW);
        assert_eq!(recovered.response["type"], "ack");
        assert_eq!(bridge.latest_snapshot.as_ref().unwrap()["revision"], 2);
    }

    #[test]
    fn gates_event_uris_and_clears_closed_workspace_snapshot() {
        let mut bridge = core();
        assert_eq!(bridge.process(hello(1), NOW).response["type"], "welcome");

        let private_snapshot = snapshot_message(2, 1, None)["snapshot"].clone();
        let rejected = bridge.process(
            event_message(
                2,
                "activeEditor.changed",
                1,
                Some(private_snapshot),
                Some("file:///secret.rs"),
            ),
            NOW,
        );
        assert_eq!(rejected.response["type"], "error");
        assert_eq!(rejected.response["code"], "INVALID_SNAPSHOT");
        assert!(bridge.latest_snapshot.is_none());

        let mut shared_snapshot = snapshot_message(3, 1, None)["snapshot"].clone();
        shared_snapshot["sharing"]["shareActiveFile"] = json!(true);
        let accepted = bridge.process(
            event_message(
                3,
                "activeEditor.changed",
                1,
                Some(shared_snapshot),
                Some("file:///shared.rs"),
            ),
            NOW,
        );
        assert_eq!(accepted.response["type"], "ack");
        assert!(bridge.latest_snapshot.is_some());

        let closed = bridge.process(event_message(4, "workspace.closed", 1, None, None), NOW);
        assert_eq!(closed.response["type"], "ack");
        assert!(bridge.latest_snapshot.is_none());
        assert!(!bridge.workspace_revisions.contains_key("workspace-1"));
    }

    #[test]
    fn parses_bounded_http_body_and_rejects_oversize_before_allocation() {
        let body = br#"{"protocolVersion":1}"#;
        let request = format!(
            "POST /ide/v1/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            std::str::from_utf8(body).unwrap()
        );
        let parsed = read_http_request(&mut Cursor::new(request.into_bytes())).unwrap();
        assert_eq!(parsed.method, "POST");
        assert_eq!(parsed.path, "/ide/v1/messages");
        assert_eq!(parsed.body, body);

        let oversized = format!(
            "POST /ide/v1/messages HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
            MAX_BODY_BYTES + 1
        );
        assert!(matches!(
            read_http_request(&mut Cursor::new(oversized.into_bytes())),
            Err(HttpReadError::PayloadTooLarge)
        ));
    }
}
