// Collects real, checkable evidence for a submission: the PR diff and CI
// check runs from GitHub, and live probes of staging endpoints.

const MAX_PATCH_CHARS = 120_000;

export interface PullRequestEvidence {
  url: string;
  title: string;
  body: string;
  headSha: string;
  files: { filename: string; status: string; additions: number; deletions: number }[];
  diff: string;
  diffTruncated: boolean;
  checks: { name: string; status: string; conclusion: string | null }[];
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

export function parsePrUrl(url: string) {
  const m = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub ${path} returned ${res.status}`);
  return res.json();
}

export async function fetchPullRequest(url: string): Promise<PullRequestEvidence> {
  const ref = parsePrUrl(url);
  if (!ref) throw new Error("Not a GitHub pull request URL");
  const base = `/repos/${ref.owner}/${ref.repo}`;

  const [pr, files] = await Promise.all([
    gh<any>(`${base}/pulls/${ref.number}`),
    gh<any[]>(`${base}/pulls/${ref.number}/files?per_page=100`),
  ]);

  let diff = "";
  let diffTruncated = false;
  for (const f of files) {
    const chunk = `--- ${f.filename} (${f.status})\n${f.patch ?? "[binary or too large]"}\n`;
    if (diff.length + chunk.length > MAX_PATCH_CHARS) {
      diffTruncated = true;
      break;
    }
    diff += chunk;
  }

  let checks: PullRequestEvidence["checks"] = [];
  try {
    const runs = await gh<any>(`${base}/commits/${pr.head.sha}/check-runs?per_page=100`);
    checks = runs.check_runs.map((r: any) => ({
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
    }));
  } catch {
    // Repos without Actions simply have no check runs.
  }

  return {
    url,
    title: pr.title,
    body: pr.body ?? "",
    headSha: pr.head.sha,
    files: files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
    diff,
    diffTruncated,
    checks,
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
const INJECTION_PATTERNS = [
  /ignore (all )?(the )?previous instructions/i,
  /ignore all (tests|test results)/i,
  /system prompt override/i,
  /you are (now )?the (grader|evaluator|verifier)/i,
  /(mark|set) (this|the milestone|all criteria) (as )?(passed|verified)/i,
];
const TAUTOLOGY_PATTERNS = [
  /expect\(\s*true\s*\)\.toBe\(\s*true\s*\)/,
  /assert\s+True\s*$/m,
  /assertEquals\(\s*true\s*,\s*true\s*\)/,
  /expect\(\s*1\s*\)\.toBe\(\s*1\s*\)/,
];

export function prescan(text: string) {
  return {
    injection: INJECTION_PATTERNS.filter((p) => p.test(text)).map((p) => p.source),
    tautologies: TAUTOLOGY_PATTERNS.filter((p) => p.test(text)).map((p) => p.source),
  };
}
