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

describe.concurrent.skipIf(!isWindows)("a Worker that ends with something open gives its handles back", () => {
  const prelude = `
    const fs = require("fs"), net = require("net"), { once } = require("events");
    const { parentPort, workerData } = require("worker_threads");
    const local = name => "\\\\\\\\.\\\\pipe\\\\" + workerData + name;
    const idle = [process.execPath, "-e", "setTimeout(() => {}, 30_000)"];
    const children = [], keep = [], big = Buffer.alloc(4 << 20);
    const spawn = (cmd, options) => { const child = Bun.spawn(cmd, options); children.push(child.pid); return keep.push(child), child; };
    async function pair(address) {
      const server = net.createServer({ pauseOnConnect: true });
      await once(server.listen(address), "listening");
      const client = net.connect(server.address()).on("error", () => {});
      const [[accepted]] = await Promise.all([once(server, "connection"), once(client, "connect")]);
      return keep.push(server), [client, accepted.on("error", () => {})];
    }
    const tcp = { port: 0, host: "127.0.0.1" };
  `;
  const kinds: [string, string][] = [
    [
      "timers",
      `setInterval(() => {}, 1), setTimeout(() => {}, 1e6), setImmediate(function again() { setImmediate(again); })`,
    ],
    ["a listening socket", `await once(net.createServer().listen(tcp), "listening")`],
    ["a socket that reads", `(await pair(tcp)).forEach(socket => socket.resume())`],
    [
      "a socket whose write waits",
      `const [client] = await pair(tcp); client.write(big), client.write(big), client.write(big)`,
    ],
    ["a socket whose peer has ended", `const [client] = await pair(tcp); client.end("bye")`],
    [
      "a socket that is connecting",
      `const server = net.createServer(); await once(server.listen(tcp), "listening"); net.connect(server.address())`,
    ],
    ["a UDP socket", `keep.push(await Bun.udpSocket({ hostname: "127.0.0.1", socket: { data() {} } }))`],
    [
      "a request in flight",
      `const seen = Promise.withResolvers(); const server = Bun.serve({ port: 0, fetch: () => (seen.resolve(), new Promise(() => {})) }); fetch(server.url).catch(() => {}); await seen.promise`,
    ],
    ["a named pipe that listens", `await once(net.createServer().listen(local("a")), "listening")`],
    ["a named pipe that reads", `(await pair(local("b"))).forEach(socket => socket.resume())`],
    ["a named pipe whose write waits", `(await pair(local("c")))[0].write(big)`],
    [
      "named pipes that are connecting",
      `await once(net.createServer().listen(local("d")), "listening"); for (let i = 0; i < 12; i++) net.connect(local("d")).on("error", () => {})`,
    ],
    ["a child", `spawn(idle, { stdio: ["ignore", "ignore", "ignore"] })`],
    [
      "a child whose output is read",
      `const child = spawn(idle, { stdio: ["ignore", "pipe", "pipe"] }); child.stdout.text(), child.stderr.text()`,
    ],
    [
      "a child whose input waits",
      `const child = spawn(idle, { stdio: ["pipe", "ignore", "ignore"] }); child.stdin.write(big), child.stdin.flush()`,
    ],
    ["a child that is given a buffer", `spawn(idle, { stdio: [big, "ignore", "ignore"] })`],
    ["a child with a channel", `spawn(idle, { stdio: ["ignore", "ignore", "ignore"], ipc() {} }).send(big.toString())`],
    [
      "a child with a pipe at fd 3",
      `const child = require("child_process").spawn(idle[0], idle.slice(1), { stdio: ["ignore", "ignore", "ignore", "pipe"] }); children.push(child.pid); child.stdio[3].resume().write(big)`,
    ],
    ["a child in a terminal", `spawn(idle, { terminal: { data() {} } })`],
    ["a child that has just been killed", `spawn(idle, { stdio: ["pipe", "pipe", "pipe"] }).kill()`],
    ["the loop of spawnSync", `Bun.spawnSync([process.execPath, "-e", "0"], { timeout: 30_000 })`],
    [
      "a watcher",
      `fs.watch(".", () => {}), fs.watch("main.js", () => {}), fs.watch(".", { recursive: true }, () => {})`,
    ],
    ["a watcher with an event on its way", `fs.watch(".", () => {}); fs.writeFileSync("touched", "x")`],
    [
      "file calls in flight",
      `fs.writeFileSync("big", big); for (let i = 0; i < 20; i++) fs.promises.readFile("big"), Bun.file("big").bytes(), Bun.write("copy" + i, big)`,
    ],
    [
      "file streams",
      `fs.writeFileSync("big", big); keep.push(Bun.file("big").stream().getReader().read(), fs.createReadStream("big").resume()); const sink = Bun.file("sink").writer(); sink.write(big), sink.flush()`,
    ],
    ["a read of stdin", `Bun.stdin.stream().getReader().read()`],
    [
      "another Worker",
      `const inner = new (require("worker_threads").Worker)("setInterval(() => {}, 1)", { eval: true }); await once(inner, "online")`,
    ],
  ];

  describe.each([
    ["terminate()", "", 1],
    ["process.exit()", "process.exit(7)", 7],
    ["an uncaught error", "throw new Error('expected')", 1],
  ])("by %s", (_, leave, code) => {
    test.each(kinds)("%s", async (_, open) => {
      const rounds = 4;
      using dir = tempDir("worker-open", {
        "worker.js": `
          ${prelude}
          (async () => {
            ${open};
            parentPort.postMessage(children);
            setImmediate(() => { ${leave} });
            parentPort.on("message", () => {});
          })();
        `,
        "main.js": `
          const { Worker } = require("worker_threads"), { once } = require("events");
          const k32 = require("bun:ffi").dlopen("kernel32.dll", {
            GetCurrentProcess: { args: [], returns: "ptr" },
            GetProcessHandleCount: { args: ["ptr", "ptr"], returns: "i32" },
          }).symbols;
          const handles = () => {
            const count = new Uint32Array(1);
            k32.GetProcessHandleCount(k32.GetCurrentProcess(), count);
            return count[0];
          };
          (async () => {
            // The threads of the pools have handles too.
            const { readFile } = require("fs/promises");
            await Promise.all(Array.from({ length: 64 }, () => [readFile("main.js"), Bun.file("main.js").bytes()]).flat());
            const codes = [], counts = [];
            for (let i = 0; i < ${rounds}; i++) {
              // The same names each round: they have to be free again.
              const worker = new Worker("./worker.js", { workerData: "bun-test-" + process.pid });
              worker.on("error", error => error.message === "expected" || console.error(error));
              const exited = new Promise(resolve => worker.once("exit", resolve));
              const [children] = await once(worker, "message");
              if (${!leave}) worker.terminate();
              codes.push(await exited);
              for (const pid of children) try { process.kill(pid, "SIGKILL"); } catch {}
              counts.push(handles());
            }
            // What a pool thread was working on is closed when it is done.
            for (const deadline = Date.now() + 2000; handles() - counts[1] >= 6 && Date.now() < deadline; ) await Bun.sleep(5);
            console.log(JSON.stringify({ codes, grown: handles() - counts[1] }));
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
      const { codes, grown } = JSON.parse(stdout);
      expect(codes).toEqual(Array(rounds).fill(code));
      // Threads of the system's pool come and go with a handle or two.
      expect(grown).toBeLessThan(6);
    });
  });
});
