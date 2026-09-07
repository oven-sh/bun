import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls } from "harness";
import { mkfifo } from "mkfifo";
import path from "node:path";
import { createSecureContext } from "node:tls";

const certFiles = { "key.pem": tls.key, "cert.pem": tls.cert };

// Every path-valued TLS option is opened on the JS thread: `ca`/`cert`/`key`/
// `crl` by the option reader, and `keyFile`/`certFile`/`caFile`/
// `dhParamsFile` by BoringSSL when the socket context is built. `open(2)` on a
// FIFO with no writer never returns, so such a path used to stop the event
// loop with no error and no timer. Each door rejects it now.
//
// The door runs in a child process, so a door that still blocks leaves the
// test runner responsive: the test times out and the spawn deadline then
// kills the child.
describe.skipIf(isWindows)("a TLS option path that is a FIFO", () => {
  const DEADLINE_MS = 8_000;

  async function runDoor(door: string) {
    using dir = tempDir("tls-fifo", certFiles);
    const fifo = path.join(String(dir), "fifo.pem");
    mkfifo(fifo);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const F = ${JSON.stringify(fifo)};
         const K = ${JSON.stringify(path.join(String(dir), "key.pem"))};
         const C = ${JSON.stringify(path.join(String(dir), "cert.pem"))};
         const done = m => { console.log(m); process.exit(0); };
         try {
           const r = (${door})({ F, K, C });
           if (r && typeof r.then === "function") r.then(() => done("NO ERROR"), e => done(e.message));
           else done("NO ERROR");
         } catch (e) {
           done(e.message);
         }`,
      ],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: DEADLINE_MS,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // `ca`, `cert`, `key` and `crl` take a BunFile, which the option reader
  // reads with a synchronous readFile. The other options are valid, so the
  // FIFO is the only thing that can fail.
  const doors: Record<string, string> = {
    "Bun.serve tls.key": `({ F, C }) => Bun.serve({ port: 0, tls: { key: Bun.file(F), cert: Bun.file(C) }, fetch: () => new Response("ok") })`,
    "Bun.connect tls.ca": `({ F }) => Bun.connect({ hostname: "127.0.0.1", port: 1, tls: { ca: Bun.file(F) }, socket: { data() {}, open() {} } })`,
    "fetch tls.ca": `({ F }) => fetch("https://127.0.0.1:1/", { tls: { ca: Bun.file(F) } })`,
    "tls.createSecureContext ca": `({ F }) => require("node:tls").createSecureContext({ ca: Bun.file(F) })`,
    // `keyFile` and friends take a path string that BoringSSL opens itself.
    "Bun.serve tls.keyFile": `({ F, C }) => Bun.serve({ port: 0, tls: { keyFile: F, certFile: C }, fetch: () => new Response("ok") })`,
    "Bun.serve tls.caFile": `({ F, K, C }) => Bun.serve({ port: 0, tls: { caFile: F, keyFile: K, certFile: C }, fetch: () => new Response("ok") })`,
    "Bun.serve tls.dhParamsFile": `({ F, K, C }) => Bun.serve({ port: 0, tls: { dhParamsFile: F, keyFile: K, certFile: C }, fetch: () => new Response("ok") })`,
    "tls.createSecureContext keyFile": `({ F }) => require("node:tls").createSecureContext({ keyFile: F })`,
  };

  for (const [name, door] of Object.entries(doors)) {
    test.concurrent(`${name} throws instead of blocking the event loop`, async () => {
      const { stdout, exitCode } = await runDoor(door);
      expect(stdout).toContain("must be a regular file");
      expect(stdout).toContain("is a FIFO");
      expect(exitCode).toBe(0);
    });
  }

  test.concurrent("an array entry that is a FIFO names the option and the path", async () => {
    const { stdout, exitCode } = await runDoor(
      `({ F }) => require("node:tls").createSecureContext({ ca: [Bun.file(F)] })`,
    );
    expect(stdout).toContain("TLSOptions.ca must be a regular file");
    expect(stdout).toContain("fifo.pem");
    expect(exitCode).toBe(0);
  });
});

describe("a TLS option path of another kind", () => {
  test("keyFile that is a directory names the kind", () => {
    using dir = tempDir("tls-dir", { keep: "" });
    expect(() => createSecureContext({ keyFile: String(dir) } as object)).toThrow(
      /TLSOptions\.keyFile must be a regular file.*is a directory/,
    );
  });

  test("keyFile that does not exist keeps its message", () => {
    using dir = tempDir("tls-missing", {});
    expect(() => createSecureContext({ keyFile: path.join(String(dir), "nope.pem") } as object)).toThrow(
      "Unable to access keyFile path",
    );
  });
});

describe("a TLS option path that is a regular file still loads", () => {
  test("keyFile and certFile build a server", async () => {
    using dir = tempDir("tls-files", certFiles);
    await using server = Bun.serve({
      port: 0,
      tls: {
        keyFile: path.join(String(dir), "key.pem"),
        certFile: path.join(String(dir), "cert.pem"),
      },
      fetch: () => new Response("ok"),
    });
    const res = await fetch(server.url, { tls: { rejectUnauthorized: false } });
    expect(await res.text()).toBe("ok");
  });

  test("key and cert as a BunFile build a server", async () => {
    using dir = tempDir("tls-blobs", certFiles);
    await using server = Bun.serve({
      port: 0,
      tls: {
        key: Bun.file(path.join(String(dir), "key.pem")),
        cert: Bun.file(path.join(String(dir), "cert.pem")),
      },
      fetch: () => new Response("ok"),
    });
    const res = await fetch(server.url, { tls: { rejectUnauthorized: false } });
    expect(await res.text()).toBe("ok");
  });
});
