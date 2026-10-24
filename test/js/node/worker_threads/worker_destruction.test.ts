import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isASAN, isWindows } from "harness";
import { join } from "path";

describe("Worker destruction", () => {
  const method = ["Bun.connect", "Bun.listen", "fetch"];
  describe.each(method)("bun when %s is used in a Worker that is terminating", method => {
    test.concurrent("exits cleanly", async () => {
      expect(await bunRun([join(import.meta.dir, "worker_thread_check.ts"), method])).toSpawn();
    });
  });

  // The worker owns a child process whose stdin pipe has a large write in flight that can never
  // complete (the child never reads). Terminating the worker must close that pipe through its owner
  // rather than wait for the write; otherwise the worker thread never finishes and terminate() hangs.
  test.concurrent("terminate() a Worker with a child process and a pending stdin write", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("worker_threads");
        const w = new Worker(\`
          const { parentPort } = require("worker_threads");
          const p = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
          p.stdin.write(Buffer.alloc(4 << 20));
          p.stdin.flush();
          parentPort.postMessage(p.pid);
        \`, { eval: true });
        w.on("error", e => { console.error(e); process.exit(2); });
        w.on("message", async pid => {
          const code = await w.terminate();
          try { process.kill(pid); } catch {}
          console.log("terminated " + code);
          process.exit(0);
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("terminated 1");
    expect(exitCode).toBe(0);
  });

  // two private mimalloc heaps on one thread, then thread exit: mimalloc's teardown used to read a freed per-thread heap-slot array (debug builds abort with `threadlocal.c: "tls!=NULL"`)
  test.concurrent("a Worker that used several allocator heaps exits cleanly", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("worker_threads");
        const w = new Worker(\`
          Bun.TOML.parse("a = 1");
          new Bun.Transpiler().transformSync("export const b = 2;");
        \`, { eval: true });
        w.on("error", e => { console.error(e); process.exit(2); });
        w.on("exit", code => console.log("worker exit " + code));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("worker exit 0\n");
    expect(exitCode).toBe(0);
  });

  describe.skipIf(!isASAN || isWindows)("a Worker frees what its thread and its realms allocated", () => {
    test.concurrent.each([
      ["event names", `new AbortController().signal.addEventListener("abort", () => {});`],
      ["crypto.subtle with a pending promise", `crypto.subtle.digest("SHA-256", new Uint8Array(1)); process.exit();`],
      ["a ShadowRealm", `new ShadowRealm().evaluate("1");`],
      [
        "a spy that was not restored",
        `const key = "key" + Math.random(); require("bun:test").spyOn({ [key]() {} }, key);`,
      ],
      [
        "request trailers",
        `const server = require("http").createServer((req, res) => req.resume().on("end", () => res.end()));
         server.listen(0, "127.0.0.1", () => {
           require("net")
             .connect(server.address().port, "127.0.0.1")
             .end("POST / HTTP/1.1\\r\\nHost: a\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n0\\r\\nx: " + Buffer.alloc(100, "a") + "\\r\\n\\r\\n")
             .resume()
             .on("close", () => server.close());
         });`,
      ],
    ])("%s", async (_, code) => {
      // leaksan.supp hides what is allocated while a module is evaluated, so the code runs from an immediate.
      const worker = `setImmediate(() => { ${code} });`;
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}])))
             .addEventListener("close", ({ code }) => console.log("worker exit " + code));`,
        ],
        env: {
          ...bunEnv,
          // Makes WTF allocate with the system malloc, which LeakSanitizer tracks.
          Malloc: "1",
          BUN_DESTRUCT_VM_ON_EXIT: "1",
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
          LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "worker exit 0\n", stderr: "", exitCode: 0 });
    });
  });

  test.each(["terminate", "worker-exit"])("%s uses the final heap sweep without another tracing GC", async mode => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const { writeSync } = require("node:fs");
        (async () => {
          const worker = new Worker(\`
            const { parentPort } = require("node:worker_threads");
            parentPort.on("message", () => process.exit(0));
            Bun.gc(true);
            parentPort.postMessage("ready");
          \`, { eval: true });
          const exited = new Promise((resolve, reject) => {
            worker.once("exit", resolve);
            worker.once("error", reject);
          });
          await Promise.race([
            new Promise(resolve => worker.once("message", resolve)),
            exited.then(code => { throw new Error("early exit " + code); }),
          ]);
          writeSync(2, "\\nWORKER_TEARDOWN_BEGIN\\n");
          const code = ${JSON.stringify(mode)} === "terminate"
            ? await worker.terminate()
            : (worker.postMessage("exit"), await exited);
          writeSync(2, "\\nWORKER_TEARDOWN_END\\n");
          console.log(code);
        })().catch(error => { console.error(error); process.exitCode = 1; });
        `,
      ],
      env: { ...bunEnv, BUN_JSC_logGC: "1", BUN_JSC_useConcurrentGC: "false" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(mode === "terminate" ? "1" : "0");
    const parts = stderr.split("WORKER_TEARDOWN_BEGIN\n");
    expect(parts).toHaveLength(2);
    const teardown = parts[1].split("WORKER_TEARDOWN_END\n");
    expect(teardown).toHaveLength(2);
    const shutdowns = [...teardown[0].matchAll(/\[GC<([^>]+)>: shutdown: [^\]]*ms\]/g)];
    expect(shutdowns).toHaveLength(1);
    const collections = [...teardown[0].matchAll(/\[GC<([^>]+)>: START [^\n]*=> FullCollection/g)];
    expect(collections.filter(match => match[1] === shutdowns[0][1])).toHaveLength(0);
  });
});
