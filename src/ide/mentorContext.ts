import type {
  IdeDiagnostic,
  IdeRange,
  IdeWorkspaceSnapshot,
} from "./protocol";

export type EngineeringMentorMode =
  | "project_understanding"
  | "mentor_explain"
  | "mentor_review"
  | "mentor_debug"
  | "mentor_architecture"
  | "mentor_learning";

export type MentorEvidenceSource =
  | "workspace"
  | "active_editor"
  | "selection"
  | "diagnostics"
  | "unsaved_buffer"
  | "git"
  | "test_result";

export type MentorEvidence = {
  id: string;
  source: MentorEvidenceSource;
  trust: "untrusted_external_data";
  workspaceId: string;
  snapshotRevision: number;
  capturedAt: number;
  expiresAt: number;
  contentHash: string;
  content: string;
  uri?: string;
  range?: IdeRange;
  truncated: boolean;
};

export type EngineeringMentorContext = {
  schemaVersion: 1;
  mode: EngineeringMentorMode;
  project: {
    projectId: string;
    workspaceId: string;
    roots: string[];
    snapshotRevision: number;
  };
  evidence: MentorEvidence[];
  warnings: string[];
  totalContentChars: number;
  maxContentChars: number;
};

export type MentorContextOptions = {
  mode?: EngineeringMentorMode;
  now?: number;
  maxContentChars?: number;
  maxDiagnostics?: number;
  maxTests?: number;
};

type EvidenceCandidate = Omit<MentorEvidence, "id" | "content" | "truncated"> & {
  content: string;
  perItemLimit: number;
};

function positionLabel(range: IdeRange): string {
  const start = `${range.start.line + 1}:${range.start.character + 1}`;
  const end = `${range.end.line + 1}:${range.end.character + 1}`;
  return `${start}-${end}`;
}

function diagnosticLine(diagnostic: IdeDiagnostic): string {
  const source = diagnostic.source ? ` ${diagnostic.source}` : "";
  const code = diagnostic.code ? `(${diagnostic.code})` : "";
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.uri}:${positionLabel(diagnostic.range)}${source}${code}: ${diagnostic.message}`;
}

function editorScope(uri: string): {
  kind: "project_source" | "third_party_dependency";
  editable: boolean;
  adviceConstraint?: string;
} {
  const normalized = uri.replace(/\\/g, "/").toLowerCase();
  if (
    normalized.includes("/node_modules/") ||
    normalized.includes("/.pnpm/") ||
    normalized.includes("/vendor/")
  ) {
    return {
      kind: "third_party_dependency",
      editable: false,
      adviceConstraint:
        "Explain the dependency API or trace the issue to project source/config; do not recommend editing or rewriting this file.",
    };
  }
  return { kind: "project_source", editable: true };
}

function createCandidate(
  snapshot: IdeWorkspaceSnapshot,
  source: MentorEvidenceSource,
  content: string,
  perItemLimit: number,
  details: { contentHash?: string; uri?: string; range?: IdeRange } = {},
): EvidenceCandidate {
  return {
    source,
    trust: "untrusted_external_data",
    workspaceId: snapshot.workspaceId,
    snapshotRevision: snapshot.revision,
    capturedAt: snapshot.capturedAt,
    expiresAt: snapshot.expiresAt,
    contentHash: details.contentHash ?? snapshot.snapshotSha256,
    content,
    uri: details.uri,
    range: details.range,
    perItemLimit,
  };
}

export function buildEngineeringMentorContext(
  snapshot: IdeWorkspaceSnapshot,
  options: MentorContextOptions = {},
): EngineeringMentorContext {
  const now = options.now ?? Date.now();
  const maxContentChars = Math.max(512, options.maxContentChars ?? 12_000);
  const maxDiagnostics = Math.max(0, Math.min(100, options.maxDiagnostics ?? 30));
  const maxTests = Math.max(0, Math.min(20, options.maxTests ?? 5));
  const warnings: string[] = [];

  if (snapshot.expiresAt <= now) {
    return {
      schemaVersion: 1,
      mode: options.mode ?? "mentor_explain",
      project: {
        projectId: snapshot.projectId,
        workspaceId: snapshot.workspaceId,
        roots: [],
        snapshotRevision: snapshot.revision,
      },
      evidence: [],
      warnings: ["IDE snapshot expired; no editor evidence was included."],
      totalContentChars: 0,
      maxContentChars,
    };
  }

  const candidates: EvidenceCandidate[] = [];
  const editor = snapshot.activeEditor;
  candidates.push(
    createCandidate(
      snapshot,
      "workspace",
      JSON.stringify({
        projectId: snapshot.projectId,
        roots: snapshot.roots,
      }),
      2_000,
    ),
  );
  if (editor) {
    const scope = editorScope(editor.uri);
    candidates.push(
      createCandidate(
        snapshot,
        "active_editor",
        JSON.stringify({
          uri: editor.uri,
          languageId: editor.languageId,
          documentVersion: editor.documentVersion,
          isDirty: editor.isDirty,
          scope: scope.kind,
          editable: scope.editable,
          adviceConstraint: scope.adviceConstraint,
        }),
        1_000,
        { uri: editor.uri },
      ),
    );
  }

  if (editor?.selection?.text && snapshot.sharing.shareSelection) {
    candidates.push(
      createCandidate(snapshot, "selection", editor.selection.text.value, 6_000, {
        contentHash: editor.selection.text.sha256,
        uri: editor.uri,
        range: editor.selection.range,
      }),
    );
  }

  if (snapshot.sharing.shareDiagnostics && snapshot.diagnostics?.length) {
    // Diagnostics from unrelated tabs used to sit next to the active buffer
    // without any boundary. That made the model attribute an error from one
    // file to another. With an active editor, only diagnostics whose URI
    // exactly matches that editor are relevant to an IDE-file recommendation.
    const relevantDiagnostics = editor
      ? snapshot.diagnostics.filter((diagnostic) => diagnostic.uri === editor.uri)
      : snapshot.diagnostics;
    const diagnostics = relevantDiagnostics.slice(0, maxDiagnostics);
    if (diagnostics.length) {
      candidates.push(
        createCandidate(
          snapshot,
          "diagnostics",
          diagnostics.map(diagnosticLine).join("\n"),
          5_000,
          editor ? { uri: editor.uri } : undefined,
        ),
      );
    }
    if (editor && relevantDiagnostics.length < snapshot.diagnostics.length) {
      warnings.push(
        `Excluded ${snapshot.diagnostics.length - relevantDiagnostics.length} diagnostics from files other than the active editor.`,
      );
    }
    if (diagnostics.length < relevantDiagnostics.length) {
      warnings.push(`Diagnostics limited to ${diagnostics.length} of ${relevantDiagnostics.length}.`);
    }
  }

  if (snapshot.sharing.shareTestResults && snapshot.recentTests?.length) {
    const tests = [...snapshot.recentTests]
      .sort((left, right) => {
        if (left.status === "failed" && right.status !== "failed") return -1;
        if (right.status === "failed" && left.status !== "failed") return 1;
        return right.completedAt - left.completedAt;
      })
      .slice(0, maxTests);
    for (const test of tests) {
      const summary = `${test.status.toUpperCase()}: ${test.label}`;
      const content = test.output ? `${summary}\n${test.output.value}` : summary;
      candidates.push(
        createCandidate(snapshot, "test_result", content, 4_000, {
          contentHash: test.output?.sha256,
        }),
      );
    }
  }

  if (editor?.unsavedBuffer && snapshot.sharing.shareUnsavedBuffers) {
    candidates.push(
      createCandidate(snapshot, "unsaved_buffer", editor.unsavedBuffer.value, 8_000, {
        contentHash: editor.unsavedBuffer.sha256,
        uri: editor.uri,
      }),
    );
  }

  if (snapshot.sharing.shareGitStatus && snapshot.git?.length) {
    const gitContent = snapshot.git
      .map((repository) =>
        JSON.stringify({
          root: repository.repositoryRootUri,
          branch: repository.branch,
          head: repository.head,
          dirty: repository.dirty,
          changes: repository.changes.slice(0, 100),
        }),
      )
      .join("\n");
    candidates.push(createCandidate(snapshot, "git", gitContent, 4_000));
  }

  const evidence: MentorEvidence[] = [];
  let remaining = maxContentChars;
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const allowed = Math.min(candidate.perItemLimit, remaining);
    if (allowed <= 0) continue;
    const truncated = candidate.content.length > allowed;
    const content = truncated ? candidate.content.slice(0, allowed) : candidate.content;
    evidence.push({
      id: `ide:${snapshot.workspaceId}:${snapshot.revision}:${evidence.length + 1}`,
      source: candidate.source,
      trust: candidate.trust,
      workspaceId: candidate.workspaceId,
      snapshotRevision: candidate.snapshotRevision,
      capturedAt: candidate.capturedAt,
      expiresAt: candidate.expiresAt,
      contentHash: candidate.contentHash,
      content,
      uri: candidate.uri,
      range: candidate.range,
      truncated,
    });
    remaining -= content.length;
  }
  if (candidates.length > evidence.length || evidence.some((item) => item.truncated)) {
    warnings.push("IDE evidence was truncated to the configured context budget.");
  }

  return {
    schemaVersion: 1,
    mode: options.mode ?? "mentor_explain",
    project: {
      projectId: snapshot.projectId,
      workspaceId: snapshot.workspaceId,
      roots: snapshot.roots.map((root) => root.uri),
      snapshotRevision: snapshot.revision,
    },
    evidence,
    warnings,
    totalContentChars: maxContentChars - remaining,
    maxContentChars,
  };
}
