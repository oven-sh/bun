// At RLIMIT_NOFILE, bun used to mis-attribute the failing socket()/open() as
// ECONNREFUSED / MODULE_NOT_FOUND / code-less "Failed to listen". These must
// surface the real errno so callers branching on `err.code` (connection pools,
// optional-dependency fallbacks, supervisors) don't take the wrong branch.
//
// No fault injection: a child exhausts its own fd table with real
// fs.openSync("/dev/null") under a lowered soft limit.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";

const fixture = `
import fs from "node:fs";
import net from "node:net";
import util from "node:util";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const mod = process.argv[2];

// Warm every lazily-loaded module before exhausting fds.
const srv = net.createServer(() => {});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
await new Promise(r => {
  const s = net.connect(srv.address().port, "127.0.0.1");
  s.once("connect", () => { s.destroy(); r(); }).once("error", r);
});
await new Promise(r => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => s.close(r)); });
void util.inspect(new Error("warmup"));

const held = [];
for (;;) { try { held.push(fs.openSync("/dev/null", "r")); } catch { break; } }

const probe = async () => {
  const out = {};
  out.connect = await new Promise(r => {
    const s = net.connect(srv.address().port, "127.0.0.1");
    s.once("connect", () => { s.destroy(); r(null); }).once("error", e => r({ code: e.code, syscall: e.syscall }));
  });
  try { req(mod + ".cjs"); out.require = null; } catch (e) { out.require = { code: e.code, syscall: e.syscall, path: e.path }; }
  try { await import(mod + ".mjs"); out.import = null; } catch (e) { out.import = { code: e.code, syscall: e.syscall, path: e.path }; }
  out.listen = await new Promise(r => {
    const s = net.createServer();
    s.once("error", e => r({ code: e.code, syscall: e.syscall }));
    s.listen(0, "127.0.0.1", () => s.close(() => r(null)));
  });
  return out;
};

const exhausted = await probe();
for (const fd of held) fs.closeSync(fd);
const recovered = await probe();
srv.close();

process.stdout.write(JSON.stringify({ exhausted, recovered }));
`;

describe.skipIf(!isPosix)("EMFILE is reported as EMFILE", () => {
  test.concurrent("net.connect, require, import, net.listen under fd exhaustion", async () => {
    using dir = tempDir("emfile-error-code", {
      "probe.mjs": fixture,
      "mod/m.cjs": "module.exports = 42;",
      "mod/m.mjs": "export const v = 42;",
    });
    // Bun raises RLIMIT_NOFILE on startup; `ulimit -n` lowers both soft and
    // hard in dash/bash so the raise cannot exceed it. 512 leaves room for
    // the runtime's own fds (including debug builds loading JS from disk).
    await using proc = Bun.spawn({
      cmd: [
        "/bin/sh",
        "-c",
        `ulimit -n 512 && exec "$1" "$2" "$3"`,
        "sh",
        bunExe(),
        "probe.mjs",
        String(dir) + "/mod/m",
      ],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (!stdout.startsWith("{")) {
      throw new Error("no JSON on stdout; stderr:\n" + stderr);
    }
    const parsed = JSON.parse(stdout);

    expect(parsed.exhausted).toEqual({
      connect: { code: "EMFILE", syscall: "connect" },
      require: { code: "EMFILE", syscall: "open", path: String(dir) + "/mod/m.cjs" },
      import: { code: "EMFILE", syscall: "open", path: String(dir) + "/mod/m.mjs" },
      listen: { code: "EMFILE", syscall: "listen" },
    });
    // Freeing the fds must fully recover; nothing was cached as a permanent failure.
    expect(parsed.recovered).toEqual({
      connect: null,
      require: null,
      import: null,
      listen: null,
    });

    expect(exitCode).toBe(0);
  });
});
