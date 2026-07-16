import { describe, expect, test } from "bun:test";
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
