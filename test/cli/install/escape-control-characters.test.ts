/**
 * Strings the package manager prints but did not write itself must not be able
 * to smuggle terminal control sequences into the user's terminal: here, the
 * resolution and version specifier of a dependency (which any package.json in
 * the tree controls), bin names (which the package controls), and the text of a
 * registry's error response. Each control character has to come out spelled
 * as its escape (`\x1b`, `\u009b`, ...).
 *
 * One fake registry serves every test. Any package name resolves to a packument
 * whose 1.0.0 installs cleanly and whose 2.0.0 (the `latest` tag) depends on a
 * dist-tag that does not exist; every tarball carries a poisoned bin name.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { rm } from "node:fs/promises";
import { join } from "node:path";

// OSC "set window title" followed by CSI "clear screen".
const ESC = "\x1b]0;pwned\x07\x1b[2J";
const ESC_ESCAPED = "\\x1b]0;pwned\\x07\\x1b[2J";

// U+009B is the one-character (C1) spelling of CSI. Unlike C0 bytes and DEL it
// is accepted in file names, in URLs (bun percent-encodes it on the wire but
// prints the specifier as written) and in an HTTP status line.
const C1 = "\u009b31m";
const C1_ESCAPED = "\\u009b31m";

const BIN = `bin-${C1}-name`;
const BIN_ESCAPED = `bin-${C1_ESCAPED}-name`;
const BAD_TAG = `tag-${ESC}`;
const BAD_TAG_ESCAPED = `tag-${ESC_ESCAPED}`;

// bun's own output is printable text and newlines; any other C0 byte, DEL or
// C1 character in stdout/stderr came through from the fixture unescaped.
const RAW_CONTROL = /[\x00-\x09\x0b-\x1f\x7f\x80-\x9f]/;

let registry: Bun.Server;
let registryUrl: string;
let tarball: Promise<Uint8Array>;
/** A tarball specifier that installs (the server ignores the path). */
let tarballSpec: string;
let tarballSpecEscaped: string;
/** `dist.tarball` of `<name>` for the packages whose tarball tests break on purpose. */
const distTarball = (name: string) => `${registryUrl}/${name}/-/dep-${C1}.tgz`;
const distTarballEscaped = (name: string) => `${registryUrl}/${name}/-/dep-${C1_ESCAPED}.tgz`;
/** Decoded request paths the server answers with a 404. */
const brokenTarballPaths = new Set<string>();

function packumentFor(name: string) {
  const manifest = (version: string, dependencies: Record<string, string>) => ({
    name,
    version,
    dist: { tarball: distTarball(name) },
    bin: { [BIN]: "index.js" },
    dependencies,
  });
  return {
    name,
    "dist-tags": { latest: "2.0.0" },
    versions: {
      "1.0.0": manifest("1.0.0", {}),
      "2.0.0": manifest("2.0.0", { sub: BAD_TAG }),
    },
  };
}

beforeAll(() => {
  tarball = new Bun.Archive(
    {
      "package/package.json": JSON.stringify({ name: "dep", version: "1.0.0", bin: { [BIN]: "index.js" } }),
      "package/index.js": "#!/usr/bin/env node\n",
    },
    { compress: "gzip" },
  ).bytes();

  registry = Bun.serve({
    port: 0,
    async fetch(req) {
      const pathname = decodeURIComponent(new URL(req.url).pathname);
      if (brokenTarballPaths.has(pathname)) {
        return new Response("gone", { status: 404 });
      }
      if (pathname.endsWith(".tgz")) {
        return new Response(await tarball);
      }
      return Response.json(packumentFor(pathname.slice(1)));
    },
  });
  registryUrl = `http://127.0.0.1:${registry.port}`;
  tarballSpec = `${registryUrl}/tarballs/dep-${C1}.tgz`;
  tarballSpecEscaped = `${registryUrl}/tarballs/dep-${C1_ESCAPED}.tgz`;
  brokenTarballPaths.add(decodeURIComponent(new URL(distTarball("broken-tarball")).pathname));
});

afterAll(() => {
  registry?.stop(true);
});

function project(name: string, packageJson: object, registry = registryUrl) {
  return tempDir(`escape-controls-${name}`, {
    "package.json": JSON.stringify({ name: "app", version: "1.0.0", ...packageJson }),
    "bunfig.toml": `[install]\nregistry = "${registry}"\n`,
  });
}

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(cwd, ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function installOk(dir: string) {
  const result = await run(dir, "install");
  expect(result.stderr).not.toContain("error:");
  expect(result.exitCode).toBe(0);
  return result;
}

test.concurrent("bun install summary escapes the resolution", async () => {
  using dir = project("install", { dependencies: { dep: tarballSpec } });
  const { stdout, stderr } = await installOk(String(dir));
  expect(stdout).toContain(`+ dep@${tarballSpecEscaped}`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
});

test.concurrent("bun pm ls escapes the resolution", async () => {
  using dir = project("pm-ls", { dependencies: { dep: tarballSpec } });
  await installOk(String(dir));
  for (const args of [
    ["pm", "ls"],
    ["pm", "ls", "--all"],
  ]) {
    const { stdout, stderr, exitCode } = await run(String(dir), ...args);
    expect(stdout).toContain(`dep@${tarballSpecEscaped}`);
    expect(stdout + stderr).not.toMatch(RAW_CONTROL);
    expect(exitCode).toBe(0);
  }
});

test.concurrent("bun why escapes the resolution and the specifier", async () => {
  using dir = project("why", { dependencies: { dep: tarballSpec } });
  await installOk(String(dir));
  const { stdout, stderr, exitCode } = await run(String(dir), "why", "dep");
  expect(stdout).toContain(`dep@${tarballSpecEscaped}`);
  expect(stdout).toContain(`(requires ${tarballSpecEscaped})`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(0);
});

test.concurrent("bun add escapes the bin names it reports", async () => {
  using dir = project("add", {});
  const { stdout, stderr, exitCode } = await run(String(dir), "add", "has-bin@1.0.0");
  expect(stdout).toContain("installed has-bin@1.0.0 with binaries:");
  expect(stdout).toContain(` - ${BIN_ESCAPED}`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(0);
});

test.concurrent("resolution errors escape the dist-tag", async () => {
  using dir = project("dist-tag", {});
  const { stdout, stderr, exitCode } = await run(String(dir), "add", "unresolvable");
  expect(stderr).toContain(`Package "sub" with tag "${BAD_TAG_ESCAPED}" not found, but package exists`);
  expect(stderr).toContain(`sub@${BAD_TAG_ESCAPED} failed to resolve`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(1);
});

test.concurrent("resolution errors escape a file: path", async () => {
  using dir = project("file-path", { dependencies: { dep: `file:./missing-${C1}` } });
  const { stdout, stderr, exitCode } = await run(String(dir), "install");
  expect(stderr).toContain(`Could not find package.json for "file:missing-${C1_ESCAPED}" dependency "dep"`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(1);
});

test.concurrent("a tarball specifier bun rejects is reported with the specifier escaped", async () => {
  // C0 bytes are not valid in a URL, so this never gets as far as a request.
  using dir = project("invalid-url", { dependencies: { dep: `${registryUrl}/tarballs/dep-${ESC}.tgz` } });
  const { stdout, stderr, exitCode } = await run(String(dir), "install");
  expect(stderr).toContain(`InvalidURL downloading tarball dep@${registryUrl}/tarballs/dep-${ESC_ESCAPED}.tgz`);
  expect(stderr).toContain(`dep@${registryUrl}/tarballs/dep-${ESC_ESCAPED}.tgz failed to resolve`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(1);
});

test.concurrent("a tarball the registry cannot serve is reported with its URL escaped", async () => {
  using dir = project("tarball-404", { dependencies: { "broken-tarball": "1.0.0" } });
  const { stdout, stderr, exitCode } = await run(String(dir), "install");
  expect(stderr).toContain(`GET ${distTarballEscaped("broken-tarball")} - 404`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(1);
});

test.concurrent("the isolated installer reports a failed download with its URL escaped", async () => {
  // With a lockfile already present, the isolated installer downloads the
  // tarballs itself and reports failures through its own message.
  using dir = project("isolated-404", { dependencies: { "breaks-later": "1.0.0" } });
  await installOk(String(dir));
  brokenTarballPaths.add(decodeURIComponent(new URL(distTarball("breaks-later")).pathname));
  await rm(join(String(dir), "node_modules"), { recursive: true });
  await rm(join(String(dir), ".bun-cache"), { recursive: true });

  const { stdout, stderr, exitCode } = await run(String(dir), "install", "--linker", "isolated");
  expect(stderr).toContain("failed to download breaks-later@1.0.0: 404 Not Found");
  expect(stderr).toContain(`  ${distTarballEscaped("breaks-later")}`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(1);
});

test.concurrent("registry error responses are escaped", async () => {
  const body = JSON.stringify({ error: `denied${ESC}` });
  const response =
    `HTTP/1.1 403 Nope${C1}\r\n` +
    `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n` +
    body;
  using rawRegistry = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket) {
        socket.end(response);
      },
    },
  });
  using dir = project("registry-error", {}, `http://127.0.0.1:${rawRegistry.port}`);

  const { stdout, stderr, exitCode } = await run(String(dir), "pm", "view", "forbidden");
  expect(stderr).toContain(`403 Nope${C1_ESCAPED}: http://127.0.0.1:${rawRegistry.port}/forbidden`);
  expect(stderr).toContain(` - denied${ESC_ESCAPED}`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(1);
});
