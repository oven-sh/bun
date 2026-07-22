import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import { Worker } from "worker_threads";

// A writev issued before process.exit() parks its cb awaiting a reader ack that
// never arrives; without an exit-time flush every chunk buffered after the first
// batch is dropped (node registers a process.on('exit') that completes the cb).
describe("captured stdio drains on synchronous process.exit()", () => {
  async function collect(worker: Worker, stream: "stdout" | "stderr") {
    worker[stream].setEncoding("utf8");
    let out = "";
    worker[stream].on("data", d => (out += d));
    const ended = once(worker[stream], "end");
    const [code] = await once(worker, "exit");
    await ended;
    return { out, code };
  }

  test.each(["stdout", "stderr"] as const)("console.%s output is not lost", async stream => {
    const method = stream === "stdout" ? "log" : "error";
    const worker = new Worker(
      `console.${method}("A"); console.${method}("B"); console.${method}("C"); process.exit(0);`,
      { eval: true, [stream]: true },
    );
    const { out, code } = await collect(worker, stream);
    expect({ out, code }).toEqual({ out: "A\nB\nC\n", code: 0 });
  });

  test.each(["stdout", "stderr"] as const)("raw process.%s.write output is not lost", async stream => {
    const worker = new Worker(
      `process.${stream}.write("A\\n"); process.${stream}.write("B\\n"); process.${stream}.write("C\\n"); process.exit(0);`,
      { eval: true, [stream]: true },
    );
    const { out, code } = await collect(worker, stream);
    expect({ out, code }).toEqual({ out: "A\nB\nC\n", code: 0 });
  });

  test("many writes before exit all reach the parent", async () => {
    const worker = new Worker(`for (let i = 0; i < 100; i++) console.log("line", i); process.exit(0);`, {
      eval: true,
      stdout: true,
    });
    const { out, code } = await collect(worker, "stdout");
    const lines = out.split("\n").filter(Boolean);
    expect({ first: lines[0], last: lines.at(-1), count: lines.length, code }).toEqual({
      first: "line 0",
      last: "line 99",
      count: 100,
      code: 0,
    });
  });

  test("writes from a user process.on('exit') handler reach the parent", async () => {
    const worker = new Worker(
      `
      process.on("exit", () => { console.log("from-exit"); process.stdout.write("tail\\n"); });
      console.log("before");
      process.exit(0);
      `,
      { eval: true, stdout: true },
    );
    const { out, code } = await collect(worker, "stdout");
    expect({ out, code }).toEqual({ out: "before\nfrom-exit\ntail\n", code: 0 });
  });
});

// Default worker stdio (no { stdout: true }) is also port-backed and auto-pipes
// to the parent's stdout/stderr: the same parked-writev drop applies, so a
// worker that logs N lines then calls process.exit() must surface all N.
describe("auto-piped stdio drains on synchronous process.exit()", () => {
  const N = 300;
  function parentScript(exitCall: string) {
    const workerBody = `for (let i = 0; i < ${N}; i++) console.log("W" + i);` + `console.error("WERR");` + exitCall;
    return (
      `const { Worker } = require("node:worker_threads");` +
      `const w = new Worker(${JSON.stringify(workerBody)}, { eval: true });` +
      `w.on("exit", c => console.error("[worker exit " + c + "]"));`
    );
  }

  test("worker console.log lines all reach the parent's stdout", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parentScript("process.exit(0);")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout.split("\n").filter(Boolean);
    expect({
      first: lines[0],
      last: lines.at(-1),
      count: lines.length,
      stderr: stderr.split("\n").filter(Boolean).sort(),
    }).toEqual({
      first: "W0",
      last: `W${N - 1}`,
      count: N,
      stderr: ["WERR", "[worker exit 0]"],
    });
    expect(exitCode).toBe(0);
  });

  test("without process.exit() all lines already arrive", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parentScript("")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.split("\n").filter(Boolean).length).toBe(N);
    expect(exitCode).toBe(0);
  });
});
