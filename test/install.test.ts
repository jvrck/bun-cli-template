import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Exercise install.sh end to end against a local mock of GitHub's release
// download and REST endpoints — no network, no real GitHub. A shell fixture
// stands in for the release binary (it prints its version), and a stub `gh` on
// PATH serves release files from disk so the gh channel is covered too.

const installer = join(import.meta.dir, "..", "install.sh");
const LATEST = "2026.10.06";
const OLDER = "2026.10.05";
const TOKEN = "test-token";
const PLATFORM_ASSETS = [
  "mytool-linux-x64",
  "mytool-linux-arm64",
  "mytool-linux-x64-musl",
  "mytool-darwin-arm64",
];

interface Release {
  tag: string;
  files: Record<string, string>;
}

// How the mock REST API lays out each asset object (all are valid JSON except
// "truncated"). Real GitHub puts "url" before "name"; nothing guarantees that.
type ApiStyle =
  | "url-first"
  | "name-first" // same members, "name" before "url"
  | "nested-url-only" // the asset object has no own "url"; only its nested uploader does
  | "sibling-decoy" // the asset has no "url"; a sibling asset with another name carries it
  | "body-decoy" // the asset has no "url"; the release notes text contains a look-alike object
  | "duplicate" // the asset appears twice
  | "id-mismatch" // own "id" disagrees with the id in its own "url"
  | "truncated"; // malformed JSON

interface Repo {
  private: boolean;
  prettyJson?: boolean;
  apiStyle?: ApiStyle;
  releases: Release[]; // last entry is "latest"
}

const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");

interface ReleaseOptions {
  omitAssets?: boolean;
  omitSums?: boolean;
  corrupt?: boolean;
  noEntry?: boolean;
  binary?: string;
}

function release(tag: string, opts: ReleaseOptions = {}): Release {
  const binary = opts.binary ?? `#!/bin/sh\necho ${tag}\n`;
  const files: Record<string, string> = {};
  if (!opts.omitAssets) for (const asset of PLATFORM_ASSETS) files[asset] = binary;
  if (!opts.omitSums) {
    const sum = opts.corrupt ? sha256("not the binary") : sha256(binary);
    files.SHA256SUMS = opts.noEntry
      ? `${sha256("other")}  some-other-asset\n`
      : PLATFORM_ASSETS.map((asset) => `${sum}  ${asset}\n`).join("");
  }
  return { tag, files };
}

const repos: Record<string, Repo> = {
  "acme/public-tool": { private: false, releases: [release(OLDER), release(LATEST)] },
  "acme/private-tool": { private: true, prettyJson: true, releases: [release(LATEST)] },
  "acme/private-compact": { private: true, releases: [release(LATEST)] },
  "acme/name-first-pretty": { private: true, prettyJson: true, apiStyle: "name-first", releases: [release(LATEST)] },
  "acme/name-first-compact": { private: true, apiStyle: "name-first", releases: [release(LATEST)] },
  "acme/nested-url-only": { private: true, apiStyle: "nested-url-only", releases: [release(LATEST)] },
  "acme/sibling-decoy": { private: true, apiStyle: "sibling-decoy", releases: [release(LATEST)] },
  "acme/body-decoy": { private: true, apiStyle: "body-decoy", releases: [release(LATEST)] },
  "acme/duplicate-asset": { private: true, apiStyle: "duplicate", releases: [release(LATEST)] },
  "acme/id-mismatch": { private: true, apiStyle: "id-mismatch", releases: [release(LATEST)] },
  "acme/truncated-json": { private: true, apiStyle: "truncated", releases: [release(LATEST)] },
  "acme/corrupt-tool": { private: false, releases: [release(LATEST, { corrupt: true })] },
  "acme/no-sums-tool": { private: false, releases: [release(LATEST, { omitSums: true })] },
  "acme/no-asset-tool": { private: false, releases: [release(LATEST, { omitAssets: true })] },
  "acme/no-entry-tool": { private: false, releases: [release(LATEST, { noEntry: true })] },
  "acme/wrong-version-tool": { private: false, releases: [release(LATEST, { binary: "#!/bin/sh\necho 1999.01.01\n" })] },
  "acme/broken-binary-tool": { private: false, releases: [release(LATEST, { binary: "#!/bin/sh\nexit 3\n" })] },
};

const assetIds = new Map<string, number>();
const assetsById = new Map<number, string>();
function assetId(repo: string, tag: string, name: string): number {
  const key = `${repo}|${tag}|${name}`;
  let id = assetIds.get(key);
  if (id === undefined) {
    id = assetIds.size + 1000;
    assetIds.set(key, id);
    assetsById.set(id, key);
  }
  return id;
}

function fileFor(key: string): string | undefined {
  const [repo, tag, name] = key.split("|");
  return repos[repo]?.releases.find((r) => r.tag === tag)?.files[name];
}

function releaseJson(slug: string, rel: Release, repo: Repo): string {
  const style = repo.apiStyle ?? "url-first";
  const assetUrl = (id: number) => `${base}/api/repos/${slug}/releases/assets/${id}`;
  const uploader = { login: "acme", id: 1, url: `${base}/api/users/acme`, type: "User" };
  const asset = (name: string): Record<string, unknown> => {
    const id = assetId(slug, rel.tag, name);
    const download = `${base}/${slug}/releases/download/${rel.tag}/${name}`;
    switch (style) {
      case "name-first":
        return { name, label: "", uploader, size: 1, id, node_id: "RA_fixture", url: assetUrl(id), browser_download_url: download };
      case "nested-url-only":
        return { name, id, uploader: { ...uploader, url: assetUrl(id) } };
      case "sibling-decoy":
        return { name, label: "" };
      case "body-decoy":
        return { name, id };
      case "id-mismatch":
        return { url: assetUrl(id), id: id + 1, name };
      default:
        return { url: assetUrl(id), id, node_id: "RA_fixture", name, label: "", uploader, browser_download_url: download };
    }
  };
  const names = Object.keys(rel.files);
  let assets = names.map(asset);
  if (style === "sibling-decoy") {
    assets = names.flatMap((name) => [asset(name), { name: `decoy-${name}`, url: assetUrl(assetId(slug, rel.tag, name)), id: assetId(slug, rel.tag, name) }]);
  }
  if (style === "duplicate") assets = [...assets, ...assets];
  const notes =
    style === "body-decoy"
      ? names.map((name) => `{"name":"${name}","url":"${assetUrl(assetId(slug, rel.tag, name))}"}`).join(" ")
      : 'Release notes with {braces}, [brackets] and "quotes".';
  const body = { url: `${base}/api/repos/${slug}/releases/1`, tag_name: rel.tag, name: rel.tag, body: notes, assets };
  const text = repo.prettyJson ? JSON.stringify(body, null, 2) : JSON.stringify(body);
  return style === "truncated" ? text.slice(0, Math.floor(text.length * 0.6)) : text;
}

let server: ReturnType<typeof Bun.serve>;
let base = "";
let otherHostBase = "";
let root = "";
let stubDir = "";
let ghRoot = "";
const authHeadersSeen: string[] = [];
const requests: { path: string; auth: string | null }[] = [];

function handle(req: Request): Response {
  const path = new URL(req.url).pathname;
  const notFound = new Response("Not Found", { status: 404 });
  const auth = req.headers.get("authorization");
  requests.push({ path, auth });
  if (auth) authHeadersSeen.push(auth);
  const authorized = auth === `Bearer ${TOKEN}`;

  // REST: /api/repos/<o>/<r>/releases/{latest|tags/<tag>|assets/<id>}
  let m = path.match(/^\/api\/repos\/([^/]+\/[^/]+)\/releases\/(?:(latest)|tags\/([^/]+)|assets\/(\d+))$/);
  if (m) {
    const [, slug, latest, tag, id] = m;
    const repo = repos[slug];
    if (!repo || (repo.private && !authorized)) return notFound; // GitHub hides private repos
    if (id) {
      const key = assetsById.get(Number(id));
      if (!key?.startsWith(`${slug}|`)) return notFound;
      // Like GitHub's signed-URL redirect, to a different host ("localhost" vs
      // "127.0.0.1"): curl must not forward the Authorization header there.
      return Response.redirect(`${otherHostBase}/blob/${id}`, 302);
    }
    const rel = latest ? repo.releases.at(-1) : repo.releases.find((r) => r.tag === tag);
    if (!rel) return notFound;
    return new Response(releaseJson(slug, rel, repo), { headers: { "content-type": "application/json" } });
  }

  m = path.match(/^\/blob\/(\d+)$/);
  if (m) {
    const key = assetsById.get(Number(m[1]));
    const data = key ? fileFor(key) : undefined;
    return data === undefined ? notFound : new Response(data);
  }

  // Web: /<o>/<r>/releases/latest (redirect) and /<o>/<r>/releases/download/<tag>/<name>
  m = path.match(/^\/([^/]+\/[^/]+)\/releases\/(?:(latest)|download\/([^/]+)\/([^/]+))$/);
  if (m) {
    const [, slug, latest, tag, name] = m;
    const repo = repos[slug];
    if (!repo || repo.private) return notFound; // anonymous web access to a private repo is a 404
    if (latest) {
      const rel = repo.releases.at(-1);
      return rel ? Response.redirect(`${base}/${slug}/releases/tag/${rel.tag}`, 302) : notFound;
    }
    const data = repo.releases.find((r) => r.tag === tag)?.files[name];
    return data === undefined ? notFound : new Response(data);
  }
  return notFound;
}

const GH_STUB = `#!/bin/sh
# Stub GitHub CLI for install tests: serves releases from $STUB_GH_ROOT/<owner>/<repo>/.
set -eu
[ "\${STUB_GH_AUTHED:-0}" = 1 ] || { echo "stub gh: not logged in" >&2; exit 1; }
cmd="$1 $2"; shift 2
repo=""; name=""; dir="."
case "$cmd" in
  "auth status") exit 0 ;;
  "release view")
    while [ $# -gt 0 ]; do case "$1" in -R) repo="$2"; shift 2 ;; *) shift ;; esac; done
    cat "$STUB_GH_ROOT/$repo/latest" ;;
  "release download")
    tag="$1"; shift
    while [ $# -gt 0 ]; do
      case "$1" in -R) repo="$2"; shift 2 ;; -p) name="$2"; shift 2 ;; -D) dir="$2"; shift 2 ;; *) shift ;; esac
    done
    src="$STUB_GH_ROOT/$repo/$tag/$name"
    [ -f "$src" ] || { echo "no assets match the file pattern" >&2; exit 1; }
    mkdir -p "$dir"; cp "$src" "$dir/$name" ;;
  *) echo "stub gh: unsupported: $cmd" >&2; exit 2 ;;
esac
`;

beforeAll(() => {
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handle });
  base = `http://127.0.0.1:${server.port}`;
  otherHostBase = `http://localhost:${server.port}`;
  root = mkdtempSync(join(tmpdir(), "mytool-install-test-"));
  stubDir = join(root, "stub-bin");
  ghRoot = join(root, "gh-releases");
  mkdirSync(stubDir);
  writeFileSync(join(stubDir, "gh"), GH_STUB);
  chmodSync(join(stubDir, "gh"), 0o755);
  for (const [slug, repo] of Object.entries(repos)) {
    mkdirSync(join(ghRoot, slug), { recursive: true });
    writeFileSync(join(ghRoot, slug, "latest"), `${repo.releases.at(-1)?.tag ?? ""}\n`);
    for (const rel of repo.releases) {
      mkdirSync(join(ghRoot, slug, rel.tag), { recursive: true });
      for (const [name, data] of Object.entries(rel.files)) writeFileSync(join(ghRoot, slug, rel.tag, name), data);
    }
  }
});

afterAll(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

async function install(repo: string, env: Record<string, string> = {}, existing?: string, pathPrefix = stubDir) {
  const dir = mkdtempSync(join(root, "run-"));
  const binDir = join(dir, "bin");
  if (existing !== undefined) {
    mkdirSync(binDir);
    writeFileSync(join(binDir, "mytool"), existing);
  }
  const proc = Bun.spawn(["bash", installer], {
    env: {
      PATH: `${pathPrefix}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      HOME: dir,
      BIN_DIR: binDir,
      MYTOOL_REPO: repo,
      MYTOOL_DOWNLOAD_BASE: base,
      MYTOOL_API_BASE: `${base}/api`,
      STUB_GH_ROOT: ghRoot,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  const installed = join(binDir, "mytool");
  const version = code === 0 && existsSync(installed)
    ? Bun.spawnSync([installed, "--version"]).stdout.toString().trim()
    : undefined;
  return { code, stderr, installed, version };
}

describe("install.sh (mock GitHub, no network)", () => {
  test("installs the latest release anonymously from a public repo", async () => {
    const result = await install("acme/public-tool");
    expect(result.code).toBe(0);
    expect(result.version).toBe(LATEST);
    expect(result.stderr).toContain("via anonymous");
  });

  test("installs a pinned version anonymously", async () => {
    const result = await install("acme/public-tool", { MYTOOL_VERSION: OLDER });
    expect(result.code).toBe(0);
    expect(result.version).toBe(OLDER);
  });

  test("a private repo without credentials fails clearly and installs nothing", async () => {
    const result = await install("acme/private-tool");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("anonymous: HTTP 404");
    expect(result.stderr).toContain("gh: gh is not authenticated");
    expect(result.stderr).toContain("token: GH_TOKEN/GITHUB_TOKEN is not set");
    expect(result.stderr).toContain("gh auth login");
    expect(existsSync(result.installed)).toBe(false);
  });

  test("token channel installs from a private repo (pretty-printed API JSON)", async () => {
    authHeadersSeen.length = 0;
    const result = await install("acme/private-tool", { MYTOOL_INSTALL_AUTH: "token", GH_TOKEN: TOKEN });
    expect(result.code).toBe(0);
    expect(result.version).toBe(LATEST);
    expect(result.stderr).toContain("via token");
    expect(authHeadersSeen).toContain(`Bearer ${TOKEN}`);
    expect(result.stderr).not.toContain(TOKEN);
  });

  test("auto falls back from anonymous to GITHUB_TOKEN for a private repo (compact API JSON)", async () => {
    const result = await install("acme/private-compact", { GITHUB_TOKEN: TOKEN });
    expect(result.code).toBe(0);
    expect(result.version).toBe(LATEST);
    expect(result.stderr).toContain("via token");
  });

  test("gh channel installs from a private repo with an authenticated gh", async () => {
    const result = await install("acme/private-tool", { MYTOOL_INSTALL_AUTH: "gh", STUB_GH_AUTHED: "1" });
    expect(result.code).toBe(0);
    expect(result.version).toBe(LATEST);
    expect(result.stderr).toContain("via gh");
  });

  test("anonymous-only mode does not fall back to credentials", async () => {
    const result = await install("acme/private-tool", { MYTOOL_INSTALL_AUTH: "anonymous", GH_TOKEN: TOKEN });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("anonymous:");
    expect(result.stderr).not.toContain("token:");
  });

  test("a rejected token fails with the HTTP status", async () => {
    const result = await install("acme/private-tool", { MYTOOL_INSTALL_AUTH: "token", GH_TOKEN: "wrong" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("token: HTTP 404");
  });

  test("a corrupt asset fails the checksum and leaves the existing install untouched", async () => {
    const result = await install("acme/corrupt-tool", {}, "old-binary");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("checksum mismatch");
    expect(readFileSync(result.installed, "utf8")).toBe("old-binary");
  });

  test("a release without SHA256SUMS fails clearly", async () => {
    const result = await install("acme/no-sums-tool");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("SHA256SUMS not found in release");
    expect(existsSync(result.installed)).toBe(false);
  });

  test("a release without the platform asset fails clearly", async () => {
    const result = await install("acme/no-asset-tool");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/mytool-[a-z0-9-]+ not found in release/);
    expect(existsSync(result.installed)).toBe(false);
  });

  test("the token never follows the asset redirect to another host", async () => {
    requests.length = 0;
    const result = await install("acme/private-compact", { MYTOOL_INSTALL_AUTH: "token", GH_TOKEN: TOKEN });
    expect(result.code).toBe(0);
    const blobs = requests.filter((r) => r.path.startsWith("/blob/"));
    expect(blobs.length).toBe(2); // the asset and SHA256SUMS
    expect(blobs.every((r) => r.auth === null)).toBe(true);
  });

  test("SHA256SUMS without an entry for the asset fails clearly", async () => {
    const result = await install("acme/no-entry-tool");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/SHA256SUMS in release \S+ has no entry for mytool-/);
    expect(existsSync(result.installed)).toBe(false);
  });

  test("a binary reporting the wrong version is not installed; the existing install stays", async () => {
    const result = await install("acme/wrong-version-tool", {}, "old-binary");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("reports version '1999.01.01', expected '2026.10.06'");
    expect(readFileSync(result.installed, "utf8")).toBe("old-binary");
  });

  test("a binary that fails to run is not installed; the existing install stays", async () => {
    const result = await install("acme/broken-binary-tool", {}, "old-binary");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("did not run (--version failed)");
    expect(readFileSync(result.installed, "utf8")).toBe("old-binary");
    expect(readdirSync(dirname(result.installed))).toEqual(["mytool"]); // no stray staged file
  });

  test("detects musl from ldd's banner even though musl ldd exits nonzero", async () => {
    const muslStubs = mkdtempSync(join(root, "musl-stubs-"));
    writeFileSync(join(muslStubs, "uname"), '#!/bin/sh\ncase "$1" in -s) echo Linux ;; -m) echo x86_64 ;; *) echo Linux ;; esac\n');
    writeFileSync(join(muslStubs, "ldd"), "#!/bin/sh\necho 'musl libc (x86_64)' >&2\necho 'Version 1.2.5' >&2\nexit 1\n");
    chmodSync(join(muslStubs, "uname"), 0o755);
    chmodSync(join(muslStubs, "ldd"), 0o755);
    requests.length = 0;
    const result = await install("acme/public-tool", {}, undefined, `${muslStubs}:${stubDir}`);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("asset=mytool-linux-x64-musl");
    expect(requests.some((r) => r.path.endsWith("/mytool-linux-x64-musl"))).toBe(true);
  });

  test("token channel finds the asset whatever the key order (name before url), pretty or compact", async () => {
    for (const repo of ["acme/name-first-pretty", "acme/name-first-compact"]) {
      const result = await install(repo, { MYTOOL_INSTALL_AUTH: "token", GH_TOKEN: TOKEN });
      expect(result.code).toBe(0);
      expect(result.version).toBe(LATEST);
    }
  });

  test("token channel: nested objects, sibling assets and release-notes text cannot supply the asset id", async () => {
    for (const repo of ["acme/nested-url-only", "acme/sibling-decoy", "acme/body-decoy"]) {
      const result = await install(repo, { MYTOOL_INSTALL_AUTH: "token", GH_TOKEN: TOKEN });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/token: mytool-[a-z0-9-]+ not found in release 2026\.10\.06/);
      expect(existsSync(result.installed)).toBe(false);
    }
  });

  test("token channel refuses a duplicated asset, an id/url disagreement and malformed JSON", async () => {
    for (const repo of ["acme/duplicate-asset", "acme/id-mismatch", "acme/truncated-json"]) {
      const result = await install(repo, { MYTOOL_INSTALL_AUTH: "token", GH_TOKEN: TOKEN });
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("ambiguous or malformed release data");
      expect(existsSync(result.installed)).toBe(false);
    }
  });

  test("an unknown MYTOOL_INSTALL_AUTH value is rejected", async () => {
    const result = await install("acme/public-tool", { MYTOOL_INSTALL_AUTH: "magic" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("MYTOOL_INSTALL_AUTH must be");
  });
});
