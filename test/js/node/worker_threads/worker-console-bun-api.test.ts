import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// node:worker_threads used to replace the worker's global console wholesale
// with a node:console instance. That loses Bun's documented console APIs
// (console.write, console[Symbol.asyncIterator]) and switches formatting from
// Bun.inspect to Node's util.inspect, so a worker and the main thread of the
// same process printed different shapes for the same value.

describe.concurrent("node:worker_threads console", () => {
  test("keeps Bun console APIs and formatting inside workers", async () => {
    using dir = tempDir("worker-console-api", {
      "main.js": `
        const { Worker, isMainThread } = require("node:worker_threads");
        function report(tag) {
          console.log(tag + ".write:", typeof console.write);
          console.log(tag + ".asyncIterator:", typeof console[Symbol.asyncIterator]);
          console.log(tag + ".Console:", typeof console.Console);
          console.log(tag + ".map:", new Map([["k", "v"]]));
          console.log(tag + ".deep:", { l1: { l2: { l3: { l4: 1 } } } });
          console.log(tag + ".bun.inspect:", JSON.stringify(Bun.inspect(new Map([["k","v"]]))));
        }
        if (isMainThread) {
          report("main");
          const w = new Worker(__filename);
          w.on("exit", code => { if (code !== 0) process.exitCode = 1; });
        } else {
          report("worker");
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: { ...bunEnv, NO_COLOR: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.split("\n");
    const get = (prefix: string) =>
      lines
        .filter(l => l.startsWith(prefix))
        .join("\n")
        .slice(prefix.length);

    // Bun-specific console APIs are present inside the worker.
    expect({
      write: get("worker.write: "),
      asyncIterator: get("worker.asyncIterator: "),
      Console: get("worker.Console: "),
    }).toEqual({ write: "function", asyncIterator: "function", Console: "function" });

    // Formatting matches the main thread (same process, same Bun.inspect backend).
    expect(get("worker.map: ")).toBe(get("main.map: "));
    expect(get("worker.deep: ")).toBe(get("main.deep: "));
    expect(get("worker.bun.inspect: ")).toBe(get("main.bun.inspect: "));

    // Guard against Node util.inspect formatting leaking in.
    expect(stdout).not.toContain("=>");
    expect(stdout).not.toContain("[Object]");

    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });

  test("console.log is still captured by worker.stdout when { stdout: true }", async () => {
    using dir = tempDir("worker-console-capture", {
      "main.js": `
        const { Worker, isMainThread } = require("node:worker_threads");
        if (isMainThread) {
          const w = new Worker(__filename, { stdout: true, stderr: true });
          let out = "", err = "";
          w.stdout.setEncoding("utf8").on("data", d => { out += d; });
          w.stderr.setEncoding("utf8").on("data", d => { err += d; });
          w.stdout.on("end", () => {
            process.stdout.write("CAPTURED:" + JSON.stringify({ out, err }));
          });
        } else {
          console.log("via-console", new Map([["k","v"]]));
          console.error("via-error");
          process.stdout.write("via-process\\n");
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: { ...bunEnv, NO_COLOR: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.startsWith("CAPTURED:")).toBe(true);
    const { out, err } = JSON.parse(stdout.slice("CAPTURED:".length));
    // Both console.log and process.stdout.write were routed through worker.stdout.
    expect(out).toContain("via-console");
    expect(out).toContain("via-process");
    expect(err).toContain("via-error");
    // Bun formatting, not Node's `'k' => 'v'`.
    expect(out).not.toContain("=>");

    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });

  test("web Worker global console is unaffected", async () => {
    const src = `
      const w = new Worker("data:text/javascript," + encodeURIComponent(
        'postMessage({ write: typeof console.write, ai: typeof console[Symbol.asyncIterator] })'
      ));
      w.onmessage = e => { console.log(JSON.stringify(e.data)); w.terminate(); };
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim())).toEqual({ write: "function", ai: "function" });
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });
});
