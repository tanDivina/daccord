// Collects real, checkable evidence for a submission: the PR diff and CI
// check runs from GitHub, and live probes of staging endpoints.

const MAX_PATCH_CHARS = 120_000;
const MAX_WORKFLOW_CHARS = 20_000;
const MAX_BUILD_FILE_CHARS = 12_000;
/** Check-run names and file paths are written by the contractor; keep them short. */
const MAX_NAME_CHARS = 120;
const MAX_FILE_PAGES = 3; // GitHub returns at most 100 files per page.

export interface PullRequestEvidence {
  /** Canonical https://github.com/{owner}/{repo}/pull/{n}, rebuilt from the parsed parts. */
  url: string;
  /** "owner/name" of the repository the PR targets (its base), from the GitHub API. */
  baseRepo: string;
  /** open | closed, plus whether it was merged. */
  state: string;
  merged: boolean;
  title: string;
  body: string;
  headSha: string;
  files: { filename: string; status: string; additions: number; deletions: number }[];
  diff: string;
  diffTruncated: boolean;
  /** Files that were cut from `diff` because it hit MAX_PATCH_CHARS. */
  truncatedFiles: string[];
  /** Changed files GitHub sent no patch for (binary or too large) that are not safely skippable. */
  unreviewable: string[];
  /** The PR changes more files than we fetched (over 300), so some changes were never seen. */
  tooManyFiles: boolean;
  /** Total changed files according to GitHub (may exceed files.length). */
  changedFilesTotal: number;
  /** `app` is the GitHub App slug that created the run, e.g. "github-actions". null if unknown. */
  checks: { name: string; status: string; conclusion: string | null; app: string | null }[];
  /** CI workflow definitions at the PR head SHA (.github/workflows/*.yml|yaml). */
  workflows: { path: string; content: string }[];
  /** Workflow contents were cut at MAX_WORKFLOW_CHARS total. */
  workflowsTruncated: boolean;
  /** Set when the workflow listing or a workflow file could not be read. */
  workflowsError?: string;
  /** Any changed file in this PR is under .github/ (workflows, actions, CODEOWNERS...). */
  workflowsChangedInPr: boolean;
  /**
   * Files that define what the workflows' commands actually run, read at the head
   * commit: package.json (its scripts), a Makefile when a workflow calls make, and
   * local actions referenced with `uses: ./...`. Written by the contractor.
   */
  buildFiles: { path: string; content: string }[];
  /** Set when a build file referenced by a workflow could not be read or was cut. */
  buildFilesNote?: string;
}

export interface ProbeEvidence {
  url: string;
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  error?: string;
}

function githubHeaders(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

/**
 * Parses a PR URL strictly: nothing may follow the PR number except a tab name
 * (files, commits, checks), a slash, a query or a fragment, so text appended to the URL never reaches a prompt.
 * Callers should use `canonical`, never the raw string.
 */
export function parsePrUrl(raw: string) {
  const url = String(raw ?? "").trim();
  if (url.length > 300) return null;
  const m = url.match(/^https:\/\/github\.com\/([\w.-]{1,100})\/([\w.-]{1,100})\/pull\/(\d{1,9})(?:\/(?:files|commits|checks))?\/?(?:[?#][^\s]*)?$/);
  if (!m) return null;
  const [, owner, repo, n] = m;
  if (/^\.+$/.test(owner) || /^\.+$/.test(repo)) return null;
  const number = Number(n);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { owner, repo, number, canonical: `https://github.com/${owner}/${repo}/pull/${number}` };
}

/** Cuts a contractor-chosen name to a safe length for the prompt. */
export function clipName(s: unknown): string {
  const t = String(s ?? "").replace(/[\r\n\t]+/g, " ");
  return t.length > MAX_NAME_CHARS ? `${t.slice(0, MAX_NAME_CHARS)}...` : t;
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub ${path} returned ${res.status}`);
  return res.json();
}

// Files GitHub may omit a patch for that cannot hide logic.
const SKIPPABLE_NAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
  "uv.lock",
  "gemfile.lock",
  "composer.lock",
  "go.sum",
]);
const SKIPPABLE_EXT =
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|svgz|tiff?|heic|psd|woff2?|ttf|otf|eot|mp3|wav|ogg|flac|m4a|aac|mp4|mov|webm|avi|mkv|pdf)$/i;

function isSkippableWithoutPatch(f: { filename: string; status: string; additions?: number; deletions?: number }) {
  if (f.status === "removed") return true;
  // Pure renames carry no content change.
  if (f.status === "renamed" && !f.additions && !f.deletions) return true;
  const base = f.filename.split("/").pop()!.toLowerCase();
  return SKIPPABLE_NAMES.has(base) || SKIPPABLE_EXT.test(base);
}

function decodeBase64(b64: string) {
  return Buffer.from(b64.replace(/\n/g, ""), "base64").toString("utf8");
}

async function fetchWorkflows(base: string, sha: string) {
  const out: { path: string; content: string }[] = [];
  let truncated = false;
  let error: string | undefined;
  let entries: any[] = [];
  try {
    const res = await fetch(`https://api.github.com${base}/contents/.github/workflows?ref=${encodeURIComponent(sha)}`, {
      headers: githubHeaders(),
      cache: "no-store",
    });
    if (res.status === 404) return { workflows: out, truncated, error }; // No workflows at this SHA.
    if (!res.ok) throw new Error(`GitHub workflows listing returned ${res.status}`);
    const listing = await res.json();
    entries = Array.isArray(listing) ? listing : [];
  } catch (e) {
    return { workflows: out, truncated, error: e instanceof Error ? e.message : "Could not list workflows" };
  }

  const yml = entries
    .filter((e) => e?.type === "file" && /\.ya?ml$/i.test(e.name ?? ""))
    .sort((a, b) => String(a.path).localeCompare(String(b.path)));
  let used = 0;
  for (const e of yml) {
    if (used >= MAX_WORKFLOW_CHARS) {
      truncated = true;
      out.push({ path: e.path, content: "[not read: workflow size cap reached]" });
      continue;
    }
    try {
      const file = await gh<any>(`${base}/contents/${e.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(sha)}`);
      let content = typeof file.content === "string" && file.encoding === "base64" ? decodeBase64(file.content) : "";
      if (!content && file.size > 0) {
        error = error ?? `Workflow ${e.path} is too large to read through the contents API`;
        content = "[unreadable: too large]";
      }
      const room = MAX_WORKFLOW_CHARS - used;
      if (content.length > room) {
        content = content.slice(0, room) + "\n[truncated]";
        truncated = true;
      }
      used += content.length;
      out.push({ path: e.path, content });
    } catch (err) {
      error = error ?? (err instanceof Error ? err.message : `Could not read ${e.path}`);
      out.push({ path: e.path, content: "[unreadable]" });
    }
  }
  return { workflows: out, truncated, error };
}

async function readFileAt(base: string, path: string, sha: string): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(sha)}`,
    { headers: githubHeaders(), cache: "no-store" }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${path}`);
  const file = await res.json();
  if (Array.isArray(file) || file?.type !== "file") return null;
  if (typeof file.content === "string" && file.encoding === "base64") return decodeBase64(file.content);
  throw new Error(`${path} is too large to read`);
}

/**
 * Reads what the workflow commands resolve to: package.json scripts, a Makefile
 * when a workflow runs make, and local actions (`uses: ./path`). Without these,
 * `run: npm test` says nothing about what the test script does.
 */
async function fetchBuildFiles(base: string, sha: string, workflows: { content: string }[]) {
  const all = workflows.map((w) => w.content).join("\n");
  const paths = new Set<string>(["package.json"]);
  if (/(^|[\s;&|])make(\s|$)/m.test(all)) paths.add("Makefile");
  for (const m of Array.from(all.matchAll(/uses:\s*["']?\.\/([\w./-]+?)\/?["']?\s*$/gm)).slice(0, 5)) {
    const dir = m[1].replace(/\/+$/, "");
    if (dir.includes("..")) continue;
    if (/\.ya?ml$/i.test(dir)) paths.add(dir); // a local reusable workflow
    else paths.add(`${dir}/action.yml`).add(`${dir}/action.yaml`);
  }
  const out: { path: string; content: string }[] = [];
  const notes: string[] = [];
  let used = 0;
  for (const path of Array.from(paths)) {
    try {
      let content = await readFileAt(base, path, sha);
      if (content === null) continue;
      const room = MAX_BUILD_FILE_CHARS - used;
      if (room <= 0) {
        notes.push(`${path} not read (size cap)`);
        continue;
      }
      if (content.length > room) {
        content = content.slice(0, room) + "\n[truncated]";
        notes.push(`${path} cut for length`);
      }
      used += content.length;
      out.push({ path, content });
    } catch (e) {
      notes.push(e instanceof Error ? e.message : `Could not read ${path}`);
    }
  }
  return { files: out, note: notes.length ? notes.join("; ") : undefined };
}

export async function fetchPullRequest(rawUrl: string): Promise<PullRequestEvidence> {
  const ref = parsePrUrl(rawUrl);
  if (!ref) throw new Error("Not a GitHub pull request URL (expected https://github.com/owner/repo/pull/123)");
  const base = `/repos/${ref.owner}/${ref.repo}`;

  const pr = await gh<any>(`${base}/pulls/${ref.number}`);
  const headSha: string = pr.head.sha;
  const changedFilesTotal = Number(pr.changed_files ?? 0);

  // Paginate files (100 per page) up to MAX_FILE_PAGES, alongside checks and workflows.
  const fetchFiles = async () => {
    const all: any[] = [];
    for (let page = 1; page <= MAX_FILE_PAGES; page++) {
      const batch = await gh<any[]>(`${base}/pulls/${ref.number}/files?per_page=100&page=${page}`);
      all.push(...batch);
      if (batch.length < 100) return { files: all, more: false };
    }
    // Page MAX_FILE_PAGES was full: check whether anything is left.
    const next = await gh<any[]>(`${base}/pulls/${ref.number}/files?per_page=1&page=${MAX_FILE_PAGES * 100 + 1}`).catch(() => [1]);
    return { files: all, more: next.length > 0 };
  };
  const fetchChecks = async (): Promise<PullRequestEvidence["checks"]> => {
    try {
      const runs = await gh<any>(`${base}/commits/${headSha}/check-runs?per_page=100`);
      return runs.check_runs.map((r: any) => ({
        name: clipName(r.name),
        status: r.status,
        conclusion: r.conclusion,
        app: r.app?.slug ?? null,
      }));
    } catch {
      return []; // Repos without Actions simply have no check runs.
    }
  };

  const [{ files, more }, checks, wf] = await Promise.all([fetchFiles(), fetchChecks(), fetchWorkflows(base, headSha)]);
  const build = await fetchBuildFiles(base, headSha, wf.workflows);

  let diff = "";
  let diffTruncated = false;
  const truncatedFiles: string[] = [];
  const unreviewable: string[] = [];
  for (const f of files) {
    if (f.patch == null && !isSkippableWithoutPatch(f)) unreviewable.push(f.filename);
    if (diffTruncated) {
      truncatedFiles.push(f.filename);
      continue;
    }
    const chunk = `--- ${f.filename} (${f.status})\n${f.patch ?? "[binary or too large]"}\n`;
    if (diff.length + chunk.length > MAX_PATCH_CHARS) {
      diffTruncated = true;
      truncatedFiles.push(f.filename);
      continue;
    }
    diff += chunk;
  }

  return {
    url: ref.canonical,
    baseRepo: String(pr.base?.repo?.full_name ?? `${ref.owner}/${ref.repo}`),
    state: String(pr.state ?? "unknown"),
    merged: Boolean(pr.merged),
    title: pr.title,
    body: pr.body ?? "",
    headSha,
    files: files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
    diff,
    diffTruncated,
    truncatedFiles,
    unreviewable,
    tooManyFiles: more || changedFilesTotal > files.length,
    changedFilesTotal: Math.max(changedFilesTotal, files.length),
    checks,
    workflows: wf.workflows,
    workflowsTruncated: wf.truncated,
    ...(wf.error ? { workflowsError: wf.error } : {}),
    workflowsChangedInPr: files.some((f) => String(f.filename).startsWith(".github/")),
    buildFiles: build.files,
    ...(build.note ? { buildFilesNote: build.note } : {}),
  };
}

function isProbeAllowed(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname;
  // Public hostnames only: no IP literals, localhost or internal names.
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
  if (/(^|\.)(localhost|internal|local)$/.test(host)) return null;
  return url;
}

export async function probeEndpoint(raw: string): Promise<ProbeEvidence> {
  const url = isProbeAllowed(raw);
  if (!url) return { url: raw, ok: false, status: null, latencyMs: null, error: "URL not allowed (https, public host only)" };

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return { url: url.toString(), ok: res.ok, status: res.status, latencyMs: Date.now() - started };
  } catch (e) {
    return {
      url: url.toString(),
      ok: false,
      status: null,
      latencyMs: null,
      error: e instanceof Error ? e.message : "Request failed",
    };
  }
}

// Cheap deterministic screens that run before any model sees the submission.
// They catch blunt attacks only; the two model passes handle disguised ones
// (the "note to the reviewer" threat lab case is left to them on purpose).
// Keep false positives low: these patterns run over whole PR diffs.

// Who an injected instruction is usually addressed to.
const ADDRESSEE = String.raw`(?:ai|llm|model|assistant|claude|gpt|grader|evaluator|verifier|reviewer|judge|skeptic|auditor)`;
const INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:of\s+)?(?:the\s+|your\s+|any\s+|these\s+)?(?:previous|prior|above|earlier|preceding|system|original)\s+(?:instructions|directions|rules|prompts?|guidelines)/i,
  /\bignore\s+(?:all\s+)?(?:the\s+)?(?:test results|failing tests|ci results|(?:all\s+)tests)\b/i,
  /\b(?:disregard|forget|override)\s+(?:all\s+)?(?:of\s+)?(?:the\s+|your\s+|any\s+)?(?:prior|previous|above|earlier|preceding|system|original)\s+(?:instructions|directions|rules|prompts?|context|guidelines)/i,
  /\bdisregard\s+(?:the\s+)?(?:above|previous|prior)\b/i,
  /system prompt override|\boverride\s+(?:the\s+|your\s+)?system prompt/i,
  /\b(?:here are\s+)?(?:your\s+)?new instructions\s*:|\byour new instructions\b/i,
  /\byou are (?:now )?(?:the |an? |acting as (?:the |an? )?)?(?:grader|evaluator|verifier|reviewer|judge|skeptic)\b/i,
  new RegExp(String.raw`\b(?:dear|attention|hey|note (?:to|for)(?: the)?(?: automated| ai)?)\s+${ADDRESSEE}s?\s*[,:-]\s*(?:please\s+)?(?:approve|ignore|disregard|you must|mark|output|return|respond)\b`, "i"),
  new RegExp(String.raw`(?:^|[\n.!;])\s*(?:[/#*]+\s*)?${ADDRESSEE}s?\s*[,:]\s*(?:please\s+)?(?:approve|ignore|disregard|you must|mark (?:this|it|all))\b`, "i"),
  /\b(?:please\s+)?approve this (?:milestone|submission|payout|payment|release|deliverable|work)\b/i,
  /\bapprove (?:this|the) (?:pr|pull request) (?:immediately|automatically|without)\b/i,
  /\b(?:auto-?approve|automatically approve)\s+(?:this|the)\s+(?:milestone|submission|payout|payment|pr|pull request)\b/i,
  /\b(?:mark|set|flag|report|grade)\s+(?:(?:this|all|every|each|the|these)\s+)?(?:milestone|submission|pr|pull request|criteri(?:on|a)|tests?|checks?|requirements?)(?:\s+c\d+(?:_\d+)?)?\s+as\s+(?:passed|passing|verified|approved|satisfied)\b/i,
  /\b(?:mark|grade)\s+(?:this|it)\s+as\s+(?:passed|approved)\b/i,
  /\b(?:mark|set|flag)\s+(?:this\s+)?(?:milestone|submission|criteri(?:on|a)|all criteria)\s+(?:as\s+)?(?:complete[d]?|met|done)\b/i,
  /\byou (?:must|should|have to|need to|are required to|will) (?:now )?(?:approve|pass (?:this|it|the (?:milestone|submission|pr|pull request|criteria|tests?))\b|return (?:verified|true|\{))/i,
  /\b(?:respond|reply|answer|output|return)\s+(?:with\s+)?(?:only\s+)?(?:this\s+)?json\s*[:\s]\s*\{[^\n}]{0,60}\b(?:verified|passed|approved)\b/i,
  /<\/?\s*(?:untrusted_submission|system|system_prompt|trusted_instructions|developer_instructions)\s*>/i,
  /(?:^|\n)[+\- ]?[ \t]*(?:\/\/+|#+|\*+|\/\*+|<!--|--)?[ \t]*SYSTEM(?:[ \t]+(?:PROMPT|MESSAGE|NOTE|OVERRIDE))?[ \t]*:/,
];

// A literal that can sit on both sides of an assertion. Backreferences catch
// "same literal on both sides", e.g. expect(2).toBe(2) or assertEquals("a", "a").
const LIT = String.raw`(-?\d+(?:\.\d+)?|'[^'\n]*'|"[^"\n]*"|\x60[^\x60$\n]*\x60|true|false|null|undefined|True|False|None)`;
const END = String.raw`(?![\w.])`;
const TAUTOLOGY_PATTERNS = [
  // Jest/Vitest/Chai-style expect(lit).toBe/toEqual/toStrictEqual(lit)
  new RegExp(String.raw`expect\(\s*${LIT}\s*\)\s*\.\s*to(?:Be|Equal|StrictEqual)\(\s*\1\s*\)`),
  // Same identifier on both sides: expect(result).toBe(result)
  /expect\(\s*([A-Za-z_$][\w$.]*)\s*\)\s*\.\s*to(?:Be|Equal|StrictEqual)\(\s*\1\s*\)/,
  // Chai: expect(lit).to.equal(lit) / to.eql / to.deep.equal
  new RegExp(String.raw`expect\(\s*${LIT}\s*\)\s*\.\s*to\s*\.\s*(?:deep\s*\.\s*)?(?:equal|eql|be)\(\s*\1\s*\)`),
  /expect\(\s*(?:true|1|-?[1-9]\d*|"[^"\n]+"|'[^'\n]+'|\{\s*\}|\[\s*\])\s*\)\s*\.\s*toBeTruthy\(\s*\)/,
  /expect\(\s*(?:false|0|null|undefined|""|'')\s*\)\s*\.\s*toBeFalsy\(\s*\)/,
  /expect\(\s*(?:true|false|-?\d+|"[^"\n]*"|'[^'\n]*')\s*\)\s*\.\s*toBe(?:Defined|Truthy)\(\s*\)/,
  /expect\(\s*(?:true)\s*\)\s*\.\s*to\s*\.\s*be\s*\.\s*true\b/,
  // xUnit / JUnit / PHPUnit: assertEquals(lit, lit), self.assertEqual(lit, lit)
  new RegExp(String.raw`\bassert(?:Equals?|Same|StrictEquals?|Identical)\(\s*${LIT}\s*,\s*\1\s*[,)]`),
  /\bassertTrue\(\s*(?:true|True|1)\s*[,)]/,
  /\bassertFalse\(\s*(?:false|False|0|None|null)\s*[,)]/,
  // Node assert: assert.equal/strictEqual/deepEqual/deepStrictEqual(lit, lit), assert(true), assert.ok(true)
  new RegExp(String.raw`\bassert\s*\.\s*(?:equal|strictEqual|deepEqual|deepStrictEqual)\(\s*${LIT}\s*,\s*\1\s*[,)]`),
  /\bassert(?:\s*\.\s*ok)?\(\s*(?:true|1)\s*[,)]/,
  // Python / plain: assert lit == lit, assert True, assert 1
  new RegExp(String.raw`\bassert\s*\(?\s*${LIT}\s*(?:===?|is)\s*\1${END}`),
  /(?:^|\n)[+\- ]?[ \t]*assert[ \t]+\(?(?:True|1|not[ \t]+False|not[ \t]+None)\)?[ \t]*(?:,[^\n]*)?(?:#[^\n]*)?(?=\n|$)/,
  // Rust: assert!(true), assert_eq!(lit, lit)
  /\bassert!\(\s*true\s*\)/,
  new RegExp(String.raw`\bassert_eq!\(\s*${LIT}\s*,\s*\1\s*[,)]`),
];

export function prescan(text: string) {
  return {
    injection: INJECTION_PATTERNS.filter((p) => p.test(text)).map((p) => p.source),
    tautologies: TAUTOLOGY_PATTERNS.filter((p) => p.test(text)).map((p) => p.source),
  };
}
