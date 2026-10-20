// A Worker given `env` (or started after the parent touched process.env) owns
// that environment natively: fetch()'s proxy and TLS defaults, and the env a
// child process inherits, come from the worker's environment rather than the
// main thread's.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { Worker as NodeWorker } from "node:worker_threads";

// CI containers can carry ambient proxy variables or the TLS switch; each case spawns a
// process whose environment has none so only the values under test apply.
const cleanEnv: Record<string, string | undefined> = { ...bunEnv };
delete cleanEnv.NODE_TLS_REJECT_UNAUTHORIZED;
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"]) {
  delete cleanEnv[key];
  delete cleanEnv[key.toLowerCase()];
}

// Runs a script that prints one JSON value.
async function run(cmd: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  await using proc = Bun.spawn({
    cmd,
    env: { ...cleanEnv, ...options.env },
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { result: stdout.trim() ? JSON.parse(stdout) : stdout, stderr: exitCode === 0 ? "" : stderr, exitCode };
}

// Runs `main`, which calls `probe(workerOptions, names)`. The worker that starts reports the named
// variables as its own process.env has them, and as a child process gets them from Bun.spawnSync
// with no `env` option.
async function runSpawnProbe(main: string, env?: Record<string, string>) {
  using dir = tempDir("worker-env-spawn", {
    "main.mjs": `
      function probe(options, names) {
        const worker = new Worker(new URL("./worker.mjs", import.meta.url).href, options);
        worker.onmessage = e => {
          console.log(JSON.stringify(e.data));
          worker.terminate();
        };
        worker.onerror = e => { console.error(e.message); process.exit(1); };
        worker.postMessage(names);
      }
      ${main}
    `,
    // The child prints its environment: "env" on POSIX (a debug bun is slow to start), bun on Windows.
    "worker.mjs": `
      const win32 = process.platform === "win32";
      self.onmessage = ({ data: names }) => {
        const child = Bun.spawnSync({
          cmd: win32 ? [process.execPath, "-e", "console.log(JSON.stringify(process.env))"] : ["/usr/bin/env"],
        });
        const out = child.stdout.toString();
        const childEnv = win32
          ? JSON.parse(out)
          : Object.fromEntries(out.split("\\n").map(line => line.split(/=(.*)/s)).map(([name, value]) => [name, value ?? ""]));
        postMessage({
          worker: names.map(name => process.env[name] ?? null),
          child: names.map(name => childEnv[name] ?? null),
        });
      };
    `,
  });
  return await run([bunExe(), "main.mjs"], { cwd: String(dir), env });
}

// Not concurrent: each test starts a bun process with workers, and a debug build that runs them
// all at once takes most of the default timeout for each.
describe("worker env", () => {
  test("fetch() resolves HTTP_PROXY / NO_PROXY from the worker's own environment", async () => {
    expect(await run([bunExe(), join(import.meta.dirname, "worker-env-proxy-fixture.mjs")])).toEqual({
      result: {
        workerEnvProxy: ["VIA-PROXY", "DIRECT"],
        mainProxyWorkerEnvEmpty: ["DIRECT", "VIA-PROXY"],
        mainProxyWorkerNoProxy: ["DIRECT"],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // In this process: the worker's env is all that decides, whatever the test runner's own env holds.
  test("fetch() in a node:worker_threads Worker uses the proxy from the worker's env", async () => {
    // Any request that reaches this server was sent to the proxy (absolute-form).
    await using proxy = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("VIA-PROXY") });
    await using origin = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("DIRECT") });
    const worker = new NodeWorker(
      `const { parentPort, workerData: url } = require("node:worker_threads");
       (async () => {
         const first = await (await fetch(url)).text();
         process.env.NO_PROXY = "127.0.0.1";
         parentPort.postMessage([first, await (await fetch(url)).text()]);
       })();`,
      {
        eval: true,
        env: { HTTP_PROXY: `http://127.0.0.1:${proxy.port}` },
        workerData: `http://127.0.0.1:${origin.port}/`,
      },
    );
    try {
      const { promise, resolve, reject } = Promise.withResolvers<string[]>();
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", code => reject(new Error(`the worker exited with code ${code} before it replied`)));
      expect(await promise).toEqual(["VIA-PROXY", "DIRECT"]);
    } finally {
      await worker.terminate();
    }
  });

  test("a child process spawned from the worker inherits the worker's environment", async () => {
    const probed = await runSpawnProbe(`
      const env = { ...process.env, FROM_WORKER_OPTION: "worker" };
      process.env.SET_IN_PARENT = "parent";
      probe({ env }, ["FROM_WORKER_OPTION", "SET_IN_PARENT"]);
    `);
    expect(probed).toEqual({
      result: { worker: ["worker", null], child: ["worker", null] },
      stderr: "",
      exitCode: 0,
    });
  });

  test("a SHARE_ENV worker's child process gets the shared environment as it was when the worker started", async () => {
    const probed = await runSpawnProbe(
      `
      import { SHARE_ENV } from "node:worker_threads";
      delete process.env.SET_AT_LAUNCH;
      process.env.SET_AT_RUNTIME = "runtime";
      probe({ env: SHARE_ENV }, ["SET_AT_LAUNCH", "SET_AT_RUNTIME"]);
    `,
      { SET_AT_LAUNCH: "launch" },
    );
    expect(probed).toEqual({
      result: { worker: [null, "runtime"], child: [null, "runtime"] },
      stderr: "",
      exitCode: 0,
    });
  });

  // A NUL byte cannot be part of an environment entry. Passed on to a child it would cut the value
  // short (or, on Windows, start a new entry), so Bun.spawn rejects one in an explicit `env`.
  test("an env entry with a NUL byte is left out of the worker's environment", async () => {
    const probed = await runSpawnProbe(`
      const env = { ...process.env, NUL_IN_VALUE: "kept\\0cut", "NUL\\0IN_NAME": "value" };
      probe({ env }, ["NUL_IN_VALUE", "NUL", "NUL\\0IN_NAME"]);
    `);
    expect(probed).toEqual({
      result: { worker: [null, null, null], child: [null, null, null] },
      stderr: "",
      exitCode: 0,
    });
  });

  // On every platform the worker's process.env is the main thread's kind of object: a write is
  // coerced to a string, a symbol key throws, and an accessor descriptor is rejected.
  test("process.env in a worker with env keeps the env setter semantics", async () => {
    const source = `
      const seen = { seeded: process.env.SEEDED };
      process.env.NUMBER = 42;
      seen.coerced = process.env.NUMBER;
      try { process.env[Symbol()] = "v"; seen.symbolKey = "no throw"; } catch (e) { seen.symbolKey = e.name; }
      try { Object.defineProperty(process.env, "G", { get() {} }); seen.accessor = "no throw"; } catch (e) { seen.accessor = e.code; }
      postMessage(seen);
    `;
    const worker = new Worker(URL.createObjectURL(new Blob([source])), { env: { SEEDED: "yes" } });
    try {
      const { promise, resolve, reject } = Promise.withResolvers();
      worker.onmessage = e => resolve(e.data);
      worker.onerror = e => reject(e.error ?? new Error(e.message));
      worker.addEventListener("close", () => reject(new Error("the worker closed before it replied")));
      expect(await promise).toEqual({
        seeded: "yes",
        coerced: "42",
        symbolKey: "TypeError",
        accessor: "ERR_INVALID_OBJECT_DEFINE_PROPERTY",
      });
    } finally {
      worker.terminate();
    }
  });

  // The resolver's directory cache is shared by every thread, so symlink handling is one setting
  // for the process. A worker's env does not change it.
  test.skipIf(isWindows)("NODE_PRESERVE_SYMLINKS stays the process's setting in a worker with env", async () => {
    using dir = tempDir("worker-env-symlinks", {
      real: { "mod.cjs": `module.exports = __filename;` },
      "main.mjs": `
        const keepsLinkPath = (env, link) =>
          new Promise((resolve, reject) => {
            const worker = new Worker(new URL("./worker.cjs", import.meta.url).href, { env });
            worker.onmessage = e => {
              resolve(e.data);
              worker.terminate();
            };
            worker.onerror = e => reject(e.error ?? new Error(e.message));
            worker.addEventListener("close", () => reject(new Error("the worker closed before it replied")));
            worker.postMessage(link);
          });
        console.log(JSON.stringify({
          without: await keepsLinkPath({}, "link-a"),
          off: await keepsLinkPath({ NODE_PRESERVE_SYMLINKS: "0" }, "link-b"),
        }));
      `,
      // With symlinks preserved, a module keeps the path that it was required through.
      "worker.cjs": `
        const { join, sep } = require("node:path");
        self.onmessage = ({ data: link }) =>
          postMessage(require(join(__dirname, link, "mod.cjs")).endsWith(join(sep + link, "mod.cjs")));
      `,
    });
    // One link per worker: each one fills the cache entry for its own path.
    for (const link of ["link-a", "link-b"]) symlinkSync(join(String(dir), "real"), join(String(dir), link), "dir");
    const launched = await run([bunExe(), "main.mjs"], { cwd: String(dir), env: { NODE_PRESERVE_SYMLINKS: "1" } });
    expect(launched).toEqual({ result: { without: true, off: true }, stderr: "", exitCode: 0 });
  });

  test("a nested worker started without env from a worker with env inherits exactly that env", async () => {
    using dir = tempDir("worker-env-nested", {
      "main.mjs": `
        const outer = new Worker(new URL("./outer.mjs", import.meta.url).href, {
          env: { ONLY_IN_OUTER: "outer" },
        });
        outer.onmessage = e => {
          console.log(JSON.stringify(e.data));
          outer.terminate();
        };
        outer.onerror = e => { console.error(e.message); process.exit(1); };
      `,
      // Starts the inner worker before anything reads process.env here.
      "outer.mjs": `
        const inner = new Worker(new URL("./inner.mjs", import.meta.url).href, { type: "module" });
        inner.onmessage = e => postMessage(e.data);
        inner.onerror = e => { throw e.error ?? new Error(e.message); };
      `,
      "inner.mjs": `
        postMessage({
          keys: Object.keys(process.env).filter(k => k === "ONLY_IN_OUTER" || k === "SET_AT_LAUNCH"),
          only: process.env.ONLY_IN_OUTER,
        });
      `,
    });
    const nested = await run([bunExe(), "main.mjs"], { cwd: String(dir), env: { SET_AT_LAUNCH: "launch" } });
    expect(nested).toEqual({
      result: { keys: ["ONLY_IN_OUTER"], only: "outer" },
      stderr: "",
      exitCode: 0,
    });
  });

  // The worker's env decides, whether or not the process was launched with verification off.
  test.each([
    ["by default", {}],
    ["with NODE_TLS_REJECT_UNAUTHORIZED=0", { NODE_TLS_REJECT_UNAUTHORIZED: "0" }],
  ])(
    "the worker's env alone turns TLS verification off for its fetch() (process launched %s)",
    async (_, launchEnv) => {
      using dir = tempDir("worker-env-tls", {
        "main.mjs": `
        const server = Bun.serve({
          port: 0,
          tls: ${JSON.stringify({ cert: tls.cert, key: tls.key })},
          fetch: () => new Response("ok"),
        });
        const url = "https://localhost:" + server.port + "/";
        const fetchIn = env =>
          new Promise((resolve, reject) => {
            const worker = new Worker(new URL("./worker.mjs", import.meta.url).href, { env });
            worker.onmessage = e => {
              resolve(e.data);
              worker.terminate();
            };
            worker.onerror = e => reject(e.error ?? new Error(e.message));
            worker.addEventListener("close", () => reject(new Error("the worker closed before it replied")));
            worker.postMessage(url);
          });
        const [without, disabled] = await Promise.all([fetchIn({}), fetchIn({ NODE_TLS_REJECT_UNAUTHORIZED: "0" })]);
        console.log(JSON.stringify({ without, disabled }));
        server.stop(true);
        process.exit(0);
      `,
        "worker.mjs": `
        self.onmessage = async e => postMessage(await fetch(e.data).then(res => res.text(), err => err.code));
      `,
      });
      expect(await run([bunExe(), "main.mjs"], { cwd: String(dir), env: launchEnv })).toEqual({
        result: { without: "DEPTH_ZERO_SELF_SIGNED_CERT", disabled: "ok" },
        stderr: "",
        exitCode: 0,
      });
    },
  );
});
