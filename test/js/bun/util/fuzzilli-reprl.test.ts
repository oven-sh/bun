import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

// `bun fuzzilli` is the REPRL child that the Fuzzilli fuzzer drives
// (src/runtime/cli/fuzzilli_command.rs). The fuzzer talks to it over four
// inherited descriptors: 100 (commands in), 101 (HELO + one u32 status per
// program out), 102 (program source in) and 103 (FUZZILLI_PRINT out). Here the
// command and program streams are regular files prepared up front, which the
// child reads exactly like the pipe and memfd Fuzzilli would give it.
//
// The loop is compiled into fuzzilli, debug and ASAN builds only.
const enabled = !isWindows && (isDebug || isASAN);

const REPRL_CRFD = 100;
const REPRL_CWFD = 101;
const REPRL_DRFD = 102;
const REPRL_DWFD = 103;

async function runReprl(programs: string[]) {
  const sources = programs.map(p => Buffer.from(p, "utf8"));
  const control = [Buffer.from("HELO")];
  for (const source of sources) {
    const size = Buffer.alloc(8);
    size.writeBigUInt64LE(BigInt(source.length));
    control.push(Buffer.from("exec"), size);
  }

  using dir = tempDir("fuzzilli-reprl", {
    "control.bin": Buffer.concat(control),
    "programs.bin": Buffer.concat(sources),
    "status.bin": "",
    "fuzzout.txt": "",
  });
  const file = (name: string) => path.join(String(dir), name);

  const stdio: any[] = ["ignore", "pipe", "pipe"];
  stdio[REPRL_CRFD] = Bun.file(file("control.bin"));
  stdio[REPRL_CWFD] = Bun.file(file("status.bin"));
  stdio[REPRL_DRFD] = Bun.file(file("programs.bin"));
  stdio[REPRL_DWFD] = Bun.file(file("fuzzout.txt"));

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fuzzilli"],
    env: bunEnv,
    cwd: String(dir),
    stdio,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const status = fs.readFileSync(file("status.bin"));
  const statuses: number[] = [];
  for (let offset = 4; offset + 4 <= status.length; offset += 4) {
    statuses.push(status.readUInt32LE(offset));
  }
  return {
    handshake: status.subarray(0, 4).toString("latin1"),
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
