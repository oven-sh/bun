// A Worker given `env` (or started after the parent touched process.env) owns
// that environment natively: fetch()'s proxy and TLS defaults, and the env a
// child process inherits, come from the worker's environment rather than the
// main thread's.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import { join } from "node:path";

// CI containers can carry ambient proxy variables; each case spawns a process
// whose environment has none so only the values under test apply.
const cleanEnv: Record<string, string | undefined> = { ...bunEnv };
for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"]) {
  delete cleanEnv[key];
}

async function run(cmd: string[], cwd?: string) {
  await using proc = Bun.spawn({ cmd, env: cleanEnv, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: exitCode === 0 ? "" : stderr, exitCode };
}

describe.concurrent("worker env", () => {
  describe.each(["node", "web"])("%s Worker", kind => {
    test("fetch() resolves HTTP_PROXY / NO_PROXY from the worker's own environment", async () => {
      const { stdout, stderr, exitCode } = await run([
        bunExe(),
        join(import.meta.dirname, "worker-env-proxy-fixture.mjs"),
        kind,
      ]);
      expect({ result: stdout ? JSON.parse(stdout) : stdout, stderr, exitCode }).toEqual({
        result: {
          workerEnvProxy: "VIA-PROXY",
          workerEnvNoProxy: "DIRECT",
          workerRuntimeProxy: "VIA-PROXY",
          mainProxyWorkerEnvEmpty: "DIRECT",
          mainProxyWorkerNoProxy: "DIRECT",
        },
        stderr: "",
        exitCode: 0,
      });
    });
  });

  test("a child process spawned from the worker inherits the worker's environment", async () => {
    const { stdout, stderr, exitCode } = await run([
      bunExe(),
      "-e",
      `const { Worker } = require("node:worker_threads");
       const env = { ...process.env, FROM_WORKER_OPTION: "worker" };
       process.env.SET_IN_PARENT = "parent";
       const w = new Worker(
         \`const { parentPort } = require("node:worker_threads");
          // No env option: Bun.spawnSync passes the spawning thread's environment.
          const { stdout } = Bun.spawnSync({
            cmd: [process.execPath, "-e", "console.log(JSON.stringify([process.env.FROM_WORKER_OPTION, process.env.SET_IN_PARENT]))"],
          });
          parentPort.postMessage({
            child: JSON.parse(stdout.toString()),
            worker: [process.env.FROM_WORKER_OPTION, process.env.SET_IN_PARENT],
          });\`,
         { eval: true, env },
       );
       w.once("message", msg => console.log(JSON.stringify(msg)));`,
    ]);
    expect({ result: stdout ? JSON.parse(stdout) : stdout, stderr, exitCode }).toEqual({
      result: { child: ["worker", null], worker: ["worker", null] },
      stderr: "",
      exitCode: 0,
    });
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
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: { ...cleanEnv, SET_AT_LAUNCH: "launch" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ result: stdout ? JSON.parse(stdout) : stdout, stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      result: { keys: ["ONLY_IN_OUTER"], only: "outer" },
      stderr: "",
      exitCode: 0,
    });
  });

  test("NODE_TLS_REJECT_UNAUTHORIZED in the worker's env applies to the worker's fetch()", async () => {
    using dir = tempDir("worker-env-tls", {
      "cert.pem": tls.cert,
      "key.pem": tls.key,
      "main.mjs": `
        import { Worker } from "node:worker_threads";
        import { readFileSync } from "node:fs";
        const server = Bun.serve({
          port: 0,
          tls: { cert: readFileSync("cert.pem", "utf8"), key: readFileSync("key.pem", "utf8") },
          fetch: () => new Response("ok"),
        });
        const url = "https://localhost:" + server.port + "/";
        const run = env =>
          new Promise((resolve, reject) => {
            const w = new Worker(new URL("./worker.mjs", import.meta.url), { env, workerData: url });
            w.once("message", resolve);
            w.once("error", reject);
          });
        const results = {
          rejecting: await run({}),
          accepting: await run({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }),
        };
        console.log(JSON.stringify(results));
        server.stop(true);
        process.exit(0);
      `,
      "worker.mjs": `
        import { parentPort, workerData } from "node:worker_threads";
        parentPort.postMessage(await fetch(workerData).then(res => res.text(), err => err.code));
      `,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "main.mjs"], String(dir));
    expect({ result: stdout ? JSON.parse(stdout) : stdout, stderr, exitCode }).toEqual({
      result: { rejecting: "DEPTH_ZERO_SELF_SIGNED_CERT", accepting: "ok" },
      stderr: "",
      exitCode: 0,
    });
  });
});
