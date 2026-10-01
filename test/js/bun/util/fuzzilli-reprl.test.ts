import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import fs from "node:fs";

// `bun fuzzilli` is the REPRL child that the Fuzzilli fuzzer drives
// (src/runtime/cli/fuzzilli_command.rs). The fuzzer talks to it over four
// inherited descriptors: 100 (commands in), 101 (HELO + one u32 status per
// program out), 102 (program source in) and 103 (FUZZILLI_PRINT out). Here all
// four are pipes. The commands and the programs are written up front and the
// command pipe is closed, so the child runs every program and leaves on EOF.
//
// The loop is compiled into fuzzilli, debug and ASAN builds only.
const enabled = !isWindows && (isDebug || isASAN);

const REPRL_CRFD = 100;
const REPRL_CWFD = 101;
const REPRL_DRFD = 102;
const REPRL_DWFD = 103;

function owned(fd: number) {
  let open = true;
  const close = () => {
    if (open) fs.closeSync(fd);
    open = false;
  };
  return { fd, close, [Symbol.dispose]: close };
}

async function runReprl(programs: string[]) {
  const sources = programs.map(p => Buffer.from(p, "utf8"));
  const control = [Buffer.from("HELO")];
  for (const source of sources) {
    const size = Buffer.alloc(8);
    size.writeBigUInt64LE(BigInt(source.length));
    control.push(Buffer.from("exec"), size);
  }

  using dir = tempDir("fuzzilli-reprl", {});
  // Descriptors 3 to 99 stay closed in the child. 100 to 103 are the REPRL pipes.
  const unused = Array.from({ length: REPRL_CRFD - 3 }, () => "ignore" as const);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fuzzilli"],
    env: bunEnv,
    cwd: String(dir),
    stdio: ["ignore", "pipe", "pipe", ...unused, "pipe", "pipe", "pipe", "pipe"],
  });
  // Reading `stdio` makes the caller the owner of the pipe descriptors.
  const fds = proc.stdio;
  using commands = owned(fds[REPRL_CRFD]!);
  using status = owned(fds[REPRL_CWFD]!);
  using data = owned(fds[REPRL_DRFD]!);
  using _fuzzout = owned(fds[REPRL_DWFD]!);

  fs.writeSync(commands.fd, Buffer.concat(control));
  fs.writeSync(data.fd, Buffer.concat(sources));
  commands.close();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const written = fs.readFileSync(status.fd);
  const statuses: number[] = [];
  for (let offset = 4; offset + 4 <= written.length; offset += 4) {
    statuses.push(written.readUInt32LE(offset));
  }
  return {
    handshake: written.subarray(0, 4).toString("latin1"),
    statuses,
    stdout: stdout.split("\n").filter(Boolean),
    stderr,
    exitCode,
  };
}

describe.skipIf(!enabled)("bun fuzzilli", () => {
  test.concurrent("every program runs on a fresh global object", async () => {
    const result = await runReprl([
      `
        globalThis.leaked = 1;
        var declared = 2;
        function hoisted() {}
        Object.prototype.polluted = 3;
        Array.prototype.push = function () { throw new Error("patched push"); };
        Object.getPrototypeOf = function () { throw new Error("patched getPrototypeOf"); };
        console.log("program 0 done");
      `,
      `
        console.log(JSON.stringify({
          leaked: typeof leaked,
          declared: typeof declared,
          hoisted: typeof hoisted,
          polluted: "polluted" in {},
          push: [].push(1),
          getPrototypeOf: Object.getPrototypeOf([]) === Array.prototype,
          require: typeof require("node:path").join,
          module: typeof module,
          filename: typeof __filename,
        }));
      `,
    ]);

    expect(result.handshake).toBe("HELO");
    expect(result.stdout).toEqual([
      "program 0 done",
      JSON.stringify({
        leaked: "undefined",
        declared: "undefined",
        hoisted: "undefined",
        polluted: false,
        push: 1,
        getPrototypeOf: true,
        require: "function",
        module: "object",
        filename: "string",
      }),
    ]);
    expect(result.statuses).toEqual([0, 0]);
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("status reports sync and async failures, and nothing a program schedules outlives it", async () => {
    const result = await runReprl([
      /* 0 */ `throw new Error("sync failure");`,
      /* 1 */ `setTimeout(() => { throw new Error("timer failure"); }, 1);`,
      /* 2 */ `Promise.reject(new Error("rejection failure"));`,
      /* 3 */ `
        setInterval(() => console.log("interval from program 3"), 1).unref();
        Bun.serve({ port: 0, fetch: () => new Response("program 3") }).unref();
        queueMicrotask(() => console.log("microtask 3"));
      `,
      /* 4 */ `
        Bun.sleepSync(10);
        setTimeout(() => console.log("timer 4"), 20);
      `,
      /* 5 */ `console.log("ok 5");`,
    ]);

    expect(result.handshake).toBe("HELO");
    expect(result.stderr).toContain("sync failure");
    expect(result.stderr).toContain("timer failure");
    expect(result.stderr).toContain("rejection failure");
    expect(result.stdout).toEqual(["microtask 3", "timer 4", "ok 5"]);
    expect(result.statuses).toEqual([0x100, 0x100, 0x100, 0, 0, 0]);
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("whatever a program throws or patches, it gets a status and the loop goes on", async () => {
    // Thrown values whose string coercion throws, sync and async, and a
    // program that breaks every builtin a loop written in JS would reach for.
    const result = await runReprl([
      /* 0 */ `throw Symbol("sync symbol");`,
      /* 1 */ `function F() {} F[Symbol.toPrimitive] = () => F; throw F;`,
      /* 2 */ `queueMicrotask(() => { throw { toString() { throw new Error("unprintable"); } }; });`,
      /* 3 */ `Promise.reject(Symbol("async symbol"));`,
      /* 4 */ `(async () => { await null; throw new Error("rejected after await"); })();`,
      /* 5 */ `
        console.log = console.error = () => { throw new Error("patched console"); };
        process.on = process.off = process.emit = process.removeListener = undefined;
        process.removeAllListeners();
        globalThis.Buffer = undefined;
        require("node:fs").writeSync = () => { throw new Error("patched writeSync"); };
        Object.defineProperty(globalThis, "Promise", { value: undefined });
        Reflect.apply = Function.prototype.call = Function.prototype.apply = undefined;
        queueMicrotask(() => { throw new Error("after patching"); });
      `,
      /* 6 */ `console.log("ok 6");`,
    ]);

    expect(result.stderr).toContain("sync symbol");
    expect(result.stderr).toContain("async symbol");
    expect(result.stderr).toContain("rejected after await");
    expect(result.stderr).toContain("after patching");
    expect(result.stdout).toEqual(["ok 6"]);
    expect(result.statuses).toEqual([0x100, 0x100, 0x100, 0x100, 0x100, 0x100, 0]);
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("a program that never ends its own event loop still reports a status", async () => {
    // Program 0 stops neither the server nor the interval, so its event loop
    // never ends. The loop gets a fixed slice, then the status goes out and
    // the reset stops both. Program 1 reads the port out of the file, because
    // program 0's globals are gone by then.
    const result = await runReprl([
      `
        const server = Bun.serve({ port: 0, fetch: () => new Response("program 0") });
        setInterval(() => {}, 5);
        require("fs").writeFileSync("port.txt", String(server.port));
        console.log("serving");
      `,
      `
        const port = require("fs").readFileSync("port.txt", "utf8");
        fetch("http://localhost:" + port + "/").then(
          () => console.log("server alive: true"),
          () => console.log("server alive: false"),
        );
      `,
    ]);

    expect(result.stdout).toEqual(["serving", "server alive: false"]);
    expect(result.statuses).toEqual([0, 0]);
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("a Worker that is busy in JIT code when its program ends is stopped by the reset", async () => {
    // JSC stops such a Worker with a signal-based VM trap, so nothing may take
    // SIGSEGV away from JSC in the REPRL child. The program blocks until the
    // Worker reports that its loop is hot, and leaves it spinning.
    const worker = `
      onmessage = event => {
        const hot = new Int32Array(event.data);
        function spin(n) {
          let x = 0;
          for (let i = 0; i < n; i++) x += Math.random();
          return x;
        }
        spin(1e6);
        Atomics.store(hot, 0, 1);
        Atomics.notify(hot, 0);
        while (true) spin(2147483647);
      };
    `;
    const result = await runReprl([
      `
        const hot = new Int32Array(new SharedArrayBuffer(4));
        new Worker(${JSON.stringify("data:text/javascript," + encodeURIComponent(worker))}).postMessage(hot.buffer);
        Atomics.wait(hot, 0, 0);
        console.log("worker is spinning");
      `,
      `console.log("after the worker");`,
    ]);

    expect(result.stdout).toEqual(["worker is spinning", "after the worker"]);
    expect(result.statuses).toEqual([0, 0]);
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("a program cannot replace the REPRL child with process.execve", async () => {
    const result = await runReprl([
      `process.execve(process.execPath, [process.execPath, "--version"]); console.log("still here");`,
      `console.log("next program");`,
    ]);

    expect(result.stdout).toEqual(["still here", "next program"]);
    expect(result.statuses).toEqual([0, 0]);
    expect(result.exitCode).toBe(0);
  });
});

declare const fuzzilli: unknown;
// Only the fuzzilli build (bun run build:debug:fuzzilli) has a fuzzilli() global.
const isFuzzilliBuild = typeof fuzzilli === "function";

// A crash in the REPRL child must leave an ASAN report on stderr and die from
// a signal, which is what Fuzzilli counts as a crash. symbolize=0 keeps ASAN
// from running llvm-symbolizer over the whole binary; the header is enough.
describe.skipIf(!isFuzzilliBuild)("fuzzilli crash reporting", () => {
  // FUZZILLI_CRASH types: 0 is std::abort(), 1 is __builtin_trap() (SIGILL on
  // x64, SIGTRAP on arm64), 5 writes through a null pointer.
  describe.each([
    [0, /AddressSanitizer: ABRT/],
    [1, /AddressSanitizer: (ILL|TRAP)/],
    [5, /AddressSanitizer: SEGV/],
  ])("FUZZILLI_CRASH %d", (type, report) => {
    test.concurrent("dies with an ASAN report", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `fuzzilli("FUZZILLI_CRASH", ${type})`],
        env: { ...bunEnv, ASAN_OPTIONS: "symbolize=0" },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain(`FUZZILLI_CRASH: ${type}`);
      expect(stderr).toMatch(report);
      expect(proc.signalCode).toBe("SIGABRT");
    });
  });
});
