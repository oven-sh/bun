import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isASAN, isWindows, tempDir } from "harness";
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
});

describe.concurrent.skipIf(!isWindows)("Worker exit closes the handles of open resources", () => {
  const prelude = `
    const fs = require("fs");
    const net = require("net");
    const { once } = require("events");
    const { parentPort, workerData } = require("worker_threads");
    const pipeName = suffix => "\\\\\\\\.\\\\pipe\\\\" + workerData + suffix;
    const idleCmd = [process.execPath, "-e", "setTimeout(() => {}, 30_000)"];
    const childPids = [];
    const strongRefs = [];
    const payload = Buffer.alloc(4 << 20);
    const spawn = (cmd, options) => {
      const child = Bun.spawn(cmd, options);
      childPids.push(child.pid);
      strongRefs.push(child);
      return child;
    };
    async function connectPair(address) {
      const server = net.createServer({ pauseOnConnect: true });
      await once(server.listen(address), "listening");
      const client = net.connect(server.address()).on("error", () => {});
      const [[accepted]] = await Promise.all([once(server, "connection"), once(client, "connect")]);
      strongRefs.push(server);
      return [client, accepted.on("error", () => {})];
    }
    const tcpAddress = { port: 0, host: "127.0.0.1" };
  `;
  const resources: [string, string][] = [
    [
      "timers",
      `setInterval(() => {}, 1); setTimeout(() => {}, 1e6); setImmediate(function reschedule() { setImmediate(reschedule); })`,
    ],
    ["listening TCP socket", `await once(net.createServer().listen(tcpAddress), "listening")`],
    ["reading TCP socket", `(await connectPair(tcpAddress)).forEach(socket => socket.resume())`],
    [
      "TCP socket with a pending write",
      `const [client] = await connectPair(tcpAddress); client.write(payload); client.write(payload); client.write(payload)`,
    ],
    ["TCP socket after peer FIN", `const [client] = await connectPair(tcpAddress); client.end("bye")`],
    [
      "connecting TCP socket",
      `const server = net.createServer(); await once(server.listen(tcpAddress), "listening"); net.connect(server.address())`,
    ],
    ["UDP socket", `strongRefs.push(await Bun.udpSocket({ hostname: "127.0.0.1", socket: { data() {} } }))`],
    [
      "in-flight fetch()",
      `const requestReceived = Promise.withResolvers(); const server = Bun.serve({ port: 0, fetch: () => { requestReceived.resolve(); return new Promise(() => {}); } }); fetch(server.url).catch(() => {}); await requestReceived.promise`,
    ],
    ["listening named pipe", `await once(net.createServer().listen(pipeName("a")), "listening")`],
    ["reading named pipe", `(await connectPair(pipeName("b"))).forEach(socket => socket.resume())`],
    ["named pipe with a pending write", `(await connectPair(pipeName("c")))[0].write(payload)`],
    [
      "connecting named pipes",
      `await once(net.createServer().listen(pipeName("d")), "listening"); for (let i = 0; i < 24; i++) net.connect(pipeName("d")).on("error", () => {})`,
    ],
    ["subprocess", `spawn(idleCmd, { stdio: ["ignore", "ignore", "ignore"] })`],
    [
      "subprocess with pending stdout and stderr reads",
      `const child = spawn(idleCmd, { stdio: ["ignore", "pipe", "pipe"] }); child.stdout.text(); child.stderr.text()`,
    ],
    [
      "subprocess with a pending stdin write",
      `const child = spawn(idleCmd, { stdio: ["pipe", "ignore", "ignore"] }); child.stdin.write(payload); child.stdin.flush()`,
    ],
    ["subprocess with Buffer stdin", `spawn(idleCmd, { stdio: [payload, "ignore", "ignore"] })`],
    [
      "subprocess with an IPC channel",
      `spawn(idleCmd, { stdio: ["ignore", "ignore", "ignore"], ipc() {} }).send(payload.toString())`,
    ],
    [
      "subprocess with an extra stdio pipe",
      `const child = require("child_process").spawn(idleCmd[0], idleCmd.slice(1), { stdio: ["ignore", "ignore", "ignore", "pipe"] }); childPids.push(child.pid); child.stdio[3].resume().write(payload)`,
    ],
    ["subprocess in a terminal", `spawn(idleCmd, { terminal: { data() {} } })`],
    ["killed subprocess", `spawn(idleCmd, { stdio: ["pipe", "pipe", "pipe"] }).kill()`],
    ["spawnSync event loop", `Bun.spawnSync([process.execPath, "-e", "0"], { timeout: 30_000 })`],
    [
      "fs.watch watchers",
      `fs.watch(".", () => {}); fs.watch("main.js", () => {}); fs.watch(".", { recursive: true }, () => {})`,
    ],
    ["fs.watch with a pending event", `fs.watch(".", () => {}); fs.writeFileSync("touched", "x")`],
    [
      "in-flight file operations",
      `fs.writeFileSync("payload", payload); for (let i = 0; i < 20; i++) { fs.promises.readFile("payload"); Bun.file("payload").bytes(); Bun.write("copy" + i, payload); }`,
    ],
    [
      "file streams",
      `fs.writeFileSync("payload", payload); strongRefs.push(Bun.file("payload").stream().getReader().read(), fs.createReadStream("payload").resume()); const sink = Bun.file("sink").writer(); sink.write(payload); sink.flush()`,
    ],
    ["pending stdin read", `Bun.stdin.stream().getReader().read()`],
    [
      "nested Worker",
      `const nested = new (require("worker_threads").Worker)("setInterval(() => {}, 1)", { eval: true }); await once(nested, "online")`,
    ],
  ];

  describe.each([
    ["terminate()", "", 1],
    ["process.exit()", "process.exit(7)", 7],
    ["an uncaught exception", "throw new Error('expected')", 1],
  ])("after %s", (_, exitScript, expectedExitCode) => {
    test.each(resources)("%s", async (_, openScript) => {
      const rounds = 4;
      using dir = tempDir("worker-handles", {
        "worker.js": `
          ${prelude}
          (async () => {
            ${openScript};
            parentPort.postMessage(childPids);
            setImmediate(() => { ${exitScript} });
            parentPort.on("message", () => {});
          })();
        `,
        "main.js": `
          const { Worker } = require("worker_threads");
          const { once } = require("events");
          const k32 = require("bun:ffi").dlopen("kernel32.dll", {
            GetCurrentProcess: { args: [], returns: "ptr" },
            GetProcessHandleCount: { args: ["ptr", "ptr"], returns: "i32" },
          }).symbols;
          const getHandleCount = () => {
            const count = new Uint32Array(1);
            k32.GetProcessHandleCount(k32.GetCurrentProcess(), count);
            return count[0];
          };
          (async () => {
            // Start the pool threads first, because they hold handles too.
            const { readFile } = require("fs/promises");
            await Promise.all(Array.from({ length: 64 }, () => [readFile("main.js"), Bun.file("main.js").bytes()]).flat());
            const exitCodes = [];
            const handleCounts = [];
            for (let i = 0; i < ${rounds}; i++) {
              // Every round reuses the pipe names, so the previous round must have released them.
              const worker = new Worker("./worker.js", { workerData: "bun-test-" + process.pid });
              worker.on("error", error => error.message === "expected" || console.error(error));
              const exited = new Promise(resolve => worker.once("exit", resolve));
              const [childPids] = await once(worker, "message");
              if (${!exitScript}) worker.terminate();
              exitCodes.push(await exited);
              for (const pid of childPids) try { process.kill(pid, "SIGKILL"); } catch {}
              handleCounts.push(getHandleCount());
            }
            // Handles in use by a pool thread are closed when its task finishes.
            for (const deadline = Date.now() + 2000; getHandleCount() - handleCounts[1] >= 6 && Date.now() < deadline; ) await Bun.sleep(5);
            console.log(JSON.stringify({ exitCodes, handleGrowth: getHandleCount() - handleCounts[1] }));
          })();
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js"],
        cwd: String(dir),
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const { exitCodes, handleGrowth } = JSON.parse(stdout);
      expect(exitCodes).toEqual(Array(rounds).fill(expectedExitCode));
      // System thread pool threads start and exit on their own, which shifts the count by a few handles.
      expect(handleGrowth).toBeLessThan(6);
    });
  });
});
