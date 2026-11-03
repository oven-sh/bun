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
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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
// Text that must come through untouched, next to the bytes that must not: a
// backslash, `\u00a9` (also a two-byte character starting with 0xC2, like the C1
// controls), a three-byte character, a four-byte one, a run longer than a SIMD
// vector, a tab and DEL.
const PASSTHROUGH = `a\\b \u00a9 \u20ac \u{1f600} ${Buffer.alloc(70, "x")}`;
const BAD_TAG = `tag-${ESC}${PASSTHROUGH}\t${C1}\x7f`;
const BAD_TAG_ESCAPED = `tag-${ESC_ESCAPED}${PASSTHROUGH}\\t${C1_ESCAPED}\\x7f`;

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
/** A failed request is reported with the URL that was requested, which is `dist.tarball` as `new URL()` serialises it. */
const distTarballEscaped = (name: string) => new URL(distTarball(name)).href;
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
    "dist-tags": { latest: "2.0.0", [`tag-${C1}`]: "1.0.0" },
    versions: {
      "1.0.0": manifest("1.0.0", name === "needs-dep" ? { dep: "1.0.0" } : {}),
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
      if (pathname.startsWith("/failing/")) {
        return new Response("try again", { status: 500 });
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
  expect(stderr).toContain(`package.json not found for "file:missing-${C1_ESCAPED}" dependency "dep"`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(1);
});

test.concurrent("bun patch lists the candidate resolutions escaped", async () => {
  // Two lockfile entries named `dep`: the root's tarball and the registry's
  // 1.0.0 that `needs-dep` depends on, so `bun patch dep` has to ask which one.
  using dir = project("patch", { dependencies: { dep: tarballSpec, "needs-dep": "1.0.0" } });
  await installOk(String(dir));
  const { stdout, stderr, exitCode } = await run(String(dir), "patch", "dep");
  expect(stderr).toContain("Found multiple versions of dep");
  expect(stderr).toContain(`dep@${tarballSpecEscaped}`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).not.toBe(0);
});

test.concurrent("a workspace range that matches nothing is reported escaped", async () => {
  using dir = tempDir("escape-controls-workspace-range", {
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      workspaces: ["packages/*"],
      dependencies: { ws: `workspace:^2.0.0-${C1}` },
    }),
    "packages/ws/package.json": JSON.stringify({ name: "ws", version: "1.0.0" }),
  });
  const { stdout, stderr, exitCode } = await run(String(dir), "install");
  expect(stderr).toContain(
    `No matching version for workspace dependency "ws". Version: "workspace:^2.0.0-${C1_ESCAPED}"`,
  );
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

test.concurrent("the verbose resolve trace escapes the specifier and the resolution", async () => {
  using dir = tempDir("escape-controls-resolve-trace", {
    "package.json": JSON.stringify({
      name: "app",
      version: "1.0.0",
      workspaces: ["packages/*"],
      dependencies: { dep: `tag-${C1}`, ws: "workspace:*" },
    }),
    "bunfig.toml": `[install]\nregistry = "${registryUrl}"\n`,
    [`packages/ws-${C1}/package.json`]: JSON.stringify({ name: "ws", version: "1.0.0" }),
  });
  const { stderr, exitCode } = await run(String(dir), "install", "--verbose");
  // --verbose also dumps the HTTP client's request trace, which is not package
  // manager output, so only the package manager's own lines are checked here.
  expect(stderr).toContain(`"dep": "tag-${C1_ESCAPED}"`);
  expect(stderr).toContain(`"ws": "packages/ws-${C1_ESCAPED}"`);
  // The trace prints the resolution with the platform's path separator.
  expect(stderr).toContain(`ws@workspace:packages${isWindows ? "\\" : "/"}ws-${C1_ESCAPED}`);
  expect(stderr).not.toContain(`tag-${C1}`);
  expect(stderr).not.toContain(`ws-${C1}`);
  expect(exitCode).toBe(0);
});

test.concurrent("the verbose retry warning escapes the resolution", async () => {
  // A 5xx is retried, and each retry is reported under --verbose before the final error.
  const spec = `${registryUrl}/failing/dep-${C1}.tgz`;
  const specEscaped = `${registryUrl}/failing/dep-${C1_ESCAPED}.tgz`;
  using dir = project("retry", { dependencies: { dep: spec } });
  const { stderr, exitCode } = await run(String(dir), "install", "--verbose");
  // --verbose also dumps the HTTP client's request trace, which is not package
  // manager output, so only the package manager's own lines are checked here.
  expect(stderr).toContain(`downloading tarball dep@${specEscaped}. Retrying 1/`);
  expect(stderr).toContain(`GET ${new URL(spec).href} - 500`);
  expect(stderr).not.toContain(`dep@${spec}`);
  expect(stderr).not.toContain(`${spec} - 500`);
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

type Message = {
  /** The files of the project, with `value` somewhere in them. */
  files: (value: string) => Record<string, string>;
  command: string[];
  /** Part of the message, with `value` as it is printed. */
  printed: (value: string) => string;
  exitCode: number;
  except?: string;
};

const app = { name: "app", version: "1.0.0" };

const messages: Record<string, Message> = {
  "a patch file that is not there": {
    files: value => ({
      "package.json": JSON.stringify({
        ...app,
        dependencies: { dep: "1.0.0" },
        patchedDependencies: { "dep@1.0.0": `patches/${value}.patch` },
      }),
    }),
    command: ["install"],
    printed: value => `error: patch file not found: 'patches/${value}.patch'\n`,
    exitCode: 1,
  },
  "a CA file that is not there": {
    files: value => ({
      "package.json": JSON.stringify({ ...app, dependencies: { dep: "1.0.0" } }),
      "bunfig.toml": `[install]\nregistry = "${registryUrl}"\ncafile = ${JSON.stringify(value)}\n`,
    }),
    command: ["install"],
    printed: value => `${value}'\n`,
    exitCode: 1,
  },
  "an entry of package-lock.json that nothing depends on": {
    files: value => ({
      "package.json": JSON.stringify(app),
      "package-lock.json": JSON.stringify({
        ...app,
        lockfileVersion: 3,
        packages: {
          "": app,
          [`node_modules/${value}`]: { version: "1.0.0", resolved: `${registryUrl}/a/-/a-1.0.0.tgz` },
        },
      }),
    }),
    command: ["pm", "migrate", "--verbose"],
    printed: value => `unused package-lock.json entry: "node_modules/${value}"\n`,
    exitCode: 0,
  },
  "a version in yarn.lock that is not one": {
    files: value => ({
      "package.json": JSON.stringify({ ...app, dependencies: { dep: "^1.0.0" } }),
      "yarn.lock": `# yarn lockfile v1\n\n\ndep@^1.0.0:\n  version "1.0.0_${value}"\n  resolved "${registryUrl}/dep.tgz#aa"\n`,
    }),
    command: ["pm", "migrate", "--verbose"],
    printed: value => `warn: skipping "dep@^1.0.0" from yarn.lock: invalid version "1.0.0_${value}"\n`,
    exitCode: 0,
  },
  "the version that `bun pm version` starts from": {
    files: value => ({ "package.json": JSON.stringify({ ...app, version: `1.0.0-${value}` }) }),
    command: ["pm", "version"],
    printed: value => `1.0.0-${value}`,
    exitCode: 1,
  },
  "a key that package.json has twice": {
    files: value => ({ "package.json": `{ "name": "app", ${JSON.stringify(value)}: 1, ${JSON.stringify(value)}: 2 }` }),
    command: ["install"],
    printed: value => `warn: Duplicate key "${value}" in object literal\n`,
    exitCode: 0,
  },
  "the line of package.json that does not parse": {
    files: value => ({ "package.json": `{ "name": "app", ${value} }` }),
    command: ["install"],
    printed: value => `1 | { "name": "app", ${value} }\n`,
    exitCode: 1,
    // It ends the line.
    except: "CR",
  },
  "a workspace that is not there": {
    files: value => ({ "package.json": JSON.stringify({ ...app, workspaces: [value] }) }),
    command: ["install"],
    printed: value => `error: Workspace not found "${value}"\n`,
    exitCode: 1,
    // With a `[` it is a pattern, and one that matches nothing is no error.
    except: "ESC [ 2 K",
  },
  "an override that is not a string": {
    files: value => ({ "package.json": JSON.stringify({ ...app, overrides: { [value]: 1 } }) }),
    command: ["install"],
    printed: value => `warn: Invalid override value for "${value}"\n`,
    exitCode: 0,
  },
};

const characters = [
  ["ESC [ 2 K", "\x1b[2K", "\\x1b[2K"],
  ["CR", "\r", "\\r"],
  ["BEL", "\x07", "\\x07"],
  ["U+009B", "\u009b2K", "\\u009b2K"],
  ["OSC 52", "\x1b]52;c;aGk=\x07", "\\x1b]52;c;aGk=\\x07"],
];

describe.concurrent.each(Object.entries(messages))(
  "%s",
  (_, { files, command, printed, exitCode: expected, except }) => {
    test.each(characters.filter(([name]) => name !== except))("%s", async (_, raw, spelled) => {
      using dir = tempDir("escape-controls-message", {
        "bunfig.toml": `[install]\nregistry = "${registryUrl}"\n`,
        ...files(`a${raw}b`),
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ...command);
      expect(stdout + stderr).toContain(printed(`a${spelled}b`));
      expect(stdout + stderr).not.toMatch(RAW_CONTROL);
      expect(exitCode).toBe(expected);
    });
  },
);

// Windows has no such file names.
test.concurrent.skipIf(isWindows).each(characters)("--verbose, a file of a package: %s", async (_, raw, spelled) => {
  using dir = tempDir("escape-controls-file-name", {
    "package.json": JSON.stringify({ ...app, dependencies: { dep: "./dep.tgz" } }),
  });
  await Bun.Archive.write(
    join(String(dir), "dep.tgz"),
    { "package/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }), [`package/a${raw}b.js`]: "" },
    { compress: "gzip" },
  );
  const { stdout, exitCode } = await run(String(dir), "install", "--verbose");
  expect(stdout).toContain(`\n a${spelled}b.js\n`);
  expect(stdout).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(0);
});

test.concurrent("the marker under a source line points at the right column", async () => {
  using dir = tempDir("escape-controls-mark", { "package.json": `{ "a${C1}b": 1, oops }` });
  const { stdout, stderr, exitCode } = await run(String(dir), "install");
  const before = `1 | { "a${C1_ESCAPED}b": 1, `;
  expect(stderr).toStartWith(`${before}oops }\n${Buffer.alloc(before.length, " ")}^\nerror: Expected string`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(1);
});

// It does nothing on a terminal.
test.concurrent("a NUL is kept in the source line, and is escaped in the message", async () => {
  using dir = tempDir("escape-controls-nul", { "package.json": `{ "name": "app", /*\0*/ a\0b }` });
  const { stderr, exitCode } = await run(String(dir), "install");
  const before = `1 | { "name": "app", /*\0*/ `;
  expect(stderr).toStartWith(
    `${before}a\0b }\n${Buffer.alloc(before.length, " ")}^\nerror: Expected string but found "a\\x00b"\n`,
  );
  expect(exitCode).toBe(1);
});

test.concurrent("an invalid name", async () => {
  using dir = tempDir("escape-controls-name", { "package.json": JSON.stringify({ ...app, name: `a${C1}b` }) });
  const { stdout, stderr, exitCode } = await run(String(dir), "link");
  expect(stderr).toContain(`error: invalid package name "a${C1_ESCAPED}b"\n`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(1);
});

test.concurrent("git's output about a repository that it can't read", async () => {
  using dir = project("git", {});
  const repository = `git+file://${join(String(dir), `missing-${C1}.git`).replaceAll("\\", "/")}`;
  await Bun.write(join(String(dir), "package.json"), JSON.stringify({ ...app, dependencies: { dep: repository } }));
  const { stdout, stderr, exitCode } = await run(String(dir), "install");
  expect(stderr).toContain(`missing-${C1_ESCAPED}.git' does not appear to be a git repository`);
  expect(stdout + stderr).not.toMatch(RAW_CONTROL);
  expect(exitCode).toBe(1);
});
