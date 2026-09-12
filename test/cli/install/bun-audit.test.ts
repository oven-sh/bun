import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exists, readlink } from "fs/promises";
import {
  DirectoryTree,
  VerdaccioRegistry,
  bunEnv,
  bunExe,
  gunzipJsonRequest,
  normalizeBunSnapshot,
  runBunInstall,
  tempDir,
} from "harness";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { bulkAdvisoryFixtureWith, resolveBulkAdvisoryFixture } from "./registry/fixtures/audit/audit-fixtures";

function fixture(
  folder:
    | "express@3"
    | "vuln-with-only-dev-dependencies"
    | "safe-is-number@7"
    | "mix-of-safe-and-vulnerable-dependencies",
) {
  return join(import.meta.dirname, "registry", "fixtures", "audit", folder);
}

let server: Bun.Server;
const verdaccio = new VerdaccioRegistry();

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: async req => {
      const body = await gunzipJsonRequest(req);

      const fixture = resolveBulkAdvisoryFixture(body);

      if (!fixture) {
        console.log("No fixture found for", body);
        return new Response("No fixture found", { status: 404 });
      }

      return Response.json(fixture);
    },
  });
  await verdaccio.start();
});

afterAll(() => {
  server?.stop();
  verdaccio.stop();
});

// Runs `bun audit` against the fixture server in a fresh copy of `files`: a fixture directory or a file tree.
async function auditProject(files: DirectoryTree | string, args: string[] = []) {
  using dir = tempDir("bun-test-audit-", files);
  await using proc = spawn({
    cmd: [bunExe(), "audit", ...args],
    cwd: dir,
    env: { ...bunEnv, NPM_CONFIG_REGISTRY: registryHref(server) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function doAuditTest(
  label: string,
  options: {
    args?: string[];
    exitCode: number;
    files: DirectoryTree | string;
    fn: (std: { stdout: string; stderr: string }) => Promise<void> | void;
  },
) {
  test.concurrent(label, async () => {
    const { stdout, stderr, exitCode } = await auditProject(options.files, options.args);
    try {
      await options.fn({ stdout, stderr });
      expect(exitCode).toBe(options.exitCode);
    } catch (e) {
      console.log("ERR:", stderr);
      console.log("OUT:", stdout);
      throw e;
    }
  });
}

type Advisory = { id: number; title: string; severity: string; url: string; vulnerable_versions: string };

function adv(range: string, id = 1): Advisory {
  return {
    id,
    title: "test advisory",
    severity: "high",
    url: "https://example.invalid/advisory/" + id,
    vulnerable_versions: range,
  };
}

type RegistryOptions = {
  // Serve the bulk response verbatim instead of filtering advisories by the submitted versions.
  bulkResponse?: unknown;
  // Served verbatim in request order; the last entry answers every later request.
  bulkResponses?: unknown[];
  bulkStatus?: number;
  // Every bulk request after this many answers 503; lets a test break the registry between the two audit fix requests.
  bulkFailAfter?: number;
  // Raw bulk response body served with status 200 (e.g. an HTML error page from a proxy).
  bulkBody?: string;
  // Incremented on every bulk request; lets a test prove the registry was never contacted.
  bulkHits?: { count: number };
  // Every bulk request's body, in request order.
  bulkBodies?: Record<string, string[]>[];
  // Package names whose manifest requests answer 404; mutable so a test can break the registry after installing.
  denyManifests?: Set<string>;
  // Tarball file names (`a-dep-1.0.4.tgz`) whose downloads answer 404. Only a registry with this set routes the
  // tarball downloads through itself; otherwise the manifests keep verdaccio's tarball URLs.
  denyTarballs?: Set<string>;
  // Publish times overlaid on a package's manifest: { "a-dep": { "1.0.4": iso } }.
  rewriteTime?: Record<string, Record<string, string>>;
};

// Answers the bulk-advisory endpoint itself and serves verdaccio's manifests, so a test can fail or edit either.
function startRegistry(advisories: Record<string, Advisory[]>, options: RegistryOptions = {}) {
  let bulkRequests = 0;
  return Bun.serve({
    port: 0,
    async fetch(req, proxy) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/-/npm/v1/security/advisories/bulk") {
        bulkRequests++;
        if (options.bulkHits) options.bulkHits.count++;
        const body: Record<string, string[]> = await gunzipJsonRequest(req);
        options.bulkBodies?.push(body);
        if (options.bulkStatus) return new Response("registry exploded", { status: options.bulkStatus });
        if (options.bulkFailAfter !== undefined && bulkRequests > options.bulkFailAfter) {
          return new Response("registry exploded", { status: 503 });
        }
        if (options.bulkBody !== undefined) {
          return new Response(options.bulkBody, { headers: { "content-type": "text/html" } });
        }
        if (options.bulkResponses) {
          return Response.json(options.bulkResponses[Math.min(bulkRequests - 1, options.bulkResponses.length - 1)]);
        }
        if (options.bulkResponse !== undefined) return Response.json(options.bulkResponse);
        const out: Record<string, Advisory[]> = {};
        for (const [name, versions] of Object.entries(body)) {
          const matching = (advisories[name] ?? []).filter(a =>
            versions.some(v => Bun.semver.satisfies(v, a.vulnerable_versions)),
          );
          if (matching.length > 0) out[name] = matching;
        }
        return Response.json(out);
      }

      const packageName = decodeURIComponent(url.pathname.slice(1));
      if (options.denyManifests?.has(packageName)) {
        return new Response("not found", { status: 404 });
      }
      if (options.denyTarballs?.has(url.pathname.slice(url.pathname.lastIndexOf("/") + 1))) {
        return new Response("not found", { status: 404 });
      }

      const { status, contentType, body } = await fromVerdaccio(req.method, url.pathname + url.search, req.headers);
      const headers = { "content-type": contentType };
      if (typeof body !== "string") return new Response(body, { status, headers });
      const manifest = options.denyTarballs ? body.replaceAll(verdaccio.registryUrl(), proxy.url.href) : body;
      const time = options.rewriteTime?.[packageName];
      if (!time) return new Response(manifest, { status, headers });
      const edited = JSON.parse(manifest);
      edited.time = { ...edited.time, ...time };
      return Response.json(edited, { status });
    },
  });
}

type Upstream = { status: number; contentType: string; body: string | ArrayBuffer };

// Verdaccio's answers do not change while the file runs, so every registry shares one copy of each successful one.
// Package documents are kept as text: the accept header is part of the key because it selects the abbreviated document.
const upstreamResponses = new Map<string, Promise<Upstream>>();

function fromVerdaccio(method: string, path: string, headers: Headers) {
  const accept = headers.get("accept") ?? "*/*";
  const key = `${method} ${path}\n${accept}`;
  let response = upstreamResponses.get(key);
  if (!response) {
    response = fetch(new URL(path, verdaccio.registryUrl()), { method, headers: { accept } }).then(
      async (up): Promise<Upstream> => {
        if (!up.ok) upstreamResponses.delete(key);
        const contentType = up.headers.get("content-type") ?? "application/octet-stream";
        const isDocument = up.ok && contentType.includes("json");
        return { status: up.status, contentType, body: isDocument ? await up.text() : await up.arrayBuffer() };
      },
    );
    upstreamResponses.set(key, response);
    response.catch(() => upstreamResponses.delete(key));
  }
  return response;
}

type Registry = ReturnType<typeof startRegistry>;

function registryHref(server: Registry) {
  return server.url.href.slice(0, -1);
}

function writeBunfig(
  dir: string,
  server: Registry | string,
  scopes?: Record<string, string>,
  install: Record<string, unknown> = {},
) {
  return write(
    join(dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: {
        cache: join(dir, ".bun-cache"),
        registry: typeof server === "string" ? server : server.url.href,
        saveTextLockfile: true,
        ...(scopes && { scopes }),
        ...install,
      },
    }),
  );
}

// A URL nothing listens on any more, for connection-refused cases.
async function deadRegistryHref() {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const href = server.url.href;
  await server.stop(true);
  return href;
}

// The CI runner exports one BUN_INSTALL_CACHE_DIR per file, which overrides the bunfig cache the concurrent cases rely on.
function installEnv(dir: string) {
  return { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache") };
}

// Each distinct project the tests start from is installed once, straight from verdaccio, and read back as the file
// tree tempDir recreates for every test that starts from it. The copy only meets a test's registry through the
// bunfig `setup` writes into it: both audit commands pick their registries from the config, not from bun.lock, and
// the verdaccio tarball URLs bun.lock keeps stay valid for the whole file. `laterPkgJsons` are installed on top of
// the first install, one after another, for trees a single install of the final package.json would not produce.
const installedTrees = new Map<string, Promise<DirectoryTree>>();

function installedTree(files: DirectoryTree, ...laterPkgJsons: object[]) {
  const key = JSON.stringify([files, laterPkgJsons]);
  let tree = installedTrees.get(key);
  if (!tree) {
    tree = installTemplate(files, laterPkgJsons);
    installedTrees.set(key, tree);
    // A failed install fails the case that started it; the next case installs the template again.
    tree.catch(() => installedTrees.delete(key));
  }
  return tree;
}

async function installTemplate(files: DirectoryTree, laterPkgJsons: object[]) {
  using root = tempDir("audit-template-", { project: files });
  const project = join(root, "project");
  const cache = join(root, ".bun-cache");
  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: cache };
  await writeBunfig(project, verdaccio.registryUrl(), undefined, { cache });
  await runBunInstall(env, project);
  for (const pkgJson of laterPkgJsons) {
    await write(join(project, "package.json"), JSON.stringify(pkgJson));
    await runBunInstall(env, project);
  }
  const tree = treeOf(project);
  delete tree["bunfig.toml"];
  return tree;
}

function treeOf(dir: string) {
  const tree: DirectoryTree = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const path = join(entry.parentPath, entry.name);
    if (!entry.isFile()) throw new Error(`${relative(dir, path)} is not a plain file, so this tree cannot be shared`);
    tree[relative(dir, path).split(sep).join("/")] = readFileSync(path);
  }
  return tree;
}

async function setup(
  server: Registry,
  pkgJson: object | string,
  extraFiles: Record<string, string> = {},
  scopes?: Record<string, string>,
) {
  const text = typeof pkgJson === "string" ? pkgJson : JSON.stringify(pkgJson);
  const files = { "package.json": text, ...extraFiles };
  // A workspace root installs with the isolated linker, whose node_modules is made of links tempDir cannot recreate.
  const shared = !("workspaces" in JSON.parse(text));
  const dir = tempDir("audit-fix-", shared ? await installedTree(files) : files);
  await writeBunfig(dir, server, scopes);
  if (!shared) await runBunInstall(installEnv(dir), dir);
  return dir;
}

function pkgJson(dir: string, ...segments: string[]) {
  return file(join(dir, ...segments, "package.json")).json();
}

function pkgJsonText(dir: string, ...segments: string[]) {
  return file(join(dir, ...segments, "package.json")).text();
}

async function reinstall(dir: string, pkgJson: object) {
  await write(join(dir, "package.json"), JSON.stringify(pkgJson));
  await runBunInstall(installEnv(dir), dir);
}

async function run(dir: string, args: string[], root: string = dir) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: installEnv(root),
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// The whole stderr of a fix that refuses to start because it would not be allowed to write bun.lock.
const FROZEN_ERROR =
  "error: bun audit fix needs to write bun.lock, but the lockfile is frozen\n" +
  "note: run 'bun audit fix' without --frozen-lockfile / --production\n";
const NO_SAVE_ERROR =
  "error: bun audit fix needs to write bun.lock, but saving the lockfile is disabled\n" +
  "note: run 'bun audit fix' without --no-save\n";
const MISSING_LOCKFILE = "error: missing lockfile, nothing to audit\nnote: run 'bun install' first";
const AUDIT_HEADER = "bun audit <version> (<revision>)\n\n";
const FIX_HEADER = "bun audit fix <version> (<revision>)\n\n";
const REPORT_FOOTER =
  "  bun audit fix           upgrade the vulnerable packages within their ranges\n" +
  "  bun audit fix --latest  also cross major versions";
// The `[12.00ms]` every summary line ends with; normalizeBunSnapshot strips it.
const DURATION = / \[\d+\.\d\dm?s\]\n$/;
// `bun audit` against a registry with `adv("<1.0.4")` for a-dep while a-dep@1.0.2 is a direct dependency.
const A_DEP_REPORT =
  AUDIT_HEADER +
  "a-dep@1.0.2\n" +
  "  (direct dependency)\n" +
  "  high: test advisory (<1.0.4) - https://example.invalid/advisory/1\n" +
  "\n" +
  "1 vulnerability (1 high)\n" +
  "\n" +
  REPORT_FOOTER;
// `bun audit fix` for the same advisory when a-dep@1.0.2 is the only package and its range admits 1.0.4 (as after
// `setupVulnerableADep`): the plan --dry-run prints, and the result of a real run.
const A_DEP_PLAN =
  FIX_HEADER + "fixing:\n  ^ a-dep 1.0.2 -> 1.0.4\n\nWould fix 1 vulnerability in 1 package (checked 1)";
const A_DEP_FIXED = FIX_HEADER + "fixing:\n  ^ a-dep 1.0.2 -> 1.0.4\n\nFixed 1 vulnerability in 1 package (checked 1)";
// The same two reports when package.json pins a-dep@1.0.2, so the fix rewrites the pin as well.
const A_DEP_PIN_PLAN = A_DEP_PLAN.replace("1.0.4\n", "1.0.4\n    package.json: 1.0.2 -> 1.0.4\n");
const A_DEP_PIN_FIXED = A_DEP_FIXED.replace("1.0.4\n", "1.0.4\n    package.json: 1.0.2 -> 1.0.4\n");
// Appended to a fix line when the version is younger than --minimum-release-age.
const TOO_NEW = "(newer than --minimum-release-age)";

function noVulnerabilities(checked: number, ...filtered: string[]) {
  const packages = `${checked} package${checked === 1 ? "" : "s"}`;
  return `No vulnerabilities found (checked ${[packages, ...filtered].join(", ")})`;
}

function skippedWarning(registry: string, status: string, ...packages: string[]) {
  return `warn: ${registry} did not answer the audit request (${status}); skipped ${packages.join(", ")}`;
}

// `bun audit` after a fix: the header, the no-op line with its counts, and nothing else on either stream.
function expectClean(result: { stdout: string; stderr: string; exitCode: number }, checked: number) {
  expect(normalizeBunSnapshot(result.stdout)).toBe(AUDIT_HEADER + noVulnerabilities(checked));
  expect(result.stdout).toMatch(DURATION);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
}

// What a fix that installs its plan prints on stderr, as `installLog` renders it: the install's two progress lines
// (how many tasks the second one counts depends on what the cache already held) and the save.
const INSTALLED_AND_SAVED = "Resolving dependencies\nResolved, downloaded and extracted [<n>]\nSaved lockfile\n";

function installLog(stderr: string) {
  return stderr.replace(/^(Resolved, downloaded and extracted) \[\d+\]$/m, "$1 [<n>]");
}

// The whole stderr of a fix that installed: whatever the audit itself printed first, then the install.
function expectSaved(stderr: string, ...auditLines: string[]) {
  expect(installLog(stderr)).toBe(auditLines.map(line => line + "\n").join("") + INSTALLED_AND_SAVED);
}

function auditFix(dir: string, ...args: string[]) {
  return run(dir, ["audit", "fix", ...args]);
}

function audit(dir: string, ...args: string[]) {
  return run(dir, ["audit", ...args]);
}

function lock(dir: string) {
  return file(join(dir, "bun.lock")).text();
}

async function installedVersion(dir: string, ...segments: string[]) {
  return (await file(join(dir, "node_modules", ...segments, "package.json")).json()).version;
}

// The versions at these node_modules paths, e.g. { "a-dep": "1.0.4", "uses-a-dep-2/node_modules/a-dep": "1.0.2" }.
async function installedVersions(dir: string, ...paths: string[]) {
  const entries = paths.map(async path => [path, await installedVersion(dir, ...path.split("/"))]);
  return Object.fromEntries(await Promise.all(entries));
}

// The version `dependent` resolves `name` to under the hoisted layout: its nested copy, else the root one.
async function resolvedVersion(dir: string, dependent: string, name: string) {
  if (await exists(join(dir, "node_modules", dependent, "node_modules", name))) {
    return installedVersion(dir, dependent, "node_modules", name);
  }
  return installedVersion(dir, name);
}

async function expectInstall(dir: string, ...args: string[]) {
  const { stderr, exitCode } = await run(dir, ["install", ...args]);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
}

// After a fix, a frozen install proves that bun.lock matches package.json and that node_modules already matches
// bun.lock: it prints its one summary line (the isolated linker words it differently) and installs nothing.
async function expectFrozenInstall(dir: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await run(dir, ["install", "--frozen-lockfile", ...args]);
  expect(normalizeBunSnapshot(stdout)).toMatch(
    /^bun install <version> \(<revision>\)\n\n(Done! )?Checked .* \(no changes\)$/,
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}

// Written after `setup` so the initial install runs without it; records the `name@version`s it was sent in scanned.json and flags the listed ones as fatal.
async function configureScanner(dir: string, server: Registry, fatal: string[] = []) {
  await write(
    join(dir, "scanner.ts"),
    `import { writeFileSync } from "node:fs";
     import { join } from "node:path";
     export const scanner = {
       version: "1",
       scan(payload: { packages: { name: string; version: string }[] }) {
         const packages = payload.packages.map(p => p.name + "@" + p.version).sort();
         writeFileSync(join(import.meta.dir, "scanned.json"), JSON.stringify(packages));
         console.error("SCANNER_RAN");
         return packages
           .filter(p => ${JSON.stringify(fatal)}.includes(p))
           .map(p => ({ package: p.slice(0, p.lastIndexOf("@")), level: "fatal", description: "blocked " + p, url: "https://example.invalid/scanner/" + p }));
       },
     };`,
  );
  await writeBunfig(dir, server, undefined, { security: { scanner: "./scanner.ts" } });
}

function scanned(dir: string): Promise<string[]> {
  return file(join(dir, "scanned.json")).json();
}

// stderr of a run with the scanner configured, without the timing line bun adds when a scan takes a second or more.
function scannerLog(stderr: string) {
  return stderr.replace(/^\[\.\/scanner\.ts\] Scanning .* took \d+ms\n/m, "");
}

// a-dep@1.0.2 stays installed after the range is widened because the still-satisfied edge is not re-resolved.
async function setupVulnerableADep(server: Registry) {
  const pinned = { "package.json": JSON.stringify({ name: "foo", dependencies: { "a-dep": "1.0.2" } }) };
  const dir = tempDir("audit-fix-", await installedTree(pinned, { name: "foo", dependencies: { "a-dep": "^1.0.2" } }));
  await writeBunfig(dir, server);
  expect(await lock(dir)).toContain('"a-dep@1.0.2"');
  return dir;
}

describe("`bun audit`", () => {
  // The report of the two fixtures whose only vulnerable package is ms@0.7.0, and the flags that ignore both advisories.
  const MS_REPORT =
    AUDIT_HEADER +
    "ms@0.7.0\n" +
    "  (direct dependency)\n" +
    "  moderate: Vercel ms Inefficient Regular Expression Complexity vulnerability (<2.0.0) - https://github.com/advisories/GHSA-w9mr-4mfr-499f\n" +
    "  high: Regular Expression Denial of Service in ms (<0.7.1) - https://github.com/advisories/GHSA-3fx5-fwvr-xrjg\n" +
    "\n" +
    "2 vulnerabilities (1 high, 1 moderate)\n" +
    "\n" +
    REPORT_FOOTER;
  const IGNORE_MS = "--ignore GHSA-w9mr-4mfr-499f --ignore GHSA-3fx5-fwvr-xrjg";

  doAuditTest("should fail with no package.json", {
    exitCode: 1,
    files: {
      "README.md": "This place sure is empty...",
    },
    fn: ({ stdout, stderr }) => {
      expect(stderr).toMatch(
        /^error: No package.json was found for directory "[^"\n]*bun-test-audit-[^"\n]*"\nnote: Run "bun init" to initialize a project\n$/,
      );
      expect(stdout).toBe("");
    },
  });

  doAuditTest("should fail with package.json but no lockfile", {
    exitCode: 1,
    files: {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "express": "3",
        },
      }),
    },
    fn: ({ stdout, stderr }) => {
      expect(normalizeBunSnapshot(stderr)).toBe(MISSING_LOCKFILE);
      expect(normalizeBunSnapshot(stdout)).toBe("bun audit <version> (<revision>)");
    },
  });

  doAuditTest("should exit 0 when there are no dependencies in package.json", {
    exitCode: 0,
    files: {
      // i deemed this small enough to justify not needing a fixture
      "package.json": JSON.stringify({
        name: "empty-package",
        version: "1.0.0",
      }),
      "bun.lock": JSON.stringify({
        "lockfileVersion": 1,
        "workspaces": {
          "": {
            "name": "empty-package",
          },
        },
        "packages": {},
      }),
    },
    fn: ({ stdout, stderr }) => {
      expect(normalizeBunSnapshot(stdout)).toBe(AUDIT_HEADER + noVulnerabilities(0));
      expect(stderr).toBe("");
    },
  });

  doAuditTest("should exit 0 when there are no vulnerabilities", {
    exitCode: 0,
    files: fixture("safe-is-number@7"),
    fn: ({ stdout, stderr }) => {
      expect(normalizeBunSnapshot(stdout)).toBe(AUDIT_HEADER + noVulnerabilities(1));
      expect(stdout).toMatch(DURATION);
      expect(stderr).toBe("");
    },
  });

  doAuditTest("should exit code 1 when there are vulnerabilities", {
    exitCode: 1,
    files: fixture("express@3"),
    fn: ({ stdout, stderr }) => {
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
        "bun audit <version> (<revision>)

        base64-url@1.2.1
          express > connect > csurf > csrf > uid-safe > base64-url
          high: Out-of-bounds Read in base64-url (<2.0.0) - https://github.com/advisories/GHSA-j4mr-9xw3-c9jx

        basic-auth-connect@1.0.0
          express > connect > basic-auth-connect
          high: basic-auth-connect's callback uses time unsafe string comparison (<1.1.0) - https://github.com/advisories/GHSA-7p89-p6hx-q4fw

        body-parser@1.13.3
          express > connect > body-parser
          high: body-parser vulnerable to denial of service when url encoding is enabled (<1.20.3) - https://github.com/advisories/GHSA-qwcr-r2fm-qrc7

        cookie@0.1.3
          express > connect > cookie
          low: cookie accepts cookie name, path, and domain with out of bounds characters (<0.7.0) - https://github.com/advisories/GHSA-pxg6-pf52-xh8x

        debug@2.2.0, 2.6.9
          express > connect > compression > debug
          high: debug Inefficient Regular Expression Complexity vulnerability (<2.6.9) - https://github.com/advisories/GHSA-9vvw-cc9w-f27h
          low: Regular Expression Denial of Service in debug (<2.6.9) - https://github.com/advisories/GHSA-gxpj-cx7g-858c

        express@3.21.2
          (direct dependency)
          low: Express Open Redirect vulnerability (>=3.4.5 <4.0.0-rc1) - https://github.com/advisories/GHSA-jj78-5fmv-mv28
          low: express vulnerable to XSS via response.redirect() (<4.20.0) - https://github.com/advisories/GHSA-qw6h-vgh9-j6wx
          moderate: Express ressource injection (<=3.21.4) - https://github.com/advisories/GHSA-cm5g-3pgc-8rg4
          moderate: Express.js Open Redirect in malformed URLs (<4.19.2) - https://github.com/advisories/GHSA-rv95-896h-c2vc

        fresh@0.3.0
          express > connect > fresh
          high: Regular Expression Denial of Service in fresh (<0.5.2) - https://github.com/advisories/GHSA-9qj9-36jm-prpv

        mime@1.3.4
          express > send > mime
          high: mime Regular Expression Denial of Service when MIME lookup performed on untrusted user input (<1.3.5) - https://github.com/advisories/GHSA-wrvr-8mpx-r7pp

        minimist@0.0.8
          express > mkdirp > minimist
          critical: Prototype Pollution in minimist (<0.2.4) - https://github.com/advisories/GHSA-xvch-5gv4-984h
          moderate: Prototype Pollution in minimist (<0.2.1) - https://github.com/advisories/GHSA-vh95-rmgr-6w4m

        morgan@1.6.1
          express > connect > morgan
          critical: Code Injection in morgan (<1.9.1) - https://github.com/advisories/GHSA-gwg9-rgvj-4h5j

        ms@0.7.1, 0.7.2, 2.0.0
          express > connect > serve-favicon > ms
          moderate: Vercel ms Inefficient Regular Expression Complexity vulnerability (<2.0.0) - https://github.com/advisories/GHSA-w9mr-4mfr-499f

        negotiator@0.5.3, 0.6.3
          express > connect > serve-index > accepts > negotiator
          high: Regular Expression Denial of Service in negotiator (<0.6.1) - https://github.com/advisories/GHSA-7mc5-chhp-fmc3

        qs@4.0.0
          express > connect > body-parser > qs
          high: qs vulnerable to Prototype Pollution (<6.2.4) - https://github.com/advisories/GHSA-hrpp-h998-j3pp
          high: Prototype Pollution Protection Bypass in qs (<6.0.4) - https://github.com/advisories/GHSA-gqgv-6jq5-jjj9

        send@0.13.0, 0.13.2
          express > send
          low: send vulnerable to template injection that can lead to XSS (<0.19.0) - https://github.com/advisories/GHSA-m6fv-jmcg-4jfg

        serve-static@1.10.3
          express > connect > serve-static
          low: serve-static vulnerable to template injection that can lead to XSS (<1.16.0) - https://github.com/advisories/GHSA-cm22-4g7w-348p

        21 vulnerabilities (2 critical, 9 high, 4 moderate, 6 low)

          bun audit fix           upgrade the vulnerable packages within their ranges
          bun audit fix --latest  also cross major versions"
      `);
      expect(stderr).toBe("");
    },
  });

  test.concurrent.each([
    ["--audit-level critical", ["2 below --audit-level=critical"]],
    [IGNORE_MS, ["2 ignored"]],
    ["--audit-level high --ignore GHSA-3fx5-fwvr-xrjg", ["1 below --audit-level=high", "1 ignored"]],
  ])("%s drops every advisory and the summary counts the drops as %j", async (args, dropped) => {
    const { stdout, stderr, exitCode } = await auditProject(
      fixture("vuln-with-only-dev-dependencies"),
      args.split(" "),
    );
    expect(normalizeBunSnapshot(stdout)).toBe(AUDIT_HEADER + noVulnerabilities(1, ...dropped));
    expect(stdout).toMatch(DURATION);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  doAuditTest("--json prints an empty object and exits 0 when there are no vulnerabilities", {
    exitCode: 0,
    files: fixture("safe-is-number@7"),
    args: ["--json"],
    fn: ({ stdout, stderr }) => {
      expect(stdout).toBe("{}\n");
      expect(stderr).toBe("");
    },
  });

  doAuditTest("--json prints the registry response as it is and exits 1 when there are vulnerabilities", {
    exitCode: 1,
    files: fixture("express@3"),
    args: ["--json"],
    fn: ({ stdout, stderr }) => {
      expect(JSON.parse(stdout)).toStrictEqual(bulkAdvisoryFixtureWith("express"));
      expect(stderr).toBe("");
    },
  });

  // The filters only decide the exit code: --json still prints every advisory the registry returned.
  test.concurrent.each([
    ["--audit-level critical", 0],
    [IGNORE_MS, 0],
    ["--audit-level high --ignore GHSA-w9mr-4mfr-499f", 1],
  ])("--json %s prints every advisory and exits %i", async (args, expectedExitCode) => {
    const { stdout, stderr, exitCode } = await auditProject(fixture("vuln-with-only-dev-dependencies"), [
      "--json",
      ...args.split(" "),
    ]);
    expect(JSON.parse(stdout)).toMatchInlineSnapshot(`
      {
        "ms": [
          {
            "cvss": {
              "score": 5.3,
              "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L",
            },
            "cwe": [
              "CWE-1333",
            ],
            "id": 1094419,
            "severity": "moderate",
            "title": "Vercel ms Inefficient Regular Expression Complexity vulnerability",
            "url": "https://github.com/advisories/GHSA-w9mr-4mfr-499f",
            "vulnerable_versions": "<2.0.0",
          },
          {
            "cvss": {
              "score": 7.5,
              "vectorString": "CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H",
            },
            "cwe": [
              "CWE-400",
              "CWE-1333",
            ],
            "id": 1098340,
            "severity": "high",
            "title": "Regular Expression Denial of Service in ms",
            "url": "https://github.com/advisories/GHSA-3fx5-fwvr-xrjg",
            "vulnerable_versions": "<0.7.1",
          },
        ],
      }
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(expectedExitCode);
  });

  // vuln-with-only-dev-dependencies has ms as a devDependency; mix-of-safe-and-vulnerable-dependencies also depends on
  // a safe is-number, which the report leaves out.
  test.concurrent.each(["vuln-with-only-dev-dependencies", "mix-of-safe-and-vulnerable-dependencies"] as const)(
    "%s prints the ms report and exits 1",
    async folder => {
      const { stdout, stderr, exitCode } = await auditProject(fixture(folder));
      expect(normalizeBunSnapshot(stdout)).toBe(MS_REPORT);
      expect(stderr).toBe("");
      expect(exitCode).toBe(1);
    },
  );

  const fakeIntegrity = // this is just random/fake data as the integrity check is not important for this test
    "sha512-V8E0l1jyyeSSS9R+J9oljx5eq2rqzClInuwaPcyuv0Mm3ViI/3/rcc4rCEO8i4eQ4I0O0FAGYDA2i5xWHHPhzg==";

  function scopedRegistryProject(scoped: Registry) {
    return {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          "@foo/bar": "1.0.0",
          "@foo/baz": "1.0.0",
        },
      }),
      "bun.lock": JSON.stringify({
        "lockfileVersion": 1,
        "workspaces": {
          "": {
            "name": "test",
          },
        },
        "packages": {
          "@foo/bar": ["@foo/bar@1.0.0", "", {}, fakeIntegrity],
          "@foo/baz": ["@foo/baz@1.0.0", "", {}, fakeIntegrity],
        },
      }),
      ".npmrc": `@foo:registry=${scoped.url.href}`,
    };
  }

  test.concurrent("packages served by a scoped registry are audited against that registry", async () => {
    await using scoped = startRegistry({}, { bulkResponse: { "@foo/bar": [adv("<2.0.0")] } });

    const { stdout, stderr, exitCode } = await auditProject(scopedRegistryProject(scoped));
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      @foo/bar@1.0.0
        high: test advisory (<2.0.0) - https://example.invalid/advisory/1

      1 vulnerability (1 high)

        bun audit fix           upgrade the vulnerable packages within their ranges
        bun audit fix --latest  also cross major versions"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
  });

  test.concurrent(
    "packages whose scoped registry does not answer the audit request are listed as skipped",
    async () => {
      await using scoped = startRegistry({}, { bulkStatus: 404 });

      const { stdout, stderr, exitCode } = await auditProject(scopedRegistryProject(scoped));
      expect(normalizeBunSnapshot(stderr)).toBe(skippedWarning(registryHref(scoped), "404", "@foo/bar", "@foo/baz"));
      expect(normalizeBunSnapshot(stdout)).toBe(AUDIT_HEADER + noVulnerabilities(0, "2 skipped"));
      expect(exitCode).toBe(0);
    },
  );

  doAuditTest("workspaces print the path to the vulnerable package and include workspace:pkg in the name", {
    exitCode: 1,
    files: {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        workspaces: ["a"],
      }),

      "a/package.json": JSON.stringify({
        "name": "a",
        "dependencies": {
          "ms": "0.7.0",
        },
      }),

      "bun.lock": JSON.stringify({
        "lockfileVersion": 1,
        "workspaces": {
          "": {
            "name": "bun-audit-playground",
          },
          "a": {
            "name": "a",
            "dependencies": {
              "ms": "0.7.0",
            },
          },
        },
        "packages": {
          "a": ["a@workspace:a"],
          "ms": ["ms@0.7.0", "", {}, fakeIntegrity],
        },
      }),
    },
    fn: ({ stdout, stderr }) => {
      expect(normalizeBunSnapshot(stdout)).toBe(MS_REPORT.replace("  (direct dependency)", "  workspace:a > ms"));
      expect(stderr).toBe("");
    },
  });

  doAuditTest("--audit-level critical only shows critical vulnerabilities", {
    exitCode: 1,
    files: fixture("express@3"),
    args: ["--audit-level", "critical"],
    fn: ({ stdout, stderr }) => {
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
        "bun audit <version> (<revision>)

        minimist@0.0.8
          express > mkdirp > minimist
          critical: Prototype Pollution in minimist (<0.2.4) - https://github.com/advisories/GHSA-xvch-5gv4-984h

        morgan@1.6.1
          express > connect > morgan
          critical: Code Injection in morgan (<1.9.1) - https://github.com/advisories/GHSA-gwg9-rgvj-4h5j

        2 vulnerabilities (2 critical)

          bun audit fix           upgrade the vulnerable packages within their ranges
          bun audit fix --latest  also cross major versions"
      `);
      expect(stderr).toBe("");
    },
  });

  doAuditTest("--audit-level validates input and rejects invalid levels", {
    exitCode: 1,
    files: fixture("safe-is-number@7"),
    args: ["--audit-level", "invalid"],
    fn: ({ stdout, stderr }) => {
      expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(
        `"error: invalid \`--audit-level\` value: 'invalid'. Valid values are: low, moderate, high, critical"`,
      );
      expect(stdout).toBe("");
    },
  });

  test.concurrent.each(["low", "moderate", "high", "critical"])("--audit-level %s is accepted", async level => {
    const { stdout, stderr, exitCode } = await auditProject(fixture("safe-is-number@7"), ["--audit-level", level]);
    expect(normalizeBunSnapshot(stdout)).toBe(AUDIT_HEADER + noVulnerabilities(1));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  doAuditTest("--prod keeps a vulnerable production dependency in the report", {
    exitCode: 1,
    files: fixture("mix-of-safe-and-vulnerable-dependencies"),
    args: ["--prod"],
    fn: ({ stdout, stderr }) => {
      expect(normalizeBunSnapshot(stdout)).toBe(MS_REPORT);
      expect(stderr).toBe("");
    },
  });

  // GHSA-gwg9-rgvj-4h5j is the only advisory for morgan, one of the two critical ones in express@3.
  doAuditTest("--ignore drops the advisory and its package from the report and the counts", {
    exitCode: 1,
    files: fixture("express@3"),
    args: ["--ignore", "GHSA-gwg9-rgvj-4h5j"],
    fn: ({ stdout, stderr }) => {
      const out = normalizeBunSnapshot(stdout);
      expect(out).not.toContain("morgan");
      expect(out).toEndWith("\n20 vulnerabilities (1 critical, 9 high, 4 moderate, 6 low)\n\n" + REPORT_FOOTER);
      expect(stderr).toBe("");
    },
  });

  test.concurrent("sends a well-formed JSON request body when a package name contains a double quote", async () => {
    const packageName = 'a"b';
    let receivedBody = "";
    await using auditServer = Bun.serve({
      port: 0,
      fetch: async req => {
        receivedBody = Buffer.from(Bun.gunzipSync(await req.arrayBuffer())).toString("utf-8");
        return Response.json({});
      },
    });
    using dir = tempDir("bun-test-audit-name-with-quote", {
      "package.json": JSON.stringify({
        name: "test",
        version: "1.0.0",
        dependencies: {
          [packageName]: "1.0.0",
        },
      }),
      "bun.lock": JSON.stringify({
        "lockfileVersion": 1,
        "workspaces": {
          "": {
            "name": "test",
            "dependencies": {
              [packageName]: "1.0.0",
            },
          },
        },
        "packages": {
          [packageName]: [`${packageName}@1.0.0`, "", {}, fakeIntegrity],
        },
      }),
    });

    await using proc = spawn({
      cmd: [bunExe(), "audit"],
      cwd: dir,
      env: { ...bunEnv, NPM_CONFIG_REGISTRY: auditServer.url.href },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(receivedBody)).toStrictEqual({ [packageName]: ["1.0.0"] });
    expect(normalizeBunSnapshot(stdout)).toBe(AUDIT_HEADER + noVulnerabilities(1));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

// Every audit line that names a registry prints it through the same redaction as the install error lines, which
// replaces an npm token or UUID anywhere in the URL with `***`; the skipped-registry record (the warning and the
// `unaudited` entries of `audit fix --json`) additionally leaves out credentials written into the URL itself. Most
// of these tests put the token in the registry path because that reaches the audit command from every config
// source, while `user:password@` is split out of the URL by some of them (`.npmrc`, bunfig registry strings) and
// kept by others (the bunfig object form used below, the env vars today).
describe("`bun audit` with a secret in the registry URL", () => {
  const SECRET = "npm_" + "secret".padEnd(36, "0");
  const BULK_PATH = "/-/npm/v1/security/advisories/bulk";
  const NON_JSON = (registry: string) => `error: ${registry} returned a non-JSON audit response`;

  // `url` is what the project is configured with, `printed` is how every audit line must render it.
  function secretRegistry(registry: Registry) {
    return { url: `${registry.url}${SECRET}/`, printed: `${registry.url}***` };
  }

  // The bulk endpoint lives under the token path, so the registry answers every request the same way.
  function registryAnswering(body: string, init?: ResponseInit) {
    return Bun.serve({ port: 0, fetch: () => new Response(body, init) });
  }

  // `bun audit` only reads bun.lock, so the project never needs an install.
  function project(dependencies: Record<string, string>, extraFiles: Record<string, string> = {}) {
    return tempDir("audit-registry-secret-", {
      "package.json": JSON.stringify({ name: "app", dependencies }),
      "bun.lock": JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "app", dependencies } },
        packages: Object.fromEntries(
          Object.entries(dependencies).map(([name, version]) => [name, [`${name}@${version}`, "", {}, ""]]),
        ),
      }),
      ...extraFiles,
    });
  }

  async function auditAgainst(dir: string, defaultRegistry: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), "audit", ...args],
      cwd: String(dir),
      env: { ...bunEnv, NPM_CONFIG_REGISTRY: defaultRegistry },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("the failed POST line masks the secret", async () => {
    await using registry = registryAnswering("not found", { status: 404 });
    const { url, printed } = secretRegistry(registry);
    using dir = project({ "no-deps": "1.0.0" });

    const { stdout, stderr, exitCode } = await auditAgainst(dir, url);
    expect(normalizeBunSnapshot(stderr)).toBe(`error: POST ${printed}${BULK_PATH} - 404`);
    expect(normalizeBunSnapshot(stdout)).toBe("bun audit <version> (<revision>)");
    expect(exitCode).toBe(1);
  });

  test.concurrent("the non-JSON response line masks the secret", async () => {
    await using registry = registryAnswering("<html><body>sign in</body></html>");
    const { url, printed } = secretRegistry(registry);
    using dir = project({ "no-deps": "1.0.0" });

    const { stdout, stderr, exitCode } = await auditAgainst(dir, url);
    expect(normalizeBunSnapshot(stderr)).toBe(NON_JSON(printed));
    expect(normalizeBunSnapshot(stdout)).toBe("bun audit <version> (<revision>)");
    expect(exitCode).toBe(1);
  });

  // A body starting with `{` gets past the response check and is rejected when it is parsed instead; the report,
  // --json and fix code paths each report that themselves.
  test.concurrent("the unparsable response line masks the secret in every mode", async () => {
    const body = "{ not json";
    await using registry = registryAnswering(body);
    const { url, printed } = secretRegistry(registry);
    using dir = project({ "no-deps": "1.0.0" });

    const report = await auditAgainst(dir, url);
    expect(normalizeBunSnapshot(report.stderr)).toBe(NON_JSON(printed));
    expect(normalizeBunSnapshot(report.stdout)).toBe("bun audit <version> (<revision>)");
    expect(report.exitCode).toBe(1);

    const json = await auditAgainst(dir, url, "--json");
    expect(normalizeBunSnapshot(json.stderr)).toBe(NON_JSON(printed));
    expect(json.stdout).toBe(body + "\n");
    expect(json.exitCode).toBe(1);

    const fix = await auditAgainst(dir, url, "fix");
    expect(normalizeBunSnapshot(fix.stderr)).toBe(NON_JSON(printed));
    expect(normalizeBunSnapshot(fix.stdout)).toBe("bun audit fix <version> (<revision>)");
    expect(fix.exitCode).toBe(1);
  });

  // `bun audit` and `bun audit fix --json` against a project whose only package comes from a scoped registry that
  // answers 404, so both commands report that registry as skipped; `printed` is how it must be named.
  async function expectSkippedRegistry(dir: string, printed: string) {
    const skipped = skippedWarning(printed, "404", "@foo/bar");

    const report = await auditAgainst(dir, registryHref(server));
    expect(normalizeBunSnapshot(report.stderr)).toBe(skipped);
    expect(normalizeBunSnapshot(report.stdout)).toBe(AUDIT_HEADER + noVulnerabilities(0, "1 skipped"));
    expect(report.exitCode).toBe(0);

    const fix = await auditAgainst(dir, registryHref(server), "fix", "--json");
    expect(normalizeBunSnapshot(fix.stderr)).toBe(skipped);
    expect(JSON.parse(fix.stdout)).toStrictEqual({
      dryRun: false,
      fixed: 0,
      remaining: 0,
      fixes: [],
      blocked: [],
      unfixable: [],
      manifestUnavailable: [],
      unmatched: [],
      unaudited: [{ registry: printed, packages: ["@foo/bar"], reason: "404" }],
      vulnerableAfterInstall: [],
    });
    expect(fix.exitCode).toBe(0);
  }

  test.concurrent("the skipped registry warning and the --json unaudited entry mask the secret", async () => {
    await using scoped = registryAnswering("not found", { status: 404 });
    const { url, printed } = secretRegistry(scoped);
    using dir = project({ "@foo/bar": "1.0.0" }, { ".npmrc": `@foo:registry=${url}\n` });

    await expectSkippedRegistry(dir, printed);
  });

  test.concurrent("the skipped registry warning and the --json unaudited entry leave out URL credentials", async () => {
    await using scoped = registryAnswering("not found", { status: 404 });
    const url = `${scoped.url.protocol}//alice:s3cret@${scoped.url.host}/`;
    using dir = project({ "@foo/bar": "1.0.0" }, { "bunfig.toml": `[install.scopes]\nfoo = { url = "${url}" }\n` });

    await expectSkippedRegistry(dir, registryHref(scoped));
  });
});

describe("`bun audit --prod`", () => {
  // pnpm#13605: an optional peer that only a devDependency brought in is not a production dependency.
  test.concurrent("bun audit --prod skips a dev-only optional peer of a production package", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "one-optional-peer-dep": "1.0.2" },
      devDependencies: { "no-deps": "1.0.0" },
    });
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const all = await audit(dir);
    expect(normalizeBunSnapshot(all.stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      no-deps@1.0.0
        (direct dependency)
        one-optional-peer-dep > no-deps
        high: test advisory (<1.0.1) - https://example.invalid/advisory/1

      1 vulnerability (1 high)

        bun audit fix           upgrade the vulnerable packages within their ranges
        bun audit fix --latest  also cross major versions"
    `);
    expect(all.stderr).toBe("");
    expect(all.exitCode).toBe(1);

    expectClean(await audit(dir, "--prod"), 1);
  });

  // pnpm#13605: production status is per installed version, not per name.
  test.concurrent(
    "bun audit --prod skips a dev-only version of a name that is also a production dependency",
    async () => {
      await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
      using dir = await setup(server, {
        name: "foo",
        dependencies: { "one-dep": "1.0.0" },
        devDependencies: { "no-deps": "1.0.0" },
      });
      const lockfile = await lock(dir);
      expect(lockfile).toContain('"no-deps@1.0.0"');
      expect(lockfile).toContain('"no-deps@1.0.1"');

      const all = await audit(dir);
      expect(normalizeBunSnapshot(all.stdout)).toMatchInlineSnapshot(`
        "bun audit <version> (<revision>)

        no-deps@1.0.0, 1.0.1
          (direct dependency)
          one-dep > no-deps
          high: test advisory (<1.0.1) - https://example.invalid/advisory/1

        1 vulnerability (1 high)

          bun audit fix           upgrade the vulnerable packages within their ranges
          bun audit fix --latest  also cross major versions"
      `);
      expect(all.stderr).toBe("");
      expect(all.exitCode).toBe(1);

      expectClean(await audit(dir, "--prod"), 2);
    },
  );

  test.concurrent(
    "bun audit --prod still reports the production version of a name that also has a dev version",
    async () => {
      await using server = startRegistry({ "no-deps": [adv("1.0.1")] });
      using dir = await setup(server, {
        name: "foo",
        dependencies: { "one-dep": "1.0.0" },
        devDependencies: { "no-deps": "1.0.0" },
      });

      const { stdout, stderr, exitCode } = await audit(dir, "--prod");
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
        "bun audit <version> (<revision>)

        no-deps@1.0.1
          (direct dependency)
          one-dep > no-deps
          high: test advisory (1.0.1) - https://example.invalid/advisory/1

        1 vulnerability (1 high)

          bun audit fix           upgrade the vulnerable packages within their ranges
          bun audit fix --latest  also cross major versions"
      `);
      expect(stderr).toBe("");
      expect(exitCode).toBe(1);
    },
  );
});

describe("`bun audit --omit`", () => {
  // The report for the one advisory on a direct no-deps@1.0.0 dependency, whichever group declares it.
  const NO_DEPS_REPORT =
    AUDIT_HEADER +
    "no-deps@1.0.0\n" +
    "  (direct dependency)\n" +
    "  high: test advisory (<1.0.1) - https://example.invalid/advisory/1\n" +
    "\n" +
    "1 vulnerability (1 high)\n" +
    "\n" +
    REPORT_FOOTER;

  function expectNoDepsReport({ stdout, stderr, exitCode }: { stdout: string; stderr: string; exitCode: number }) {
    expect(normalizeBunSnapshot(stdout)).toBe(NO_DEPS_REPORT);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
  }

  test.concurrent.each(["dev", "optional", "peer"] as const)(
    "--omit=%s skips packages only reached that way",
    async kind => {
      await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
      const field = { dev: "devDependencies", optional: "optionalDependencies", peer: "peerDependencies" }[kind];
      using dir = await setup(server, { name: "foo", [field]: { "no-deps": "1.0.0" } });
      expect(await lock(dir)).toContain('"no-deps@1.0.0"');

      expectNoDepsReport(await audit(dir));
      expectClean(await audit(dir, `--omit=${kind}`), 0);
    },
  );

  test.concurrent("--omit=optional keeps auditing dev dependencies", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", devDependencies: { "no-deps": "1.0.0" } });

    expectNoDepsReport(await audit(dir, "--omit=optional"));
  });

  test.concurrent("--prod in a workspace is scoped to the workspace the command runs in", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")], "a-dep": [adv("<1.0.4", 2)] });
    using dir = await setup(
      server,
      { name: "root", workspaces: ["packages/*"] },
      {
        "packages/a/package.json": JSON.stringify({ name: "a", devDependencies: { "no-deps": "1.0.0" } }),
        "packages/b/package.json": JSON.stringify({ name: "b", dependencies: { "a-dep": "1.0.2" } }),
      },
    );
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).toContain('"a-dep@1.0.2"');

    const fromRoot = await audit(dir, "--prod");
    expect(normalizeBunSnapshot(fromRoot.stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      a-dep@1.0.2
        workspace:b > a-dep
        high: test advisory (<1.0.4) - https://example.invalid/advisory/2

      1 vulnerability (1 high)

        bun audit fix           upgrade the vulnerable packages within their ranges
        bun audit fix --latest  also cross major versions"
    `);
    expect(fromRoot.stderr).toBe("");
    expect(fromRoot.exitCode).toBe(1);

    const fromRootOmit = await audit(dir, "--omit=dev");
    expect(normalizeBunSnapshot(fromRootOmit.stdout)).toBe(normalizeBunSnapshot(fromRoot.stdout));
    expect(fromRootOmit.stderr).toBe("");
    expect(fromRootOmit.exitCode).toBe(1);

    expectClean(await run(join(dir, "packages", "a"), ["audit", "--prod"], dir), 0);

    const fromB = await run(join(dir, "packages", "b"), ["audit", "--prod"], dir);
    expect(normalizeBunSnapshot(fromB.stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      a-dep@1.0.2
        (direct dependency)
        workspace:b > a-dep
        high: test advisory (<1.0.4) - https://example.invalid/advisory/2

      1 vulnerability (1 high)

        bun audit fix           upgrade the vulnerable packages within their ranges
        bun audit fix --latest  also cross major versions"
    `);
    expect(fromB.stderr).toBe("");
    expect(fromB.exitCode).toBe(1);

    const fromAAll = await run(join(dir, "packages", "a"), ["audit"], dir);
    expect(normalizeBunSnapshot(fromAAll.stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      a-dep@1.0.2
        workspace:b > a-dep
        high: test advisory (<1.0.4) - https://example.invalid/advisory/2

      no-deps@1.0.0
        (direct dependency)
        workspace:a > no-deps
        high: test advisory (<1.0.1) - https://example.invalid/advisory/1

      2 vulnerabilities (2 high)

        bun audit fix           upgrade the vulnerable packages within their ranges
        bun audit fix --latest  also cross major versions"
    `);
    expect(fromAAll.stderr).toBe("");
    expect(fromAAll.exitCode).toBe(1);
  });

  test.concurrent("--json --prod sends only production packages and prints the empty response", async () => {
    const bulkBodies: Record<string, string[]>[] = [];
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] }, { bulkBodies });
    using dir = await setup(server, { name: "foo", devDependencies: { "no-deps": "1.0.0" } });

    const all = await audit(dir, "--json");
    expect(JSON.parse(all.stdout)).toStrictEqual({ "no-deps": [adv("<1.0.1")] });
    expect(all.stderr).toBe("");
    expect(all.exitCode).toBe(1);

    const prod = await audit(dir, "--json", "--prod");
    expect(prod.stdout).toBe("{}\n");
    expect(prod.stderr).toBe("");
    expect(prod.exitCode).toBe(0);
    expect(bulkBodies).toStrictEqual([{ "no-deps": ["1.0.0"] }, {}]);
  });

  test.concurrent("-p and -P are accepted as --prod", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", devDependencies: { "no-deps": "1.0.0" } });

    expectNoDepsReport(await audit(dir));
    for (const flag of ["-p", "-P", "--production"]) {
      expectClean(await audit(dir, flag), 0);
    }
  });
});

describe("`bun audit` report", () => {
  test.concurrent("an unknown severity is counted and filtered as moderate", async () => {
    await using server = startRegistry({ "a-dep": [{ ...adv("<1.0.4"), severity: "info" }] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });

    const report = await audit(dir);
    expect(normalizeBunSnapshot(report.stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      a-dep@1.0.2
        (direct dependency)
        moderate: test advisory (<1.0.4) - https://example.invalid/advisory/1

      1 vulnerability (1 moderate)

        bun audit fix           upgrade the vulnerable packages within their ranges
        bun audit fix --latest  also cross major versions"
    `);
    expect(report.stderr).toBe("");
    expect(report.exitCode).toBe(1);

    const high = await audit(dir, "--audit-level=high");
    expect(normalizeBunSnapshot(high.stdout)).toBe(AUDIT_HEADER + noVulnerabilities(1, "1 below --audit-level=high"));
    expect(high.stderr).toBe("");
    expect(high.exitCode).toBe(0);

    const moderate = await audit(dir, "--audit-level=moderate");
    expect(normalizeBunSnapshot(moderate.stdout)).toBe(normalizeBunSnapshot(report.stdout));
    expect(moderate.stderr).toBe("");
    expect(moderate.exitCode).toBe(1);
  });

  test.concurrent("names the installed version, one range per advisory, and ends on the fix commands", async () => {
    await using server = startRegistry({
      "no-deps": [
        { ...adv("<1.1.0", 1), severity: "moderate", title: "ReDoS in no-deps" },
        { ...adv("<1.0.2", 2), title: "escaping in no-deps" },
      ],
      "a-dep": [adv("<1.0.4", 3)],
    });
    using dir = await setup(server, { name: "foo", dependencies: { "one-dep": "1.0.0", "a-dep": "1.0.2" } });
    expect(await lock(dir)).toContain('"no-deps@1.0.1"');

    const { stdout, stderr, exitCode } = await audit(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      a-dep@1.0.2
        (direct dependency)
        high: test advisory (<1.0.4) - https://example.invalid/advisory/3

      no-deps@1.0.1
        one-dep > no-deps
        moderate: ReDoS in no-deps (<1.1.0) - https://example.invalid/advisory/1
        high: escaping in no-deps (<1.0.2) - https://example.invalid/advisory/2

      3 vulnerabilities (2 high, 1 moderate)

        bun audit fix           upgrade the vulnerable packages within their ranges
        bun audit fix --latest  also cross major versions"
    `);
    expect(stdout).toEndWith("also cross major versions\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
  });

  test.concurrent("writes nothing", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });
    const lockBefore = await lock(dir);
    const pkgJsonBefore = await pkgJsonText(dir);

    const { stdout, stderr, exitCode } = await audit(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_REPORT);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
  });

  test.concurrent(
    "`bun audit --fix` is not `bun audit fix`: the unknown flag is ignored and a plain audit runs",
    async () => {
      const bulkHits = { count: 0 };
      await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { bulkHits });
      using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });
      const lockBefore = await lock(dir);
      const pkgJsonBefore = await pkgJsonText(dir);

      const plain = await audit(dir);
      expect(normalizeBunSnapshot(plain.stdout)).toBe(A_DEP_REPORT);
      expect(plain.stderr).toBe("");
      expect(plain.exitCode).toBe(1);
      expect(bulkHits.count).toBe(1);

      const withFix = await audit(dir, "--fix");
      expect(normalizeBunSnapshot(withFix.stdout)).toBe(A_DEP_REPORT);
      expect(withFix.stderr).toBe("");
      expect(withFix.exitCode).toBe(1);
      expect(bulkHits.count).toBe(2);
      expect(await lock(dir)).toBe(lockBefore);
      expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
    },
  );

  test.concurrent("`bun audit -L` is rejected before the registry is contacted", async () => {
    const bulkHits = { count: 0 };
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { bulkHits });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });

    const { stdout, stderr, exitCode } = await audit(dir, "-L");
    expect(stderr).toBe("error: --latest only applies to bun audit fix\n");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
    expect(bulkHits.count).toBe(0);
  });

  test.concurrent("advisories from the default and a scoped registry are merged into one report", async () => {
    await using scoped = startRegistry({ "@types/is-number": [adv("<2.0.0", 2)] });
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(
      server,
      { name: "foo", dependencies: { "@types/is-number": "1.0.0", "a-dep": "1.0.2" } },
      {},
      { types: scoped.url.href },
    );

    const report = await audit(dir);
    expect(normalizeBunSnapshot(report.stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      @types/is-number@1.0.0
        (direct dependency)
        high: test advisory (<2.0.0) - https://example.invalid/advisory/2

      a-dep@1.0.2
        (direct dependency)
        high: test advisory (<1.0.4) - https://example.invalid/advisory/1

      2 vulnerabilities (2 high)

        bun audit fix           upgrade the vulnerable packages within their ranges
        bun audit fix --latest  also cross major versions"
    `);
    expect(report.stderr).toBe("");
    expect(report.exitCode).toBe(1);

    const json = await audit(dir, "--json");
    expect(json.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(json.stdout)).toStrictEqual({
      "a-dep": [adv("<1.0.4")],
      "@types/is-number": [adv("<2.0.0", 2)],
    });
    expect(json.stderr).toBe("");
    expect(json.exitCode).toBe(1);
  });

  test.concurrent("--json prints an unparsable response and reports the parse failure", async () => {
    const body = "<html><body>registry is down</body></html>";
    await using server = startRegistry({}, { bulkBody: body });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });

    const { stdout, stderr, exitCode } = await audit(dir, "--json");
    expect(stdout).toBe(body + "\n");
    expect(normalizeBunSnapshot(stderr)).toBe(`error: ${registryHref(server)} returned a non-JSON audit response`);
    expect(exitCode).toBe(1);

    const text = await audit(dir);
    expect(normalizeBunSnapshot(text.stdout)).toBe("bun audit <version> (<revision>)");
    expect(normalizeBunSnapshot(text.stderr)).toBe(`error: ${registryHref(server)} returned a non-JSON audit response`);
    expect(text.exitCode).toBe(1);
  });

  test.concurrent("a response whose root is not an object is a parse failure", async () => {
    await using server = startRegistry({}, { bulkBody: "[]" });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });
    const lockBefore = await lock(dir);

    const json = await audit(dir, "--json");
    expect(json.stdout).toBe("[]\n");
    expect(normalizeBunSnapshot(json.stderr)).toBe(`error: ${registryHref(server)} returned a non-JSON audit response`);
    expect(json.exitCode).toBe(1);

    const fix = await auditFix(dir);
    expect(normalizeBunSnapshot(fix.stderr)).toBe(`error: ${registryHref(server)} returned a non-JSON audit response`);
    expect(normalizeBunSnapshot(fix.stdout)).toBe("bun audit fix <version> (<revision>)");
    expect(fix.exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("a 5xx from the default registry fails the audit", async () => {
    await using server = startRegistry({}, { bulkStatus: 500 });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });

    const { stdout, stderr, exitCode } = await audit(dir);
    expect(normalizeBunSnapshot(stderr)).toBe(
      `error: POST ${registryHref(server)}/-/npm/v1/security/advisories/bulk - 500`,
    );
    expect(normalizeBunSnapshot(stdout)).toBe("bun audit <version> (<revision>)");
    expect(exitCode).toBe(1);
  });

  test.concurrent("a default registry that refuses the connection fails both commands", async () => {
    await using server = startRegistry({});
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });
    const lockBefore = await lock(dir);
    const dead = await deadRegistryHref();
    await writeBunfig(dir, dead);
    // The failure is named after the system error, which differs between platforms.
    const refused = new RegExp(
      `^error: POST ${RegExp.escape(dead.slice(0, -1))}/-/npm/v1/security/advisories/bulk - \\w+$`,
    );

    const report = await audit(dir);
    expect(normalizeBunSnapshot(report.stderr)).toMatch(refused);
    expect(normalizeBunSnapshot(report.stdout)).toBe("bun audit <version> (<revision>)");
    expect(report.exitCode).toBe(1);

    const fix = await auditFix(dir);
    expect(normalizeBunSnapshot(fix.stderr)).toMatch(refused);
    expect(normalizeBunSnapshot(fix.stdout)).toBe("bun audit fix <version> (<revision>)");
    expect(fix.exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("a scoped registry that refuses the connection is skipped", async () => {
    await using scoped = startRegistry({});
    await using server = startRegistry({});
    using dir = await setup(
      server,
      { name: "foo", dependencies: { "@types/is-number": "1.0.0" } },
      {},
      { types: scoped.url.href },
    );
    const dead = await deadRegistryHref();
    await writeBunfig(dir, server, { types: dead });
    const skipped = new RegExp(
      `^warn: ${RegExp.escape(dead.slice(0, -1))} did not answer the audit request \\(\\w+\\); skipped @types/is-number$`,
    );

    const report = await audit(dir);
    expect(normalizeBunSnapshot(report.stdout)).toBe(AUDIT_HEADER + noVulnerabilities(0, "1 skipped"));
    expect(normalizeBunSnapshot(report.stderr)).toMatch(skipped);
    expect(report.exitCode).toBe(0);

    const fix = await auditFix(dir, "--json");
    expect(normalizeBunSnapshot(fix.stderr)).toMatch(skipped);
    expect(JSON.parse(fix.stdout)).toStrictEqual({
      dryRun: false,
      fixed: 0,
      remaining: 0,
      fixes: [],
      blocked: [],
      unfixable: [],
      manifestUnavailable: [],
      unmatched: [],
      unaudited: [{ registry: dead.slice(0, -1), packages: ["@types/is-number"], reason: expect.any(String) }],
      vulnerableAfterInstall: [],
    });
    expect(fix.exitCode).toBe(0);
  });

  test.concurrent("a scoped registry that answers 200 with a non-JSON body is skipped", async () => {
    await using scoped = startRegistry({}, { bulkBody: "<html><body>sign in</body></html>" });
    await using server = startRegistry({});
    using dir = await setup(
      server,
      { name: "foo", dependencies: { "@types/is-number": "1.0.0" } },
      {},
      { types: scoped.url.href },
    );

    const report = await audit(dir);
    expect(normalizeBunSnapshot(report.stdout)).toBe(AUDIT_HEADER + noVulnerabilities(0, "1 skipped"));
    expect(normalizeBunSnapshot(report.stderr)).toBe(
      skippedWarning(registryHref(scoped), "non-JSON response", "@types/is-number"),
    );
    expect(report.exitCode).toBe(0);

    const fixText = await auditFix(dir);
    expect(normalizeBunSnapshot(fixText.stdout)).toBe(FIX_HEADER + noVulnerabilities(0, "1 skipped"));
    expect(normalizeBunSnapshot(fixText.stderr)).toBe(
      skippedWarning(registryHref(scoped), "non-JSON response", "@types/is-number"),
    );
    expect(fixText.exitCode).toBe(0);

    const fix = await auditFix(dir, "--json");
    expect(JSON.parse(fix.stdout)).toStrictEqual({
      dryRun: false,
      fixed: 0,
      remaining: 0,
      fixes: [],
      blocked: [],
      unfixable: [],
      manifestUnavailable: [],
      unmatched: [],
      unaudited: [{ registry: registryHref(scoped), packages: ["@types/is-number"], reason: "non-JSON response" }],
      vulnerableAfterInstall: [],
    });
    expect(normalizeBunSnapshot(fix.stderr)).toBe(
      skippedWarning(registryHref(scoped), "non-JSON response", "@types/is-number"),
    );
    expect(fix.exitCode).toBe(0);
  });
});

describe("`bun audit fix`", () => {
  test.concurrent("fixes a direct dependency to the lowest safe version, not the newest", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const pkgJsonBefore = await file(join(dir, "package.json")).text();

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_FIXED);
    expect(stdout).toMatch(DURATION);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain('"a-dep@1.0.2"');
    expect(lockfile).not.toContain('"a-dep@1.0.10"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
    expect(await file(join(dir, "package.json")).text()).toBe(pkgJsonBefore);

    const recheck = await audit(dir);
    expectClean(recheck, 1);

    await expectFrozenInstall(dir);
  });

  test.concurrent("fixes a transitive dependency and leaves its dependent alone", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-range-dep": "1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.1.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      Fixed 1 vulnerability in 1 package (checked 2)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"one-range-dep@1.0.0"');
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");

    await expectFrozenInstall(dir);
  });

  test.concurrent("reports a fix that would violate a dependent's range and changes nothing", async () => {
    const bulkHits = { count: 0 };
    await using server = startRegistry({ "no-deps": [adv("<1.1.0")] }, { bulkHits });
    using dir = await setup(server, { name: "foo", dependencies: { "one-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.1"');
    const rootBefore = await pkgJsonText(dir);
    const dependentBefore = await pkgJsonText(dir, "node_modules", "one-dep");

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ no-deps 1.0.1 -> 1.1.0
          one-dep@1.0.0 depends on no-deps@1.0.1

      Fixed 0 of 1 vulnerability (checked 2)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(bulkHits.count).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await pkgJsonText(dir)).toBe(rootBefore);
    expect(await pkgJsonText(dir, "node_modules", "one-dep")).toBe(dependentBefore);
  });

  test.concurrent("a safe older release outside the dependent's range is not a downgrade candidate", async () => {
    await using server = startRegistry({ "no-deps": [adv(">=1.0.1 <2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.1"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ no-deps 1.0.1 -> 2.0.0
          one-dep@1.0.0 depends on no-deps@1.0.1

      Fixed 0 of 1 vulnerability (checked 2)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--dry-run prints the plan and writes nothing", async () => {
    const bulkHits = { count: 0 };
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { bulkHits });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--dry-run");
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_PLAN);
    expect(stdout).toMatch(DURATION);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(bulkHits.count).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.2");
  });

  test.concurrent(
    "the configured security scanner is sent every package, with the fix at its new version",
    async () => {
      await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
      using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2", "no-deps": "1.0.0" } });
      await reinstall(dir, { name: "foo", dependencies: { "a-dep": "^1.0.2", "no-deps": "1.0.0" } });
      expect(await lock(dir)).toContain('"a-dep@1.0.2"');
      await configureScanner(dir, server);

      const { stdout, stderr, exitCode } = await auditFix(dir);
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
        "bun audit fix <version> (<revision>)

        fixing:
          ^ a-dep 1.0.2 -> 1.0.4

        Fixed 1 vulnerability in 1 package (checked 2)"
      `);
      expect(scannerLog(stderr)).toBe("SCANNER_RAN\nSaved lockfile\n");
      expect(exitCode).toBe(0);
      expect(await scanned(dir)).toStrictEqual(["a-dep@1.0.4", "no-deps@1.0.0"]);
      expect(await lock(dir)).toContain('"a-dep@1.0.4"');
      expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
    },
  );

  test.concurrent(
    "a fatal advisory from the security scanner for the fixed version aborts before anything is written",
    async () => {
      await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
      using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });
      const pkgJsonBefore = await pkgJsonText(dir);
      const lockBefore = await lock(dir);
      expect(lockBefore).toContain('"a-dep@1.0.2"');
      await configureScanner(dir, server, ["a-dep@1.0.4"]);

      const { stdout, stderr, exitCode } = await auditFix(dir);
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
        "bun audit fix <version> (<revision>)

        fixing:
          ^ a-dep 1.0.2 -> 1.0.4
            package.json: 1.0.2 -> 1.0.4


          FATAL: a-dep
            via foo › a-dep
            blocked a-dep@1.0.4
            https://example.invalid/scanner/a-dep@1.0.4

        1 advisory (1 fatal)
        Installation aborted due to fatal security advisories"
      `);
      expect(scannerLog(stderr)).toBe("SCANNER_RAN\n");
      expect(exitCode).toBe(1);
      expect(await scanned(dir)).toStrictEqual(["a-dep@1.0.4"]);
      expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
      expect(await lock(dir)).toBe(lockBefore);
      expect(await installedVersion(dir, "a-dep")).toBe("1.0.2");
    },
  );

  test.concurrent("--dry-run does not run the security scanner", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);
    await configureScanner(dir, server, ["a-dep@1.0.4"]);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--dry-run");
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_PLAN);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await exists(join(dir, "scanned.json"))).toBe(false);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.2");
  });

  test.concurrent("--json stays a single document when the security scanner runs clean", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    await configureScanner(dir, server);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json");
    expect(scannerLog(stderr)).toBe("SCANNER_RAN\nSaved lockfile\n");
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(stdout)).toStrictEqual({
      dryRun: false,
      fixed: 1,
      remaining: 0,
      fixes: [
        {
          name: "a-dep",
          from: "1.0.2",
          to: "1.0.4",
          downgrade: false,
          newerThanMinimumReleaseAge: false,
          packageJson: [],
        },
      ],
      blocked: [],
      unfixable: [],
      manifestUnavailable: [],
      unmatched: [],
      unaudited: [],
      vulnerableAfterInstall: [],
    });
    expect(exitCode).toBe(0);
    expect(await scanned(dir)).toStrictEqual(["a-dep@1.0.4"]);
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
  });

  test.concurrent("a range that rejects every safe release is blocked on the highest safe downgrade", async () => {
    await using server = startRegistry({ "no-deps": [adv(">=2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "^2.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@2.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        v no-deps 2.0.0 -> 1.1.0 (downgrade)
          package.json depends on no-deps@^2.0.0
          bun audit fix --latest

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("no vulnerabilities", async () => {
    await using server = startRegistry({});
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(FIX_HEADER + noVulnerabilities(1));
    expect(stdout).toMatch(DURATION);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);

    expectClean(await audit(dir), 1);
  });

  test.concurrent("the hint sits under the blocked entry --latest can fix, not the last one", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")], "no-deps": [adv("<1.1.0", 2)] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "<1.0.4", "one-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.3"');
    expect(lockBefore).toContain('"no-deps@1.0.1"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ a-dep 1.0.3 -> 1.0.4
          package.json depends on a-dep@<1.0.4
          bun audit fix --latest
        ^ no-deps 1.0.1 -> 1.1.0
          one-dep@1.0.0 depends on no-deps@1.0.1

      Fixed 0 of 2 vulnerabilities (checked 3)
      2 vulnerabilities remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);

    const json = await auditFix(dir, "--json");
    expect(json.stderr).toBe("");
    expect(JSON.parse(json.stdout).blocked).toStrictEqual([
      {
        name: "a-dep",
        from: "1.0.3",
        to: "1.0.4",
        downgrade: false,
        latestFixes: true,
        blockers: [{ dependent: "package.json", range: "<1.0.4", bundled: false }],
      },
      {
        name: "no-deps",
        from: "1.0.1",
        to: "1.1.0",
        downgrade: false,
        latestFixes: false,
        blockers: [{ dependent: "one-dep@1.0.0", range: "1.0.1", bundled: false }],
      },
    ]);
    expect(json.exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("a workspace dependent is named by its package.json path", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(
      server,
      { name: "root", workspaces: ["packages/*"] },
      { "packages/pkg-a/package.json": JSON.stringify({ name: "pkg-a", dependencies: { "a-dep": "<1.0.4" } }) },
    );
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.3"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ a-dep 1.0.3 -> 1.0.4
          packages/pkg-a/package.json depends on a-dep@<1.0.4
          bun audit fix --latest

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);

    const json = await auditFix(dir, "--json");
    expect(JSON.parse(json.stdout).blocked[0].blockers).toStrictEqual([
      { dependent: "packages/pkg-a/package.json", range: "<1.0.4", bundled: false },
    ]);
    expect(json.stderr).toBe("");
    expect(json.exitCode).toBe(1);
  });

  test.concurrent("--silent prints nothing and the exit code carries the result", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")], "no-deps": [adv("<1.1.0", 2)] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2", "one-dep": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "a-dep": "^1.0.2", "one-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.2"');

    const dryRun = await auditFix(dir, "--dry-run", "--silent");
    expect(dryRun.stdout).toBe("");
    expect(dryRun.stderr).toBe("");
    expect(dryRun.exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--silent");
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");

    const json = await auditFix(dir, "--json", "--silent");
    expect(JSON.parse(json.stdout)).toMatchObject({ fixed: 0, remaining: 1, fixes: [] });
    expect(json.stderr).toBe("");
    expect(json.exitCode).toBe(1);
  });

  test.concurrent("--silent with a fix that clears everything exits 0 without printing", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--silent");
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
  });

  test.concurrent("refuses when package.json has changed since bun.lock was written", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);
    const stale = JSON.stringify({ name: "foo", dependencies: { "a-dep": "^1.0.2", "no-deps": "1.0.0" } });
    await write(join(dir, "package.json"), stale);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "error: bun.lock does not match package.json, nothing to fix
      note: run 'bun install' first"
    `);
    expect(normalizeBunSnapshot(stdout)).toBe("bun audit fix <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await pkgJsonText(dir)).toBe(stale);
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.2");
    expect(await exists(join(dir, "node_modules", "no-deps"))).toBe(false);

    const dryRun = await auditFix(dir, "--dry-run");
    expect(dryRun.stderr).toBe(stderr);
    expect(dryRun.stdout).toBe(stdout);
    expect(dryRun.exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("peer dependency edges constrain the fix and are re-pointed", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": "^1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).toContain('"peer-deps-fixed@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      Fixed 1 vulnerability in 1 package (checked 2)"
    `);
    // In particular, no "incorrect peer dependency" warning: the peer edge now points at the fix.
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");

    await expectFrozenInstall(dir);
  });

  test.concurrent("instances of the same package are planned independently", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.1.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-dep": "1.0.0", "no-deps": "^1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).toContain('"no-deps@1.0.1"');

    // pnpm#10646: the advisory still applies to no-deps@1.0.1, so it is remaining, not fixed, and `bun audit` agrees.
    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.1.0

      blocked by a dependent's range:
        ^ no-deps 1.0.1 -> 1.1.0
          one-dep@1.0.0 depends on no-deps@1.0.1

      Fixed 0 vulnerabilities in 1 package (checked 2)
      1 vulnerability remaining"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(1);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.1.0"');
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(await installedVersions(dir, "no-deps", "one-dep/node_modules/no-deps")).toEqual({
      "no-deps": "1.1.0",
      "one-dep/node_modules/no-deps": "1.0.1",
    });

    const recheck = await audit(dir);
    expect(normalizeBunSnapshot(recheck.stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      no-deps@1.1.0, 1.0.1
        (direct dependency)
        one-dep > no-deps
        high: test advisory (<1.1.0) - https://example.invalid/advisory/1

      1 vulnerability (1 high)

        bun audit fix           upgrade the vulnerable packages within their ranges
        bun audit fix --latest  also cross major versions"
    `);
    expect(recheck.stderr).toBe("");
    expect(recheck.exitCode).toBe(1);

    await expectFrozenInstall(dir);
  });

  // pnpm#10646: one advisory hitting two installed versions is one vulnerability, as `bun audit` counts it.
  test.concurrent("one advisory across two fixable versions counts once", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.1.0")] });
    const workspace = (name: string, range: string) => JSON.stringify({ name, dependencies: { "no-deps": range } });
    const root = { name: "root", workspaces: ["packages/*"] };
    using dir = await setup(server, root, {
      "packages/a/package.json": workspace("a", "1.0.0"),
      "packages/b/package.json": workspace("b", "1.0.1"),
    });
    await write(join(dir, "packages", "a", "package.json"), workspace("a", "1.0.0 || >=1.1.0"));
    await write(join(dir, "packages", "b", "package.json"), workspace("b", "^1.0.1"));
    await runBunInstall(installEnv(dir), dir);
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).toContain('"no-deps@1.0.1"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.1.0
        ^ no-deps 1.0.1 -> 1.1.0

      Fixed 1 vulnerability in 1 package (checked 1)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.1.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.1"');

    expectClean(await audit(dir), 1);
  });

  // pnpm#8943: a patch release on the current line wins over the next major that the range would also allow.
  test.concurrent("prefers an in-line patch over a major that the range also allows", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "no-deps": ">=1.0.0" } });
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      Fixed 1 vulnerability in 1 package (checked 1)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@2.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");
  });

  // pnpm#12651 / #13824: an advisory with no released fix must not invent a version or leave bun.lock unusable.
  test.concurrent("an advisory covering the newest release leaves a lockfile that still installs frozen", async () => {
    await using server = startRegistry({ "a-dep": [adv("<=1.0.10")] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "^1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.10"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      no published version fixes:
        a-dep@1.0.10  1
          bun audit fix --ignore 1

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);

    await expectFrozenInstall(dir);
  });

  // pnpm#11101: a workspace package sharing a name with an advised npm package is not audited.
  test.concurrent("a workspace package is never matched against an advisory for its name", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(
      server,
      { name: "root", workspaces: ["packages/*"] },
      { "packages/no-deps/package.json": JSON.stringify({ name: "no-deps", version: "1.0.0" }) },
    );
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@workspace:packages/no-deps"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(FIX_HEADER + noVulnerabilities(0));
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);
  });

  // pnpm#10486 / #12487: a package kept alive only by a peer edge is still upgraded.
  test.concurrent("fixes a package reachable only through a peer dependency edge", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "peer-deps-fixed": "1.0.0", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "peer-deps-fixed": "1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.1.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      Fixed 1 vulnerability in 1 package (checked 2)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");

    await expectFrozenInstall(dir);
  });

  test.concurrent("honours catalog ranges", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(
      server,
      { name: "root", workspaces: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
      { "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { "no-deps": "catalog:" } }) },
    );
    await reinstall(dir, { name: "root", workspaces: ["packages/*"], catalog: { "no-deps": "^1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.1"');
    const rootBefore = await pkgJsonText(dir);
    const memberBefore = await pkgJsonText(dir, "packages", "a");

    // No package.json edit: the catalog range already admits the fix.
    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      Fixed 1 vulnerability in 1 package (checked 1)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(await pkgJsonText(dir)).toBe(rootBefore);
    expect(await pkgJsonText(dir, "packages", "a")).toBe(memberBefore);
  });

  test.concurrent("--ignore and --audit-level filter what gets fixed", async () => {
    await using server = startRegistry({ "a-dep": [{ ...adv("<1.0.4", 7), severity: "low" }] });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const ignored = await auditFix(dir, "--ignore", "7");
    expect(normalizeBunSnapshot(ignored.stdout)).toBe(FIX_HEADER + noVulnerabilities(1, "1 ignored"));
    expect(ignored.stderr).toBe("");
    expect(ignored.exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);

    const belowLevel = await auditFix(dir, "--audit-level", "high");
    expect(normalizeBunSnapshot(belowLevel.stdout)).toBe(
      FIX_HEADER + noVulnerabilities(1, "1 below --audit-level=high"),
    );
    expect(belowLevel.stderr).toBe("");
    expect(belowLevel.exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);

    const fixed = await auditFix(dir);
    expect(normalizeBunSnapshot(fixed.stdout)).toBe(A_DEP_FIXED);
    expectSaved(fixed.stderr);
    expect(fixed.exitCode).toBe(0);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
  });

  test.concurrent("rejects extra arguments", async () => {
    await using server = startRegistry({});
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const lockBefore = await lock(dir);

    const extra = await auditFix(dir, "extra");
    expect(normalizeBunSnapshot(extra.stderr)).toMatchInlineSnapshot(`
      "error: bun audit fix does not take arguments, it always fixes the whole lockfile
      note: run 'bun audit --help' for more information"
    `);
    expect(extra.stdout).toBe("");
    expect(extra.exitCode).toBe(1);

    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("an unknown subcommand is rejected before the registry is contacted", async () => {
    const bulkHits = { count: 0 };
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { bulkHits });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await audit(dir, "fixx");
    expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
      "error: unknown subcommand "fixx" for bun audit
      note: did you mean 'bun audit fix'?"
    `);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
    expect(bulkHits.count).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("refuses to run against a frozen lockfile", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    for (const flag of ["--frozen-lockfile", "--production"]) {
      const { stdout, stderr, exitCode } = await auditFix(dir, flag);
      expect(stderr).toBe(FROZEN_ERROR);
      expect(normalizeBunSnapshot(stdout)).toBe("bun audit fix <version> (<revision>)");
      expect(exitCode).toBe(1);
      expect(await lock(dir)).toBe(lockBefore);
    }

    const dryRun = await auditFix(dir, "--frozen-lockfile", "--dry-run");
    expect(normalizeBunSnapshot(dryRun.stdout)).toBe(A_DEP_PLAN);
    expect(dryRun.stderr).toBe("");
    expect(dryRun.exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("an optional peer edge does not keep the vulnerable version alive", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "optional-peer-deps": "1.0.0", "no-deps": "1.0.0" },
    });
    await reinstall(dir, { name: "foo", dependencies: { "optional-peer-deps": "1.0.0", "no-deps": "^1.0.0" } });
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      Fixed 1 vulnerability in 1 package (checked 2)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");

    expectClean(await audit(dir), 2);
    await expectFrozenInstall(dir);
  });

  // The peer holder hoists before the dependent, so a slot still bound to the old version takes the root folder.
  test.concurrent(
    "an optional peer edge hoisted before the dependent does not keep the vulnerable version",
    async () => {
      await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
      using dir = await setup(server, {
        name: "foo",
        dependencies: { "one-optional-peer-dep": "1.0.2", "one-range-dep": "1.0.0", "no-deps": "1.0.0" },
      });
      await reinstall(dir, {
        name: "foo",
        dependencies: { "one-optional-peer-dep": "1.0.2", "one-range-dep": "1.0.0" },
      });
      expect(await lock(dir)).toContain('"no-deps@1.0.0"');

      const { stdout, stderr, exitCode } = await auditFix(dir);
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
        "bun audit fix <version> (<revision>)

        fixing:
          ^ no-deps 1.0.0 -> 1.0.1

        Fixed 1 vulnerability in 1 package (checked 3)"
      `);
      expectSaved(stderr);
      expect(exitCode).toBe(0);

      const lockfile = await lock(dir);
      expect(lockfile).toContain('"no-deps": ["no-deps@1.0.1"');
      expect(lockfile).not.toContain('"no-deps@1.0.0"');
      expect(lockfile).not.toContain('"one-range-dep/no-deps"');
      expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");
      expect(await exists(join(dir, "node_modules", "one-range-dep", "node_modules"))).toBe(false);

      expectClean(await audit(dir), 3);
      await expectFrozenInstall(dir);
    },
  );

  test.concurrent("an advisory for an installed prerelease is matched and the pin is rewritten", async () => {
    const bulkHits = { count: 0 };
    await using server = startRegistry(
      {},
      { bulkResponses: [{ "no-deps-backward-tags": [adv("<1.1.0")] }, {}], bulkHits },
    );
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps-backward-tags": "1.0.0-rc.1" } });
    expect(await lock(dir)).toContain('"no-deps-backward-tags@1.0.0-rc.1"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps-backward-tags 1.0.0-rc.1 -> 1.1.0
          package.json: 1.0.0-rc.1 -> 1.1.0

      Fixed 1 vulnerability in 1 package (checked 1)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);
    expect(bulkHits.count).toBe(2);

    expect((await pkgJson(dir)).dependencies).toStrictEqual({ "no-deps-backward-tags": "1.1.0" });
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps-backward-tags@1.1.0"');
    expect(lockfile).not.toContain("1.0.0-rc.1");
    expect(await installedVersion(dir, "no-deps-backward-tags")).toBe("1.1.0");

    await expectFrozenInstall(dir);
  });

  test.concurrent("advisories that match no installed version are listed, not just counted", async () => {
    await using server = startRegistry(
      {},
      { bulkResponse: { "no-deps": [adv(">=5.0.0"), adv(">=5.0.0", 2), adv("not a range", 3)] } },
    );
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      not matched to an installed version:
        no-deps@>=5.0.0
        no-deps@not a range

      Fixed 0 of 3 vulnerabilities (checked 1)
      3 vulnerabilities remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("an unparsable advisory does not hide a real fix for the same package", async () => {
    const bulkHits = { count: 0 };
    await using server = startRegistry(
      {},
      {
        bulkResponses: [{ "a-dep": [adv("<1.0.4"), adv("not a range", 2)] }, { "a-dep": [adv("not a range", 2)] }],
        bulkHits,
      },
    );
    using dir = await setupVulnerableADep(server);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ a-dep 1.0.2 -> 1.0.4

      not matched to an installed version:
        a-dep@not a range

      Fixed 1 vulnerability in 1 package (checked 1)
      1 vulnerability remaining"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(1);
    expect(bulkHits.count).toBe(2);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
  });

  test.concurrent("a bundled dependency is never claimed as fixed", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "bundled-1": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ no-deps 1.0.0 -> 1.0.1
          bundled-1@1.0.0 bundles no-deps@1.0.0

      Fixed 0 of 1 vulnerability (checked 2)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await installedVersion(dir, "bundled-1", "node_modules", "no-deps")).toBe("1.0.0");
  });

  test.concurrent("multiple advisories on one instance are cleared together", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4", 1), adv("<1.0.6", 2)] });
    using dir = await setupVulnerableADep(server);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ a-dep 1.0.2 -> 1.0.6

      Fixed 2 vulnerabilities in 1 package (checked 1)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.6"');
    expect(lockfile).not.toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.6");

    expectClean(await audit(dir), 1);
  });

  // pnpm fixtures/update-multiple: two advisories for one name with disjoint ranges.
  test.concurrent("disjoint advisory ranges for one package are all avoided", async () => {
    const bulkBodies: Record<string, string[]>[] = [];
    await using server = startRegistry(
      { "no-deps": [adv(">=1.0.0 <1.0.1", 1), adv(">=1.1.0 <2.0.0", 2)] },
      { bulkBodies },
    );
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "no-deps": ">=1.0.0" } });
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      Fixed 1 vulnerability in 1 package (checked 1)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);
    expect(bulkBodies).toStrictEqual([{ "no-deps": ["1.0.0"] }, { "no-deps": ["1.0.1"] }]);
    expect(await lock(dir)).toContain('"no-deps@1.0.1"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");

    expectClean(await audit(dir), 1);
  });

  test.concurrent("an advisory that only covers the version the fix moves to is reported by the re-audit", async () => {
    const bulkBodies: Record<string, string[]>[] = [];
    await using server = startRegistry(
      { "no-deps": [adv(">=1.0.0 <1.0.1", 1), adv(">=1.0.1 <2.0.0", 2)] },
      { bulkBodies },
    );
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "no-deps": ">=1.0.0" } });
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      vulnerable after install:
        no-deps@1.0.1  2

      Fixed 1 vulnerability in 1 package (checked 1)
      1 vulnerability remaining"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(1);
    expect(bulkBodies).toStrictEqual([{ "no-deps": ["1.0.0"] }, { "no-deps": ["1.0.1"] }]);
    expect(await lock(dir)).toContain('"no-deps@1.0.1"');

    const recheck = await audit(dir);
    expect(normalizeBunSnapshot(recheck.stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      no-deps@1.0.1
        (direct dependency)
        high: test advisory (>=1.0.1 <2.0.0) - https://example.invalid/advisory/2

      1 vulnerability (1 high)

        bun audit fix           upgrade the vulnerable packages within their ranges
        bun audit fix --latest  also cross major versions"
    `);
    expect(recheck.stderr).toBe("");
    expect(recheck.exitCode).toBe(1);
  });

  test.concurrent("a registry failure on the re-audit fails the run after the fix was installed", async () => {
    const bulkHits = { count: 0 };
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { bulkFailAfter: 1, bulkHits });
    using dir = await setupVulnerableADep(server);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ a-dep 1.0.2 -> 1.0.4"
    `);
    expect(installLog(stderr)).toBe(
      INSTALLED_AND_SAVED + `error: POST ${registryHref(server)}/-/npm/v1/security/advisories/bulk - 503\n`,
    );
    expect(exitCode).toBe(1);
    expect(bulkHits.count).toBe(2);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
  });

  // npm-style advisory objects carry extra fields (findings, patched_versions, ...) that must be ignored.
  test.concurrent("ignores unknown advisory fields and treats >=0.0.0 as unfixable", async () => {
    await using server = startRegistry(
      {},
      {
        bulkResponse: {
          "no-deps": [
            {
              ...adv(">=0.0.0", 1234),
              findings: [{ version: "1.0.0", paths: ["no-deps"] }],
              patched_versions: "<0.0.0",
              recommendation: "None",
              cwe: ["CWE-1"],
              cvss: { score: 0, vectorString: null },
            },
          ],
        },
      },
    );
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "^1.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      no published version fixes:
        no-deps@1.1.0  1234
          bun audit fix --ignore 1234

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("parses a large bulk response and only plans installed packages", async () => {
    const bulkResponse = await file(
      join(import.meta.dirname, "registry", "fixtures", "audit", "pnpm-all-vulnerabilities-response.json"),
    ).json();
    await using server = startRegistry({}, { bulkResponse });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    const out = normalizeBunSnapshot(stdout);
    expect(out).toStartWith(FIX_HEADER + "not matched to an installed version:\n");
    expect(out).toEndWith("\n\nFixed 0 of 111 vulnerabilities (checked 1)\n111 vulnerabilities remaining");
    expect(out).toContain("\n  axios@<0.21.2\n");
    expect(out).toContain("\n  semver@>=2.0.0-alpha <5.7.2\n");
    expect(out).not.toContain("no-deps");
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("fixes two packages in one run and leaves the rest of the lockfile alone", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")], "no-deps": [adv("<1.0.1", 2)] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "a-dep": "1.0.2", "one-range-dep": "1.0.0", "no-deps": "1.0.0", "@types/is-number": "1.0.0" },
    });
    await reinstall(dir, {
      name: "foo",
      dependencies: { "a-dep": "^1.0.2", "one-range-dep": "1.0.0", "@types/is-number": "1.0.0" },
    });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.2"');
    expect(lockBefore).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ a-dep 1.0.2 -> 1.0.4
        ^ no-deps 1.0.0 -> 1.0.1

      Fixed 2 vulnerabilities in 2 packages (checked 4)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);
    expect(await installedVersions(dir, "a-dep", "no-deps")).toEqual({ "a-dep": "1.0.4", "no-deps": "1.0.1" });

    const lockAfter = await lock(dir);
    const packageRows = lockBefore.split("\n").filter(line => /^    "[^"]+": \["/.test(line));
    const untouched = packageRows.filter(line => !line.includes('"a-dep@') && !line.includes('"no-deps@'));
    expect(untouched.map(line => line.split('"')[1]).sort()).toStrictEqual(["@types/is-number", "one-range-dep"]);
    for (const line of untouched) expect(lockAfter).toContain(line);
    expect(lockAfter).toContain('"a-dep@1.0.4"');
    expect(lockAfter).toContain('"no-deps@1.0.1"');
  });

  test.concurrent("fixes a scoped package", async () => {
    await using server = startRegistry({ "@types/is-number": [adv("<2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "@types/is-number": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "@types/is-number": ">=1.0.0" } });
    expect(await lock(dir)).toContain('"@types/is-number@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ @types/is-number 1.0.0 -> 2.0.0

      Fixed 1 vulnerability in 1 package (checked 1)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"@types/is-number@2.0.0"');
    expect(lockfile).not.toContain('"@types/is-number@1.0.0"');
    expect(await installedVersion(dir, "@types", "is-number")).toBe("2.0.0");
  });

  test.concurrent("fixes an npm: alias pointing at a vulnerable package", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, { name: "foo", dependencies: { nd: "npm:a-dep@1.0.2" } });
    await reinstall(dir, { name: "foo", dependencies: { nd: "npm:a-dep@^1.0.2" } });
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_FIXED);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain('"a-dep@1.0.2"');
    expect(await installedVersion(dir, "nd")).toBe("1.0.4");

    await expectFrozenInstall(dir);
  });

  test.concurrent("a version held by an overrides entry is blocked and the override is not rewritten", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "a-dep": "^1.0.2" },
      overrides: { "a-dep": "1.0.2" },
    });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.2"');
    const pkgJsonBefore = await pkgJsonText(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ a-dep 1.0.2 -> 1.0.4
          package.json depends on a-dep@1.0.2

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
  });

  test.concurrent("a pinned catalog entry is rewritten and the member keeps `catalog:`", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    const member = JSON.stringify({ name: "a", dependencies: { "no-deps": "catalog:" } });
    using dir = await setup(
      server,
      { name: "root", workspaces: ["packages/*"], catalog: { "no-deps": "1.0.0" } },
      { "packages/a/package.json": member },
    );
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1
          package.json (catalog): 1.0.0 -> 1.0.1

      Fixed 1 vulnerability in 1 package (checked 1)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).catalog).toStrictEqual({ "no-deps": "1.0.1" });
    expect(await pkgJsonText(dir, "packages", "a")).toBe(member);
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(lockfile).toContain('"no-deps": "1.0.1"');
    expect(lockfile).toContain('"no-deps": "catalog:"');

    await expectFrozenInstall(dir);
  });

  test.concurrent("rewrites a named catalog entry and leaves unused catalogs alone", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    const member = JSON.stringify({ name: "a", dependencies: { "no-deps": "catalog:build" } });
    using dir = await setup(
      server,
      {
        name: "root",
        workspaces: ["packages/*"],
        catalogs: { build: { "no-deps": "1.0.0" }, other: { "no-deps": "1.0.0" } },
      },
      { "packages/a/package.json": member },
    );
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1
          package.json (catalog build): 1.0.0 -> 1.0.1

      Fixed 1 vulnerability in 1 package (checked 1)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).catalogs).toStrictEqual({
      build: { "no-deps": "1.0.1" },
      other: { "no-deps": "1.0.0" },
    });
    expect(await pkgJsonText(dir, "packages", "a")).toBe(member);
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');

    await expectFrozenInstall(dir);
  });

  // mismatched-peer-deps-lvl1's own dependency declares a peer the install warns about, so runBunInstall cannot be used.
  test.concurrent("a peer edge that rejects the fix is split off and labelled with the peer dependent", async () => {
    await using server = startRegistry({ "no-deps": [adv("<=1.0.1")] });
    const rootPkgJson = (noDeps: string) =>
      JSON.stringify({ name: "foo", dependencies: { "mismatched-peer-deps-lvl1": "1.0.0", "no-deps": noDeps } });
    using dir = tempDir("audit-fix-", { "package.json": rootPkgJson("1.0.1") });
    await writeBunfig(dir, server);
    await expectInstall(dir);
    await write(join(dir, "package.json"), rootPkgJson("^1.0.0"));
    await expectInstall(dir);
    expect(await lock(dir)).toContain('"no-deps@1.0.1"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.1 -> 1.1.0

      blocked by a dependent's range:
        ^ no-deps 1.0.1 -> 1.1.0
          mismatched-peer-deps-lvl1@1.0.0 depends on no-deps@<=1.0.1
          mismatched-peer-deps-lvl2@1.0.0 depends on no-deps@1.0.0

      Fixed 0 vulnerabilities in 1 package (checked 3)
      1 vulnerability remaining"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(1);
    // A peer edge holds no copy of its own, so the moved root instance is the only no-deps left.
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.1.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.1"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
  });

  test.concurrent("a depth-3 blocker names the immediate dependent", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.1.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-one-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.1"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ no-deps 1.0.1 -> 1.1.0
          one-dep@1.0.0 depends on no-deps@1.0.1

      Fixed 0 of 1 vulnerability (checked 3)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  // Workspaces default to the isolated linker, so the linker is pinned to keep node_modules paths predictable.
  test.concurrent("fixes a workspace member's dependency when run from the member directory", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    const member = (range: string) => JSON.stringify({ name: "a", dependencies: { "a-dep": range } });
    const rootPkgJson = JSON.stringify({ name: "root", workspaces: ["packages/*"] });
    using dir = tempDir("audit-fix-", { "package.json": rootPkgJson, "packages/a/package.json": member("1.0.2") });
    await writeBunfig(dir, server);
    await expectInstall(dir, "--linker", "hoisted");
    await write(join(dir, "packages", "a", "package.json"), member("^1.0.2"));
    await expectInstall(dir, "--linker", "hoisted");
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const fix = await run(join(dir, "packages", "a"), ["audit", "fix", "--linker", "hoisted"], dir);
    expect(normalizeBunSnapshot(fix.stdout)).toBe(A_DEP_FIXED);
    expectSaved(fix.stderr);
    expect(fix.exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain('"a-dep@1.0.2"');
    expect(await exists(join(dir, "packages", "a", "bun.lock"))).toBeFalse();
    expect(await pkgJsonText(dir)).toBe(rootPkgJson);
    expect(await pkgJsonText(dir, "packages", "a")).toBe(member("^1.0.2"));
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");

    await expectFrozenInstall(dir, "--linker", "hoisted");
  });

  test.concurrent("isolated linker layout", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = tempDir("audit-fix-", {
      "package.json": JSON.stringify({ name: "foo", dependencies: { "a-dep": "1.0.2" } }),
    });
    await writeBunfig(dir, server);
    await expectInstall(dir, "--linker", "isolated");
    await write(join(dir, "package.json"), JSON.stringify({ name: "foo", dependencies: { "a-dep": "^1.0.2" } }));
    await expectInstall(dir, "--linker", "isolated");
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');
    expect(await readlink(join(dir, "node_modules", "a-dep"))).toContain("a-dep@1.0.2");

    const { stdout, stderr, exitCode } = await auditFix(dir, "--linker", "isolated");
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_FIXED);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await readlink(join(dir, "node_modules", "a-dep"))).toContain("a-dep@1.0.4");
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");

    await expectFrozenInstall(dir, "--linker", "isolated");
  });

  // Every a-dep release was published in 2023, so a 100-year minimum age gates all of them.
  test.concurrent("a fix newer than --minimum-release-age is installed anyway", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const dryRun = await auditFix(dir, "--dry-run", "--minimum-release-age", "3153600000");
    expect(normalizeBunSnapshot(dryRun.stdout)).toBe(A_DEP_PLAN.replace("1.0.4", `1.0.4 ${TOO_NEW}`));
    expect(dryRun.stderr).toBe("");
    expect(dryRun.exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--minimum-release-age", "3153600000");
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_FIXED.replace("1.0.4", `1.0.4 ${TOO_NEW}`));
    expectSaved(stderr);
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");

    await expectFrozenInstall(dir, "--minimum-release-age", "3153600000");
  });

  test.concurrent(
    "the lowest safe release is taken even when only it is newer than --minimum-release-age",
    async () => {
      await using server = startRegistry(
        { "a-dep": [adv("<1.0.4")] },
        { rewriteTime: { "a-dep": { "1.0.4": new Date().toISOString() } } },
      );
      using dir = await setupVulnerableADep(server);

      const { stdout, stderr, exitCode } = await auditFix(dir, "--minimum-release-age", "86400");
      expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_FIXED.replace("1.0.4", `1.0.4 ${TOO_NEW}`));
      expectSaved(stderr);
      expect(exitCode).toBe(0);
      const lockfile = await lock(dir);
      expect(lockfile).toContain('"a-dep@1.0.4"');
      expect(lockfile).not.toContain('"a-dep@1.0.5"');
      expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
    },
  );

  test.concurrent("a failing bulk endpoint changes nothing", async () => {
    await using server = startRegistry({}, { bulkStatus: 500 });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe("bun audit fix <version> (<revision>)");
    expect(normalizeBunSnapshot(stderr)).toBe(
      `error: POST ${registryHref(server)}/-/npm/v1/security/advisories/bulk - 500`,
    );
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("a bulk response that is not JSON is reported on stderr and changes nothing", async () => {
    await using server = startRegistry({}, { bulkBody: "<html><body>registry is down</body></html>" });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stderr)).toBe(`error: ${registryHref(server)} returned a non-JSON audit response`);
    expect(normalizeBunSnapshot(stdout)).toBe("bun audit fix <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("a manifest that fails to download is reported, not fixed", async () => {
    const denyManifests = new Set<string>();
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { denyManifests });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);
    denyManifests.add("a-dep");

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(normalizeBunSnapshot(stderr)).toBe(
      `warn: a-dep@1.0.2 was not checked for updates: GET ${registryHref(server)}/a-dep - 404`,
    );
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("a manifest that fails to download does not stop the other fixes", async () => {
    const denyManifests = new Set<string>();
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")], "no-deps": [adv("<1.0.1", 2)] }, { denyManifests });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "a-dep": "^1.0.2", "no-deps": "^1.0.0" } });
    denyManifests.add("a-dep");

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      Fixed 1 vulnerability in 1 package (checked 2)
      1 vulnerability remaining"
    `);
    expectSaved(stderr, `warn: a-dep@1.0.2 was not checked for updates: GET ${registryHref(server)}/a-dep - 404`);
    expect(exitCode).toBe(1);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).toContain('"a-dep@1.0.2"');
    expect(await installedVersions(dir, "a-dep", "no-deps")).toEqual({ "a-dep": "1.0.2", "no-deps": "1.0.1" });
  });

  test.concurrent("a fix whose tarball fails to download is not reported as fixed", async () => {
    const denyTarballs = new Set<string>();
    const bulkHits = { count: 0 };
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { denyTarballs, bulkHits });
    using dir = await setupVulnerableADep(server);
    denyTarballs.add("a-dep-1.0.4.tgz");

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ a-dep 1.0.2 -> 1.0.4"
    `);
    expect(installLog(stderr)).toBe(
      "Resolving dependencies\nResolved, downloaded and extracted [<n>]\n" +
        `error: GET ${registryHref(server)}/a-dep/-/a-dep-1.0.4.tgz - 404\n`,
    );
    expect(exitCode).toBe(1);
    expect(bulkHits.count).toBe(1);
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.2");
  });

  test.concurrent("refuses to run without a lockfile", async () => {
    await using server = startRegistry({});
    using dir = tempDir("audit-fix-", {
      "package.json": JSON.stringify({ name: "foo" }),
      "bunfig.toml": Bun.TOML.stringify({ install: { registry: server.url.href } }),
    });

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stderr)).toBe(MISSING_LOCKFILE);
    expect(normalizeBunSnapshot(stdout)).toBe("bun audit fix <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(await exists(join(dir, "bun.lock"))).toBeFalse();
  });

  test.concurrent("refuses --no-save before contacting the registry", async () => {
    await using server = startRegistry({}, { bulkStatus: 500 });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--no-save");
    expect(stderr).toBe(NO_SAVE_ERROR);
    expect(normalizeBunSnapshot(stdout)).toBe("bun audit fix <version> (<revision>)");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("rewrites an exact direct pin", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    const before = [
      "{",
      '    "name": "foo",',
      '    "scripts": {',
      '        "check": "true"',
      "    },",
      '    "dependencies": {',
      '        "a-dep": "1.0.2"',
      "    }",
      "}",
      "",
    ].join("\n");
    using dir = await setup(server, before);
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_PIN_FIXED);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect(await pkgJsonText(dir)).toBe(before.replace('"a-dep": "1.0.2"', '"a-dep": "1.0.4"'));
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep": "1.0.4"');
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain("a-dep@1.0.2");
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");

    const recheck = await audit(dir);
    expectClean(recheck, 1);

    await expectFrozenInstall(dir);
  });

  test.concurrent("--dry-run does not rewrite a pin", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });
    const pkgJsonBefore = await pkgJsonText(dir);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--dry-run");
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_PIN_PLAN);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.2");
  });

  test.concurrent("a pin is only widened within its major", async () => {
    await using server = startRegistry({ "no-deps": [adv("<2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const pkgJsonBefore = await pkgJsonText(dir);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ no-deps 1.0.0 -> 2.0.0
          package.json depends on no-deps@1.0.0
          bun audit fix --latest

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("rewrites an exact npm: alias pin", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, { name: "foo", dependencies: { nd: "npm:a-dep@1.0.2" } });
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ a-dep 1.0.2 -> 1.0.4
          package.json: npm:a-dep@1.0.2 -> npm:a-dep@1.0.4

      Fixed 1 vulnerability in 1 package (checked 1)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).dependencies).toStrictEqual({ nd: "npm:a-dep@1.0.4" });
    expect(await installedVersion(dir, "nd")).toBe("1.0.4");

    await expectFrozenInstall(dir);
  });

  test.concurrent("rewrites a pinned devDependency in its own group only", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")], "no-deps": [adv("<1.0.1", 2)] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "no-deps": "1.0.0" },
      devDependencies: { "a-dep": "1.0.2" },
    });
    await reinstall(dir, { name: "foo", dependencies: { "no-deps": "^1.0.0" }, devDependencies: { "a-dep": "1.0.2" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.2"');
    expect(lockfile).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ a-dep 1.0.2 -> 1.0.4
          package.json: 1.0.2 -> 1.0.4
        ^ no-deps 1.0.0 -> 1.0.1

      Fixed 2 vulnerabilities in 2 packages (checked 2)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect(await pkgJson(dir)).toStrictEqual({
      name: "foo",
      dependencies: { "no-deps": "^1.0.0" },
      devDependencies: { "a-dep": "1.0.4" },
    });
    lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(await installedVersions(dir, "a-dep", "no-deps")).toEqual({ "a-dep": "1.0.4", "no-deps": "1.0.1" });

    await expectFrozenInstall(dir);
  });

  test.concurrent("rewrites a workspace member's pin and leaves the root alone", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    const rootPkgJson = JSON.stringify({ name: "root", workspaces: ["packages/*"] });
    using dir = await setup(server, rootPkgJson, {
      "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { "a-dep": "1.0.2" } }),
    });
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_PIN_FIXED.replace("package.json", "packages/a/package.json"));
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir, "packages", "a")).dependencies).toStrictEqual({ "a-dep": "1.0.4" });
    expect(await pkgJsonText(dir)).toBe(rootPkgJson);
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).toContain('"a-dep": "1.0.4"');
    expect(lockfile).not.toContain("a-dep@1.0.2");
    expect(await exists(join(dir, "packages", "a", "bun.lock"))).toBeFalse();

    await expectFrozenInstall(dir);
  });

  test.concurrent("rewrites a workspace member's pin when run from the member directory", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    const rootPkgJson = JSON.stringify({ name: "root", workspaces: ["packages/*"] });
    using dir = tempDir("audit-fix-", {
      "package.json": rootPkgJson,
      "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { "a-dep": "1.0.2" } }),
    });
    await writeBunfig(dir, server);
    await expectInstall(dir, "--linker", "hoisted");
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const fix = await run(join(dir, "packages", "a"), ["audit", "fix", "--linker", "hoisted"], dir);
    expect(normalizeBunSnapshot(fix.stdout)).toBe(A_DEP_PIN_FIXED.replace("package.json", "packages/a/package.json"));
    expectSaved(fix.stderr);
    expect(fix.exitCode).toBe(0);

    expect((await pkgJson(dir, "packages", "a")).dependencies).toStrictEqual({ "a-dep": "1.0.4" });
    expect(await pkgJsonText(dir)).toBe(rootPkgJson);
    expect(await exists(join(dir, "packages", "a", "bun.lock"))).toBeFalse();
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");

    await expectFrozenInstall(dir, "--linker", "hoisted");
  });

  test.concurrent("splits an instance when only some dependents accept the fix", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-fixed-dep": "1.0.0", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-fixed-dep": "1.0.0", "no-deps": "^1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.1"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      blocked by a dependent's range:
        ^ no-deps 1.0.0 -> 1.0.1
          one-fixed-dep@1.0.0 depends on no-deps@1.0.0

      Fixed 0 vulnerabilities in 1 package (checked 2)
      1 vulnerability remaining"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(1);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(await installedVersions(dir, "no-deps", "one-fixed-dep/node_modules/no-deps")).toEqual({
      "no-deps": "1.0.1",
      "one-fixed-dep/node_modules/no-deps": "1.0.0",
    });

    await expectFrozenInstall(dir);
  });

  test.concurrent("splits an instance shared by two transitive dependents", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "one-range-dep": "1.0.0", "one-fixed-dep": "1.0.0", "no-deps": "1.0.0" },
    });
    await reinstall(dir, { name: "foo", dependencies: { "one-range-dep": "1.0.0", "one-fixed-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.0"');
    expect(lockBefore).not.toContain('"no-deps@1.0.1"');

    const dryRun = await auditFix(dir, "--dry-run");
    expect(normalizeBunSnapshot(dryRun.stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      blocked by a dependent's range:
        ^ no-deps 1.0.0 -> 1.0.1
          one-fixed-dep@1.0.0 depends on no-deps@1.0.0

      Would fix 0 vulnerabilities in 1 package (checked 3)
      1 vulnerability remaining"
    `);
    expect(dryRun.stderr).toBe("");
    expect(dryRun.exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      blocked by a dependent's range:
        ^ no-deps 1.0.0 -> 1.0.1
          one-fixed-dep@1.0.0 depends on no-deps@1.0.0

      Fixed 0 vulnerabilities in 1 package (checked 3)
      1 vulnerability remaining"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(1);
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect({
      "one-range-dep": await resolvedVersion(dir, "one-range-dep", "no-deps"),
      "one-fixed-dep": await resolvedVersion(dir, "one-fixed-dep", "no-deps"),
    }).toEqual({ "one-range-dep": "1.0.1", "one-fixed-dep": "1.0.0" });

    await expectFrozenInstall(dir);
  });

  test.concurrent("hoisted: a vulnerable nested copy collapsed onto the fixed root copy is removed", async () => {
    await using server = startRegistry({ "no-deps": [adv(">=1.1.0 <2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-range-dep": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.1" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.1.0"');
    expect(lockBefore).toContain('"no-deps@1.0.1"');
    expect(await installedVersions(dir, "no-deps", "one-range-dep/node_modules/no-deps")).toEqual({
      "no-deps": "1.0.1",
      "one-range-dep/node_modules/no-deps": "1.1.0",
    });

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        v no-deps 1.1.0 -> 1.0.1 (downgrade)

      Fixed 1 vulnerability in 1 package (checked 2)"
    `);
    // The root already holds 1.0.1, so the install has nothing to resolve or download and only saves.
    expect(stderr).toBe("Saved lockfile\n");
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).not.toContain('"no-deps@1.1.0"');
    expect(lockfile).not.toContain('"one-range-dep/no-deps"');
    expect(await exists(join(dir, "node_modules", "one-range-dep", "node_modules", "no-deps"))).toBe(false);
    expect(await resolvedVersion(dir, "one-range-dep", "no-deps")).toBe("1.0.1");
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.1");

    expectClean(await audit(dir), 2);
    await expectFrozenInstall(dir);
  });

  test.concurrent("a split instance under the isolated linker keeps both versions in the store", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    const rootPkgJson = (deps: Record<string, string>) => JSON.stringify({ name: "foo", dependencies: deps });
    using dir = tempDir("audit-fix-", {
      "package.json": rootPkgJson({ "one-range-dep": "1.0.0", "one-fixed-dep": "1.0.0", "no-deps": "1.0.0" }),
    });
    await writeBunfig(dir, server);
    await expectInstall(dir, "--linker", "isolated");
    await write(join(dir, "package.json"), rootPkgJson({ "one-range-dep": "1.0.0", "one-fixed-dep": "1.0.0" }));
    await expectInstall(dir, "--linker", "isolated");
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.0"');
    expect(lockBefore).not.toContain('"no-deps@1.0.1"');

    const { stdout, stderr, exitCode } = await auditFix(dir, "--linker", "isolated");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.0.1

      blocked by a dependent's range:
        ^ no-deps 1.0.0 -> 1.0.1
          one-fixed-dep@1.0.0 depends on no-deps@1.0.0

      Fixed 0 vulnerabilities in 1 package (checked 3)
      1 vulnerability remaining"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(1);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(
      await installedVersions(
        dir,
        ".bun/one-range-dep@1.0.0/node_modules/no-deps",
        ".bun/one-fixed-dep@1.0.0/node_modules/no-deps",
      ),
    ).toEqual({
      ".bun/one-range-dep@1.0.0/node_modules/no-deps": "1.0.1",
      ".bun/one-fixed-dep@1.0.0/node_modules/no-deps": "1.0.0",
    });

    await expectFrozenInstall(dir, "--linker", "isolated");
  });

  test.concurrent(
    "a rewritten root pin moves even though a transitive dependent still pins the old version",
    async () => {
      await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
      using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2", "uses-a-dep-2": "1.0.0" } });
      let lockfile = await lock(dir);
      expect(lockfile).toContain('"a-dep@1.0.2"');
      expect(lockfile).not.toContain('"a-dep@1.0.4"');

      const { stdout, stderr, exitCode } = await auditFix(dir);
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
        "bun audit fix <version> (<revision>)

        fixing:
          ^ a-dep 1.0.2 -> 1.0.4
            package.json: 1.0.2 -> 1.0.4

        blocked by a dependent's range:
          ^ a-dep 1.0.2 -> 1.0.4
            uses-a-dep-2@1.0.0 depends on a-dep@1.0.2

        Fixed 0 vulnerabilities in 1 package (checked 2)
        1 vulnerability remaining"
      `);
      expectSaved(stderr);
      expect(exitCode).toBe(1);

      expect((await pkgJson(dir)).dependencies).toStrictEqual({ "a-dep": "1.0.4", "uses-a-dep-2": "1.0.0" });
      lockfile = await lock(dir);
      expect(lockfile).toContain('"a-dep@1.0.4"');
      expect(lockfile).toContain('"a-dep@1.0.2"');
      expect(await installedVersions(dir, "a-dep", "uses-a-dep-2/node_modules/a-dep")).toEqual({
        "a-dep": "1.0.4",
        "uses-a-dep-2/node_modules/a-dep": "1.0.2",
      });

      await expectFrozenInstall(dir);
    },
  );

  test.concurrent("downgrades when no newer release is safe", async () => {
    await using server = startRegistry({ "a-dep": [adv(">=1.0.3")] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "^1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.10"');
    const pkgJsonBefore = await pkgJsonText(dir);

    const dryRun = await auditFix(dir, "--dry-run");
    expect(normalizeBunSnapshot(dryRun.stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        v a-dep 1.0.10 -> 1.0.2 (downgrade)

      Would fix 1 vulnerability in 1 package (checked 1)"
    `);
    expect(dryRun.stderr).toBe("");
    expect(dryRun.exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(normalizeBunSnapshot(dryRun.stdout).replace("Would fix", "Fixed"));
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.2"');
    expect(lockfile).not.toContain('"a-dep@1.0.10"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.2");
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);

    expectClean(await audit(dir), 1);
  });

  test.concurrent("downgrades a transitive dependency within its dependent's range", async () => {
    await using server = startRegistry({ "no-deps": [adv(">=1.0.1 <2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-range-dep": "1.0.0" } });
    expect(await lock(dir)).toContain('"no-deps@1.1.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        v no-deps 1.1.0 -> 1.0.0 (downgrade)

      Fixed 1 vulnerability in 1 package (checked 2)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.1.0"');
    expect(lockfile).not.toContain('"no-deps@2.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.0.0");

    await expectFrozenInstall(dir);
  });

  test.concurrent("prefers the lowest safe upgrade over any downgrade", async () => {
    await using server = startRegistry({ "a-dep": [adv(">=1.0.2 <1.0.4")] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });
    await reinstall(dir, { name: "foo", dependencies: { "a-dep": "^1.0.1" } });
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_FIXED);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain('"a-dep@1.0.1"');
    expect(lockfile).not.toContain('"a-dep@1.0.5"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
  });

  test.concurrent("counts a vulnerability removed by another fix from the written lockfile", async () => {
    await using server = startRegistry({ "one-fixed-dep": [adv("<2.0.0")], "no-deps": [adv("<1.0.1", 2)] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-fixed-dep": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-fixed-dep": ">=1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"one-fixed-dep@1.0.0"');
    expect(lockfile).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ one-fixed-dep 1.0.0 -> 2.0.0

      blocked by a dependent's range:
        ^ no-deps 1.0.0 -> 1.0.1
          one-fixed-dep@1.0.0 depends on no-deps@1.0.0

      Fixed 2 vulnerabilities in 1 package (checked 2)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"one-fixed-dep@2.0.0"');
    expect(lockfile).toContain('"no-deps@2.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(await installedVersions(dir, "one-fixed-dep", "no-deps")).toEqual({
      "one-fixed-dep": "2.0.0",
      "no-deps": "2.0.0",
    });

    expectClean(await audit(dir), 2);
  });

  test.concurrent("reports a vulnerable version the fix pulled in from the re-audit", async () => {
    const bulkBodies: Record<string, string[]>[] = [];
    await using server = startRegistry(
      { "one-fixed-dep": [adv("<2.0.0")], "no-deps": [adv(">=2.0.0", 2)] },
      { bulkBodies },
    );
    using dir = await setup(server, { name: "foo", dependencies: { "one-fixed-dep": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-fixed-dep": "^1.0.0 || ^2.0.0" } });
    expect(await lock(dir)).toContain('"one-fixed-dep@1.0.0"');

    // The install's own "+ package" lines stay out of the report.
    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ one-fixed-dep 1.0.0 -> 2.0.0

      vulnerable after install:
        no-deps@2.0.0  2

      Fixed 1 vulnerability in 1 package (checked 2)
      1 vulnerability remaining"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(1);
    expect(bulkBodies).toStrictEqual([
      { "one-fixed-dep": ["1.0.0"], "no-deps": ["1.0.0"] },
      { "one-fixed-dep": ["2.0.0"], "no-deps": ["2.0.0"] },
    ]);
    expect(await lock(dir)).toContain('"no-deps@2.0.0"');

    const recheck = await audit(dir);
    expect(normalizeBunSnapshot(recheck.stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      no-deps@2.0.0
        one-fixed-dep > no-deps
        high: test advisory (>=2.0.0) - https://example.invalid/advisory/2

      1 vulnerability (1 high)

        bun audit fix           upgrade the vulnerable packages within their ranges
        bun audit fix --latest  also cross major versions"
    `);
    expect(recheck.stderr).toBe("");
    expect(recheck.exitCode).toBe(1);
  });

  test.concurrent("--json prints a plan document with --dry-run", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2" } });
    const pkgJsonBefore = await pkgJsonText(dir);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json", "--dry-run");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toStrictEqual({
      dryRun: true,
      fixed: 1,
      remaining: 0,
      fixes: [
        {
          name: "a-dep",
          from: "1.0.2",
          to: "1.0.4",
          downgrade: false,
          newerThanMinimumReleaseAge: false,
          packageJson: [{ file: "package.json", catalog: null, key: "a-dep", from: "1.0.2", to: "1.0.4" }],
        },
      ],
      blocked: [],
      unfixable: [],
      manifestUnavailable: [],
      unmatched: [],
      unaudited: [],
      vulnerableAfterInstall: [],
    });
    expect(exitCode).toBe(0);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--json prints the result after installing", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json");
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(stdout)).toStrictEqual({
      dryRun: false,
      fixed: 1,
      remaining: 0,
      fixes: [
        {
          name: "a-dep",
          from: "1.0.2",
          to: "1.0.4",
          downgrade: false,
          newerThanMinimumReleaseAge: false,
          packageJson: [],
        },
      ],
      blocked: [],
      unfixable: [],
      manifestUnavailable: [],
      unmatched: [],
      unaudited: [],
      vulnerableAfterInstall: [],
    });
    expectSaved(stderr);
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");

    const clean = await auditFix(dir, "--json");
    expect(JSON.parse(clean.stdout)).toStrictEqual({
      dryRun: false,
      fixed: 0,
      remaining: 0,
      fixes: [],
      blocked: [],
      unfixable: [],
      manifestUnavailable: [],
      unmatched: [],
      unaudited: [],
      vulnerableAfterInstall: [],
    });
    expect(clean.stderr).toBe("");
    expect(clean.exitCode).toBe(0);
  });

  test.concurrent("--json takes remaining and vulnerableAfterInstall from the re-audit", async () => {
    const bulkBodies: Record<string, string[]>[] = [];
    await using server = startRegistry(
      { "no-deps": [adv(">=1.0.0 <1.0.1", 1), adv(">=1.0.1 <2.0.0", 2)] },
      { bulkBodies },
    );
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "no-deps": ">=1.0.0" } });
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json");
    expect(JSON.parse(stdout)).toStrictEqual({
      dryRun: false,
      fixed: 1,
      remaining: 1,
      fixes: [
        {
          name: "no-deps",
          from: "1.0.0",
          to: "1.0.1",
          downgrade: false,
          newerThanMinimumReleaseAge: false,
          packageJson: [],
        },
      ],
      blocked: [],
      unfixable: [],
      manifestUnavailable: [],
      unmatched: [],
      unaudited: [],
      vulnerableAfterInstall: [{ name: "no-deps", version: "1.0.1", advisories: ["2"] }],
    });
    expectSaved(stderr);
    expect(exitCode).toBe(1);
    expect(bulkBodies).toStrictEqual([{ "no-deps": ["1.0.0"] }, { "no-deps": ["1.0.1"] }]);
  });

  test.concurrent("--json with a blocked and an unmatched advisory", async () => {
    await using server = startRegistry({}, { bulkResponse: { "no-deps": [adv("<1.1.0"), adv(">=9.0.0", 2)] } });
    using dir = await setup(server, { name: "foo", dependencies: { "one-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.1"');

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json");
    expect(stderr).toBe("");
    const doc = JSON.parse(stdout);
    expect(doc.blocked).toStrictEqual([
      {
        name: "no-deps",
        from: "1.0.1",
        to: "1.1.0",
        downgrade: false,
        latestFixes: false,
        blockers: [{ dependent: "one-dep@1.0.0", range: "1.0.1", bundled: false }],
      },
    ]);
    expect(doc.unmatched).toStrictEqual([{ name: "no-deps", range: ">=9.0.0" }]);
    expect(doc).toMatchObject({ dryRun: false, fixed: 0, remaining: 2, fixes: [] });
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--json after installing carries the fixed and the blocked entries", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")], "no-deps": [adv("<1.1.0", 2)] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2", "one-dep": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "a-dep": "^1.0.2", "one-dep": "1.0.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.2"');
    expect(lockfile).toContain('"no-deps@1.0.1"');

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json");
    expect(JSON.parse(stdout)).toMatchObject({
      dryRun: false,
      fixed: 1,
      remaining: 1,
      fixes: [{ name: "a-dep", from: "1.0.2", to: "1.0.4" }],
      blocked: [{ name: "no-deps", from: "1.0.1", to: "1.1.0", blockers: [{ dependent: "one-dep@1.0.0" }] }],
      vulnerableAfterInstall: [],
    });
    expectSaved(stderr);
    expect(exitCode).toBe(1);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
  });

  test.concurrent("audits and fixes a package served by a scoped registry", async () => {
    await using scoped = startRegistry({ "@types/is-number": [adv("<2.0.0")] });
    await using server = startRegistry({});
    using dir = await setup(
      server,
      { name: "foo", dependencies: { "@types/is-number": "1.0.0" } },
      {},
      {
        types: scoped.url.href,
      },
    );
    await reinstall(dir, { name: "foo", dependencies: { "@types/is-number": ">=1.0.0" } });
    expect(await lock(dir)).toContain('"@types/is-number@1.0.0"');

    const before = await audit(dir);
    expect(normalizeBunSnapshot(before.stdout)).toMatchInlineSnapshot(`
      "bun audit <version> (<revision>)

      @types/is-number@1.0.0
        (direct dependency)
        high: test advisory (<2.0.0) - https://example.invalid/advisory/1

      1 vulnerability (1 high)

        bun audit fix           upgrade the vulnerable packages within their ranges
        bun audit fix --latest  also cross major versions"
    `);
    expect(before.stderr).toBe("");
    expect(before.exitCode).toBe(1);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ @types/is-number 1.0.0 -> 2.0.0

      Fixed 1 vulnerability in 1 package (checked 1)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);
    expect(await installedVersion(dir, "@types", "is-number")).toBe("2.0.0");

    expectClean(await audit(dir), 1);
  });

  test.concurrent("a scoped registry that does not answer the audit request is reported", async () => {
    await using scoped = startRegistry({}, { bulkStatus: 404 });
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(
      server,
      { name: "foo", dependencies: { "@types/is-number": "1.0.0", "a-dep": "1.0.2" } },
      {},
      {
        types: scoped.url.href,
      },
    );
    const skipped = skippedWarning(registryHref(scoped), "404", "@types/is-number");

    // The report itself does not mention the skipped registry: only the warning does.
    const report = await audit(dir);
    expect(normalizeBunSnapshot(report.stderr)).toBe(skipped);
    expect(normalizeBunSnapshot(report.stdout)).toBe(A_DEP_REPORT);
    expect(report.exitCode).toBe(1);

    const dryRun = await auditFix(dir, "--dry-run");
    expect(normalizeBunSnapshot(dryRun.stderr)).toBe(skipped);
    expect(normalizeBunSnapshot(dryRun.stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ a-dep 1.0.2 -> 1.0.4
          package.json: 1.0.2 -> 1.0.4

      Would fix 1 vulnerability in 1 package (checked 1, 1 skipped)"
    `);
    expect(dryRun.exitCode).toBe(0);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(normalizeBunSnapshot(dryRun.stdout).replace("Would fix", "Fixed"));
    expectSaved(stderr, skipped);
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
  });

  test.concurrent("`bun audit` and `bun audit fix` print the skipped registry at the same position", async () => {
    await using scoped = startRegistry({}, { bulkStatus: 404 });
    await using server = startRegistry({});
    using dir = await setup(
      server,
      { name: "foo", dependencies: { "@types/is-number": "1.0.0", "no-deps": "1.0.0" } },
      {},
      { types: scoped.url.href },
    );
    const skipped = skippedWarning(registryHref(scoped), "404", "@types/is-number");

    const report = await audit(dir);
    expect(normalizeBunSnapshot(report.stderr)).toBe(skipped);
    expect(normalizeBunSnapshot(report.stdout)).toBe(AUDIT_HEADER + noVulnerabilities(1, "1 skipped"));
    expect(report.stdout).toMatch(DURATION);
    expect(report.exitCode).toBe(0);

    const fix = await auditFix(dir);
    expect(normalizeBunSnapshot(fix.stderr)).toBe(skipped);
    expect(normalizeBunSnapshot(fix.stdout)).toBe(FIX_HEADER + noVulnerabilities(1, "1 skipped"));
    expect(fix.stdout).toMatch(DURATION);
    expect(fix.exitCode).toBe(0);
  });

  test.concurrent("--json lists a scoped registry that did not answer under unaudited", async () => {
    await using scoped = startRegistry({}, { bulkStatus: 404 });
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(
      server,
      { name: "foo", dependencies: { "@types/is-number": "1.0.0", "a-dep": "1.0.2" } },
      {},
      { types: scoped.url.href },
    );

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json", "--dry-run");
    expect(normalizeBunSnapshot(stderr)).toBe(skippedWarning(registryHref(scoped), "404", "@types/is-number"));
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(stdout)).toStrictEqual({
      dryRun: true,
      fixed: 1,
      remaining: 0,
      fixes: [
        {
          name: "a-dep",
          from: "1.0.2",
          to: "1.0.4",
          downgrade: false,
          newerThanMinimumReleaseAge: false,
          packageJson: [{ file: "package.json", catalog: null, key: "a-dep", from: "1.0.2", to: "1.0.4" }],
        },
      ],
      blocked: [],
      unfixable: [],
      manifestUnavailable: [],
      unmatched: [],
      unaudited: [{ registry: registryHref(scoped), packages: ["@types/is-number"], reason: "404" }],
      vulnerableAfterInstall: [],
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("fixes advisories from the default and a scoped registry in one run", async () => {
    await using scoped = startRegistry({ "@types/is-number": [adv("<2.0.0", 2)] });
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(
      server,
      { name: "foo", dependencies: { "@types/is-number": "1.0.0", "a-dep": "1.0.2" } },
      {},
      { types: scoped.url.href },
    );
    await reinstall(dir, { name: "foo", dependencies: { "@types/is-number": ">=1.0.0", "a-dep": "^1.0.2" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"@types/is-number@1.0.0"');
    expect(lockfile).toContain('"a-dep@1.0.2"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ @types/is-number 1.0.0 -> 2.0.0
        ^ a-dep 1.0.2 -> 1.0.4

      Fixed 2 vulnerabilities in 2 packages (checked 2)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"@types/is-number@2.0.0"');
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(await installedVersions(dir, "@types/is-number", "a-dep")).toEqual({
      "@types/is-number": "2.0.0",
      "a-dep": "1.0.4",
    });

    expectClean(await audit(dir), 2);
  });

  test.concurrent("dependents whose lowest acceptable fixes differ are moved to one common version", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-range-dep": "1.0.0", "no-deps": "1.0.0 || >=1.1.0" } });
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"no-deps@1.1.0"');
    const pkgJsonBefore = await pkgJsonText(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.0.0 -> 1.1.0

      Fixed 1 vulnerability in 1 package (checked 2)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@1.1.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain('"one-range-dep/no-deps"');
    expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);

    await expectFrozenInstall(dir);
  });

  test.concurrent("rewrites pins in the root and in a workspace member in one run", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")], "no-deps": [adv("<1.0.1", 2)] });
    using dir = await setup(
      server,
      { name: "root", workspaces: ["packages/*"], dependencies: { "a-dep": "1.0.2" } },
      { "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { "no-deps": "1.0.0" } }) },
    );
    let lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.2"');
    expect(lockfile).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ a-dep 1.0.2 -> 1.0.4
          package.json: 1.0.2 -> 1.0.4
        ^ no-deps 1.0.0 -> 1.0.1
          packages/a/package.json: 1.0.0 -> 1.0.1

      Fixed 2 vulnerabilities in 2 packages (checked 2)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect(await pkgJson(dir)).toStrictEqual({
      name: "root",
      workspaces: ["packages/*"],
      dependencies: { "a-dep": "1.0.4" },
    });
    expect(await pkgJson(dir, "packages", "a")).toStrictEqual({ name: "a", dependencies: { "no-deps": "1.0.1" } });
    lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).toContain('"no-deps@1.0.1"');
    expect(lockfile).not.toContain("a-dep@1.0.2");
    expect(lockfile).not.toContain("no-deps@1.0.0");

    await expectFrozenInstall(dir);
  });

  test.concurrent("rewrites two pins in one package.json and keeps its formatting", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")], "no-deps": [adv("<1.0.1", 2)] });
    const before = [
      "{",
      '\t"name": "foo",',
      '\t"dependencies": {',
      '\t\t"a-dep": "1.0.2",',
      '\t\t"no-deps": "1.0.0"',
      "\t},",
      '\t"scripts": {',
      '\t\t"check": "true"',
      "\t}",
      "}",
      "",
    ].join("\n");
    using dir = await setup(server, before);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ a-dep 1.0.2 -> 1.0.4
          package.json: 1.0.2 -> 1.0.4
        ^ no-deps 1.0.0 -> 1.0.1
          package.json: 1.0.0 -> 1.0.1

      Fixed 2 vulnerabilities in 2 packages (checked 2)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect(await pkgJsonText(dir)).toBe(
      before.replace('"a-dep": "1.0.2"', '"a-dep": "1.0.4"').replace('"no-deps": "1.0.0"', '"no-deps": "1.0.1"'),
    );
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).toContain('"no-deps@1.0.1"');

    await expectFrozenInstall(dir);
  });

  test.concurrent.each(["optionalDependencies", "peerDependencies"])("rewrites a pin declared in %s", async group => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, { name: "foo", [group]: { "a-dep": "1.0.2" } });
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_PIN_FIXED);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect(await pkgJson(dir)).toStrictEqual({ name: "foo", [group]: { "a-dep": "1.0.4" } });
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain("a-dep@1.0.2");

    await expectFrozenInstall(dir);
  });

  test.concurrent("only the group whose literal is the pin is rewritten", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "a-dep": "1.0.2" },
      peerDependencies: { "a-dep": "^1.0.0" },
    });
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_PIN_FIXED);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect(await pkgJson(dir)).toStrictEqual({
      name: "foo",
      dependencies: { "a-dep": "1.0.4" },
      peerDependencies: { "a-dep": "^1.0.0" },
    });
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain("a-dep@1.0.2");

    await expectFrozenInstall(dir);
  });

  test.concurrent("the same pin in two groups of one package.json is one edit", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "a-dep": "1.0.2" },
      peerDependencies: { "a-dep": "1.0.2" },
    });
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_PIN_FIXED);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect(await pkgJson(dir)).toStrictEqual({
      name: "foo",
      dependencies: { "a-dep": "1.0.4" },
      peerDependencies: { "a-dep": "1.0.4" },
    });
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain("a-dep@1.0.2");

    await expectFrozenInstall(dir);
  });

  test.concurrent("an npm: alias pin is rewritten even when its target name has an override", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { nd: "npm:a-dep@1.0.2" },
      overrides: { "a-dep": "1.0.2" },
    });
    expect(await lock(dir)).toContain('"a-dep@1.0.2"');

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ a-dep 1.0.2 -> 1.0.4
          package.json: npm:a-dep@1.0.2 -> npm:a-dep@1.0.4

      Fixed 1 vulnerability in 1 package (checked 1)"
    `);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect(await pkgJson(dir)).toStrictEqual({
      name: "foo",
      dependencies: { nd: "npm:a-dep@1.0.4" },
      overrides: { "a-dep": "1.0.2" },
    });
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"a-dep@1.0.4"');
    expect(lockfile).not.toContain('"a-dep@1.0.2"');
    expect(await installedVersion(dir, "nd")).toBe("1.0.4");

    const recheck = await audit(dir);
    expectClean(recheck, 1);

    await expectFrozenInstall(dir);
  });

  test.concurrent.each(["--dry-run", ""])(
    "--omit=dev still fixes a package only devDependencies reach (%s)",
    async flag => {
      await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
      using dir = await setup(server, { name: "foo", devDependencies: { "a-dep": "1.0.2" } });
      expect(await lock(dir)).toContain('"a-dep@1.0.2"');

      expectClean(await audit(dir, "--omit=dev"), 0);

      const args = flag ? ["--omit=dev", flag] : ["--omit=dev"];
      const { stdout, stderr, exitCode } = await auditFix(dir, ...args);
      expect(normalizeBunSnapshot(stdout)).toBe(flag ? A_DEP_PIN_PLAN : A_DEP_PIN_FIXED);
      if (flag) expect(stderr).toBe("");
      else expectSaved(stderr);
      expect(exitCode).toBe(0);

      const lockfile = await lock(dir);
      if (flag) {
        expect(lockfile).toContain('"a-dep@1.0.2"');
        expect((await pkgJson(dir)).devDependencies).toStrictEqual({ "a-dep": "1.0.2" });
        return;
      }
      expect(lockfile).toContain('"a-dep@1.0.4"');
      expect(lockfile).not.toContain("a-dep@1.0.2");
      expect((await pkgJson(dir)).devDependencies).toStrictEqual({ "a-dep": "1.0.4" });
      // The install step of the fix omits dev packages as well, so the old copy stays in node_modules until an
      // install without --omit runs; that install is what proves the rewritten bun.lock matches package.json.
      expect(await installedVersion(dir, "a-dep")).toBe("1.0.2");
      const installAll = await run(dir, ["install", "--frozen-lockfile"]);
      expect(normalizeBunSnapshot(installAll.stdout)).toBe(
        "bun install <version> (<revision>)\n\n+ a-dep@1.0.4\n\n1 package installed",
      );
      expect(installAll.stderr).toBe("");
      expect(installAll.exitCode).toBe(0);
      expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
    },
  );

  test.concurrent("a dist-tag dependency blocks the fix and is reported with its literal", async () => {
    await using server = startRegistry({ "dep-with-tags": [adv("<2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "dep-with-tags": "pre-1" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"dep-with-tags@1.0.1"');
    const pkgJsonBefore = await pkgJsonText(dir);

    const blocked = await auditFix(dir);
    expect(normalizeBunSnapshot(blocked.stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ dep-with-tags 1.0.1 -> 2.0.0
          package.json depends on dep-with-tags@pre-1

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(blocked.stderr).toBe("");
    expect(blocked.exitCode).toBe(1);

    const latest = await auditFix(dir, "--latest");
    expect(normalizeBunSnapshot(latest.stdout)).toBe(normalizeBunSnapshot(blocked.stdout));
    expect(latest.stderr).toBe("");
    expect(latest.exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout).blocked).toStrictEqual([
      {
        name: "dep-with-tags",
        from: "1.0.1",
        to: "2.0.0",
        downgrade: false,
        latestFixes: false,
        blockers: [{ dependent: "package.json", range: "pre-1", bundled: false }],
      },
    ]);
    expect(exitCode).toBe(1);
  });

  test.concurrent("an advisory with empty vulnerable_versions covers every version", async () => {
    await using server = startRegistry({}, { bulkResponse: { "no-deps": [adv("")] } });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "1.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      no published version fixes:
        no-deps@1.0.0  1
          bun audit fix --ignore 1

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("the unfixable section prints one --ignore line for every advisory", async () => {
    const ghsa = (range: string, id: number, tag: string) => ({
      ...adv(range, id),
      url: `https://github.com/advisories/GHSA-${tag}`,
    });
    await using server = startRegistry(
      {},
      {
        bulkResponse: {
          "a-dep": [ghsa(">=0.0.0", 1, "also-aaaa-aaaa"), ghsa(">=0.0.0", 2, "forever-bbbb-bbbb")],
          "no-deps": [adv(">=0.0.0", 3)],
        },
      },
    );
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "1.0.2", "no-deps": "1.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir);
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      no published version fixes:
        a-dep@1.0.2  GHSA-also-aaaa-aaaa, GHSA-forever-bbbb-bbbb
        no-deps@1.0.0  3
          bun audit fix --ignore GHSA-also-aaaa-aaaa --ignore GHSA-forever-bbbb-bbbb --ignore 3

      Fixed 0 of 3 vulnerabilities (checked 2)
      3 vulnerabilities remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);

    const hints = stdout.split("\n").filter(line => line.trimStart().startsWith("bun audit fix --ignore "));
    expect(hints).toHaveLength(1);
    const args = hints[0].trim().split(" ").slice(3);
    const ignored = await audit(dir, ...args);
    expect(normalizeBunSnapshot(ignored.stdout)).toBe(AUDIT_HEADER + noVulnerabilities(2, "3 ignored"));
    expect(ignored.stderr).toBe("");
    expect(ignored.exitCode).toBe(0);

    const ignoredFix = await auditFix(dir, ...args);
    expect(normalizeBunSnapshot(ignoredFix.stdout)).toBe(FIX_HEADER + noVulnerabilities(2, "3 ignored"));
    expect(ignoredFix.stderr).toBe("");
    expect(ignoredFix.exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--json carries an unfixable version", async () => {
    await using server = startRegistry({}, { bulkResponse: { "no-deps": [adv(">=0.0.0")] } });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "^1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.1.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json");
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toStrictEqual({
      dryRun: false,
      fixed: 0,
      remaining: 1,
      fixes: [],
      blocked: [],
      unfixable: [{ name: "no-deps", from: "1.1.0", advisories: ["1"] }],
      manifestUnavailable: [],
      unmatched: [],
      unaudited: [],
      vulnerableAfterInstall: [],
    });
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--json carries a version whose manifest could not be fetched", async () => {
    const denyManifests = new Set<string>();
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { denyManifests });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);
    denyManifests.add("a-dep");

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json");
    expect(normalizeBunSnapshot(stderr)).toBe(
      `warn: a-dep@1.0.2 was not checked for updates: GET ${registryHref(server)}/a-dep - 404`,
    );
    expect(JSON.parse(stdout)).toStrictEqual({
      dryRun: false,
      fixed: 0,
      remaining: 1,
      fixes: [],
      blocked: [],
      unfixable: [],
      manifestUnavailable: [{ name: "a-dep", from: "1.0.2", error: "404" }],
      unmatched: [],
      unaudited: [],
      vulnerableAfterInstall: [],
    });
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--json carries versions that are vulnerable after the install", async () => {
    const bulkHits = { count: 0 };
    await using server = startRegistry(
      { "one-fixed-dep": [adv("<2.0.0")], "no-deps": [adv(">=2.0.0", 2)] },
      { bulkHits },
    );
    using dir = await setup(server, { name: "foo", dependencies: { "one-fixed-dep": "1.0.0" } });
    await reinstall(dir, { name: "foo", dependencies: { "one-fixed-dep": "^1.0.0 || ^2.0.0" } });
    expect(await lock(dir)).toContain('"one-fixed-dep@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json");
    expectSaved(stderr);
    expect(JSON.parse(stdout)).toStrictEqual({
      dryRun: false,
      fixed: 1,
      remaining: 1,
      fixes: [
        {
          name: "one-fixed-dep",
          from: "1.0.0",
          to: "2.0.0",
          downgrade: false,
          newerThanMinimumReleaseAge: false,
          packageJson: [],
        },
      ],
      blocked: [],
      unfixable: [],
      manifestUnavailable: [],
      unmatched: [],
      unaudited: [],
      vulnerableAfterInstall: [{ name: "no-deps", version: "2.0.0", advisories: ["2"] }],
    });
    expect(exitCode).toBe(1);
    expect(bulkHits.count).toBe(2);
    expect(await lock(dir)).toContain('"no-deps@2.0.0"');
  });

  test.concurrent("--json marks a downgrade", async () => {
    await using server = startRegistry({ "a-dep": [adv(">=1.0.3")] });
    using dir = await setup(server, { name: "foo", dependencies: { "a-dep": "^1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"a-dep@1.0.10"');

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json", "--dry-run");
    expect(stderr).toBe("");
    const doc = JSON.parse(stdout);
    expect(doc.fixes).toStrictEqual([
      {
        name: "a-dep",
        from: "1.0.10",
        to: "1.0.2",
        downgrade: true,
        newerThanMinimumReleaseAge: false,
        packageJson: [],
      },
    ]);
    expect(doc).toMatchObject({ dryRun: true, fixed: 1, remaining: 0 });
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--json marks a fix newer than --minimum-release-age", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(
      dir,
      "--json",
      "--dry-run",
      "--minimum-release-age",
      "3153600000",
    );
    expect(stderr).toBe("");
    const doc = JSON.parse(stdout);
    expect(doc.fixes).toStrictEqual([
      {
        name: "a-dep",
        from: "1.0.2",
        to: "1.0.4",
        downgrade: false,
        newerThanMinimumReleaseAge: true,
        packageJson: [],
      },
    ]);
    expect(doc).toMatchObject({ dryRun: true, fixed: 1, remaining: 0 });
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--json marks a bundled blocker", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "bundled-1": "1.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json");
    expect(stderr).toBe("");
    const doc = JSON.parse(stdout);
    expect(doc.blocked).toStrictEqual([
      {
        name: "no-deps",
        from: "1.0.0",
        to: "1.0.1",
        downgrade: false,
        latestFixes: false,
        blockers: [{ dependent: "bundled-1@1.0.0", range: "1.0.0", bundled: true }],
      },
    ]);
    expect(doc).toMatchObject({ dryRun: false, fixed: 0, remaining: 1, fixes: [] });
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--json marks a blocked fix that would be a downgrade", async () => {
    await using server = startRegistry({ "no-deps": [adv(">=2.0.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "^2.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json");
    expect(stderr).toBe("");
    const doc = JSON.parse(stdout);
    expect(doc.blocked).toStrictEqual([
      {
        name: "no-deps",
        from: "2.0.0",
        to: "1.1.0",
        downgrade: true,
        latestFixes: true,
        blockers: [{ dependent: "package.json", range: "^2.0.0", bundled: false }],
      },
    ]);
    expect(doc).toMatchObject({ dryRun: false, fixed: 0, remaining: 1, fixes: [] });
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent.each([
    ["catalog", { catalog: { "no-deps": "1.0.0" } }, "catalog:", "default"],
    ["catalogs.build", { catalogs: { build: { "no-deps": "1.0.0" } } }, "catalog:build", "build"],
  ])("--json names the catalog of a rewritten %s entry", async (_, rootFields, reference, catalog) => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(
      server,
      { name: "root", workspaces: ["packages/*"], ...rootFields },
      { "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { "no-deps": reference } }) },
    );
    expect(await lock(dir)).toContain('"no-deps@1.0.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir, "--json");
    expectSaved(stderr);
    const doc = JSON.parse(stdout);
    expect(doc.fixes).toStrictEqual([
      {
        name: "no-deps",
        from: "1.0.0",
        to: "1.0.1",
        downgrade: false,
        newerThanMinimumReleaseAge: false,
        packageJson: [{ file: "package.json", catalog, key: "no-deps", from: "1.0.0", to: "1.0.1" }],
      },
    ]);
    expect(doc).toMatchObject({ dryRun: false, fixed: 1, remaining: 0 });
    expect(exitCode).toBe(0);
    expect(await lock(dir)).toContain('"no-deps@1.0.1"');
  });

  test.concurrent("a bunfig.toml that freezes or stops saving the lockfile is explained in the note", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    await writeBunfig(dir, server, undefined, { frozenLockfile: true });
    const frozen = await auditFix(dir);
    expect(frozen.stderr).toBe(FROZEN_ERROR);
    expect(normalizeBunSnapshot(frozen.stdout)).toBe("bun audit fix <version> (<revision>)");
    expect(frozen.exitCode).toBe(1);

    await writeBunfig(dir, server, undefined, { lockfile: { save: false } });
    const noSave = await auditFix(dir);
    expect(noSave.stderr).toBe(NO_SAVE_ERROR);
    expect(normalizeBunSnapshot(noSave.stdout)).toBe("bun audit fix <version> (<revision>)");
    expect(noSave.exitCode).toBe(1);

    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("--frozen-lockfile --silent exits 1 without printing", async () => {
    const bulkHits = { count: 0 };
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { bulkHits });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--frozen-lockfile", "--silent");
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
    expect(bulkHits.count).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("-p and -P are rejected before the registry is contacted", async () => {
    const bulkHits = { count: 0 };
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { bulkHits });
    using dir = await setupVulnerableADep(server);

    for (const flag of ["-p", "-P", "--prod"]) {
      const { stdout, stderr, exitCode } = await auditFix(dir, flag);
      expect(stderr).toBe(FROZEN_ERROR);
      expect(normalizeBunSnapshot(stdout)).toBe("bun audit fix <version> (<revision>)");
      expect(exitCode).toBe(1);
    }
    expect(bulkHits.count).toBe(0);
  });
});

describe("`bun audit fix --latest`", () => {
  // Every no-deps 1.x release is vulnerable, so the only fix is 2.0.0, which no 1.x range accepts.
  const noDeps1x = () => startRegistry({ "no-deps": [adv("<2.0.0")] });

  test.concurrent("rewrites a root range that excludes the fix", async () => {
    await using server = noDeps1x();
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "^1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.1.0"');
    const pkgJsonBefore = await pkgJsonText(dir);

    const blocked = await auditFix(dir);
    expect(normalizeBunSnapshot(blocked.stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ no-deps 1.1.0 -> 2.0.0
          package.json depends on no-deps@^1.0.0
          bun audit fix --latest

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(blocked.stderr).toBe("");
    expect(blocked.exitCode).toBe(1);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
    expect(await lock(dir)).toBe(lockBefore);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--latest");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.1.0 -> 2.0.0
          package.json: ^1.0.0 -> ^2.0.0

      Fixed 1 vulnerability in 1 package (checked 1)"
    `);
    expect(stdout).toMatch(DURATION);
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).dependencies).toStrictEqual({ "no-deps": "^2.0.0" });
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@2.0.0"');
    expect(lockfile).toContain('"no-deps": "^2.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.1.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");

    expectClean(await audit(dir), 1);
    await expectFrozenInstall(dir);
  });

  // The report of a --latest run that moved no-deps from `installed` to 2.0.0 and made `edit` to its package.json entry.
  function latestReport(installed: string, edit: string) {
    return (
      FIX_HEADER +
      `fixing:\n  ^ no-deps ${installed} -> 2.0.0\n    package.json: ${edit}\n\n` +
      "Fixed 1 vulnerability in 1 package (checked 1)"
    );
  }

  test.concurrent.each([
    [">=1.0.0 <2.0.0", "1.1.0", "^2.0.0"],
    ["1.x", "1.1.0", "^2.0.0"],
    ["1", "1.1.0", "^2.0.0"],
    ["1.0", "1.0.1", "~2.0.0"],
    ["~1.0.0", "1.0.1", "~2.0.0"],
    ["1.0.0", "1.0.0", "2.0.0"],
    ["=1.0.0", "1.0.0", "=2.0.0"],
  ])("a range written as %s (resolving to %s) is rewritten as %s", async (declared, installed, rewritten) => {
    await using server = noDeps1x();
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": declared } });
    expect(await lock(dir)).toContain(`"no-deps@${installed}"`);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--latest");
    expect(normalizeBunSnapshot(stdout)).toBe(latestReport(installed, `${declared} -> ${rewritten}`));
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).dependencies).toStrictEqual({ "no-deps": rewritten });
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@2.0.0"');
    expect(lockfile).toContain(`"no-deps": "${rewritten}"`);
    expect(lockfile).not.toContain(`"no-deps@${installed}"`);
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");

    await expectFrozenInstall(dir);
  });

  test.concurrent("-L is accepted as --latest", async () => {
    await using server = noDeps1x();
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "^1.0.0" } });
    expect(await lock(dir)).toContain('"no-deps@1.1.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir, "-L");
    expect(normalizeBunSnapshot(stdout)).toBe(latestReport("1.1.0", "^1.0.0 -> ^2.0.0"));
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).dependencies).toStrictEqual({ "no-deps": "^2.0.0" });
    expect(await lock(dir)).toContain('"no-deps@2.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
  });

  test.concurrent("keeps an npm: alias prefix", async () => {
    await using server = noDeps1x();
    using dir = await setup(server, { name: "foo", dependencies: { nd: "npm:no-deps@^1.0.0" } });
    expect(await lock(dir)).toContain('"no-deps@1.1.0"');

    const { stdout, stderr, exitCode } = await auditFix(dir, "--latest");
    expect(normalizeBunSnapshot(stdout)).toBe(latestReport("1.1.0", "npm:no-deps@^1.0.0 -> npm:no-deps@^2.0.0"));
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).dependencies).toStrictEqual({ nd: "npm:no-deps@^2.0.0" });
    expect(await lock(dir)).toContain('"no-deps@2.0.0"');
    expect(await installedVersion(dir, "nd")).toBe("2.0.0");

    await expectFrozenInstall(dir);
  });

  test.concurrent("install.exact writes the bare version", async () => {
    await using server = noDeps1x();
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "^1.0.0" } });
    await writeBunfig(dir, server, undefined, { exact: true });

    const { stdout, stderr, exitCode } = await auditFix(dir, "--latest");
    expect(normalizeBunSnapshot(stdout)).toBe(latestReport("1.1.0", "^1.0.0 -> 2.0.0"));
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).dependencies).toStrictEqual({ "no-deps": "2.0.0" });
    expect(await lock(dir)).toContain('"no-deps@2.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
  });

  test.concurrent("rewrites a workspace member's own range and leaves the root alone", async () => {
    await using server = noDeps1x();
    const rootPkgJson = JSON.stringify({ name: "root", workspaces: ["packages/*"] });
    using dir = await setup(server, rootPkgJson, {
      "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { "no-deps": "^1.0.0" } }),
    });
    expect(await lock(dir)).toContain('"no-deps@1.1.0"');

    const blocked = await auditFix(dir);
    expect(normalizeBunSnapshot(blocked.stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ no-deps 1.1.0 -> 2.0.0
          packages/a/package.json depends on no-deps@^1.0.0
          bun audit fix --latest

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(blocked.stderr).toBe("");
    expect(blocked.exitCode).toBe(1);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--latest");
    expect(normalizeBunSnapshot(stdout)).toBe(
      latestReport("1.1.0", "^1.0.0 -> ^2.0.0").replace("package.json", "packages/a/package.json"),
    );
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir, "packages", "a")).dependencies).toStrictEqual({ "no-deps": "^2.0.0" });
    expect(await pkgJsonText(dir)).toBe(rootPkgJson);
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@2.0.0"');
    expect(lockfile).toContain('"no-deps": "^2.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.1.0"');
    expect(await exists(join(dir, "packages", "a", "bun.lock"))).toBeFalse();

    await expectFrozenInstall(dir);
  });

  test.concurrent("rewrites a ranged catalog entry and the member keeps `catalog:`", async () => {
    await using server = noDeps1x();
    const member = JSON.stringify({ name: "a", dependencies: { "no-deps": "catalog:" } });
    using dir = await setup(
      server,
      { name: "root", workspaces: ["packages/*"], catalog: { "no-deps": "^1.0.0" } },
      { "packages/a/package.json": member },
    );
    expect(await lock(dir)).toContain('"no-deps@1.1.0"');
    const rootBefore = await pkgJsonText(dir);

    const blocked = await auditFix(dir);
    expect(normalizeBunSnapshot(blocked.stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ no-deps 1.1.0 -> 2.0.0
          packages/a/package.json depends on no-deps@^1.0.0
          bun audit fix --latest

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(blocked.stderr).toBe("");
    expect(blocked.exitCode).toBe(1);
    expect(await pkgJsonText(dir)).toBe(rootBefore);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--latest");
    expect(normalizeBunSnapshot(stdout)).toBe(
      latestReport("1.1.0", "^1.0.0 -> ^2.0.0").replace("package.json:", "package.json (catalog):"),
    );
    expectSaved(stderr);
    expect(exitCode).toBe(0);

    expect((await pkgJson(dir)).catalog).toStrictEqual({ "no-deps": "^2.0.0" });
    expect(await pkgJsonText(dir, "packages", "a")).toBe(member);
    const lockfile = await lock(dir);
    expect(lockfile).toContain('"no-deps@2.0.0"');
    expect(lockfile).not.toContain('"no-deps@1.1.0"');
    expect(lockfile).toContain('"no-deps": "^2.0.0"');
    expect(lockfile).toContain('"no-deps": "catalog:"');

    await expectFrozenInstall(dir);
  });

  test.concurrent("--dry-run prints the package.json edit and writes nothing", async () => {
    await using server = noDeps1x();
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "^1.0.0" } });
    const pkgJsonBefore = await pkgJsonText(dir);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--latest", "--dry-run");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      fixing:
        ^ no-deps 1.1.0 -> 2.0.0
          package.json: ^1.0.0 -> ^2.0.0

      Would fix 1 vulnerability in 1 package (checked 1)"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
    expect(await lock(dir)).toBe(lockBefore);
    expect(await installedVersion(dir, "no-deps")).toBe("1.1.0");
  });

  test.concurrent("--json carries the package.json edit", async () => {
    await using server = noDeps1x();
    using dir = await setup(server, { name: "foo", dependencies: { "no-deps": "^1.0.0" } });

    const { stdout, stderr, exitCode } = await auditFix(dir, "--latest", "--json");
    expectSaved(stderr);
    const doc = JSON.parse(stdout);
    expect(doc.fixes).toStrictEqual([
      {
        name: "no-deps",
        from: "1.1.0",
        to: "2.0.0",
        downgrade: false,
        newerThanMinimumReleaseAge: false,
        packageJson: [{ file: "package.json", catalog: null, key: "no-deps", from: "^1.0.0", to: "^2.0.0" }],
      },
    ]);
    expect(doc).toMatchObject({ dryRun: false, fixed: 1, remaining: 0, blocked: [] });
    expect(exitCode).toBe(0);
    expect((await pkgJson(dir)).dependencies).toStrictEqual({ "no-deps": "^2.0.0" });
    expect(await lock(dir)).toContain('"no-deps@2.0.0"');
    expect(await installedVersion(dir, "no-deps")).toBe("2.0.0");
  });

  test.concurrent("a package blocked only by a transitive dependent stays blocked", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.1.0")] });
    using dir = await setup(server, { name: "foo", dependencies: { "one-dep": "1.0.0" } });
    const lockBefore = await lock(dir);
    expect(lockBefore).toContain('"no-deps@1.0.1"');
    const pkgJsonBefore = await pkgJsonText(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--latest");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ no-deps 1.0.1 -> 1.1.0
          one-dep@1.0.0 depends on no-deps@1.0.1

      Fixed 0 of 1 vulnerability (checked 2)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("a version held by an overrides entry stays blocked", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setup(server, {
      name: "foo",
      dependencies: { "a-dep": "^1.0.2" },
      overrides: { "a-dep": "1.0.2" },
    });
    const lockBefore = await lock(dir);
    const pkgJsonBefore = await pkgJsonText(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--latest");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ a-dep 1.0.2 -> 1.0.4
          package.json depends on a-dep@1.0.2

      Fixed 0 of 1 vulnerability (checked 1)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("a bundled dependency stays blocked without a --latest hint", async () => {
    await using server = startRegistry({ "no-deps": [adv("<1.0.1")] });
    using dir = await setup(server, { name: "foo", dependencies: { "bundled-1": "1.0.0" } });
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--latest");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
      "bun audit fix <version> (<revision>)

      blocked by a dependent's range:
        ^ no-deps 1.0.0 -> 1.0.1
          bundled-1@1.0.0 bundles no-deps@1.0.0

      Fixed 0 of 1 vulnerability (checked 2)
      1 vulnerability remaining"
    `);
    expect(stderr).toBe("");
    expect(exitCode).toBe(1);
    expect(await lock(dir)).toBe(lockBefore);
  });

  test.concurrent("a fix inside the declared range does not touch package.json", async () => {
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] });
    using dir = await setupVulnerableADep(server);
    const pkgJsonBefore = await pkgJsonText(dir);

    const { stdout, stderr, exitCode } = await auditFix(dir, "--latest");
    expect(normalizeBunSnapshot(stdout)).toBe(A_DEP_FIXED);
    expectSaved(stderr);
    expect(exitCode).toBe(0);
    expect(await pkgJsonText(dir)).toBe(pkgJsonBefore);
    expect(await lock(dir)).toContain('"a-dep@1.0.4"');
    expect(await installedVersion(dir, "a-dep")).toBe("1.0.4");
  });

  test.concurrent("`bun audit --latest` without fix is rejected before the registry is contacted", async () => {
    const bulkHits = { count: 0 };
    await using server = startRegistry({ "a-dep": [adv("<1.0.4")] }, { bulkHits });
    using dir = await setupVulnerableADep(server);
    const lockBefore = await lock(dir);

    const { stdout, stderr, exitCode } = await audit(dir, "--latest");
    expect(stderr).toBe("error: --latest only applies to bun audit fix\n");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
    expect(bulkHits.count).toBe(0);
    expect(await lock(dir)).toBe(lockBefore);
  });
});
