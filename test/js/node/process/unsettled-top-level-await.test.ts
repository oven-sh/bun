import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Node.js exit code 13: when the event loop drains while the entry module's
// top-level await is still pending, the process exits 13 with a warning
// instead of hanging forever. Regressed by the JSC module-loader rewrite,
// which (correctly) stopped resolving TLA self-cycles.

async function run(files: Record<string, string>, entry: string) {
  using dir = tempDir("unsettled-tla", { "package.json": "{}", ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

describe("unsettled top-level await", () => {
  test.concurrent("await on a never-resolving promise exits 13", async () => {
    const r = await run(
      {
        "entry.mjs": `console.log("BEFORE");\nawait new Promise(() => {});\nconsole.log("AFTER");\n`,
      },
      "./entry.mjs",
    );
    expect(r.stdout).toBe("BEFORE\n");
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.exitCode).toBe(13);
  });

  test.concurrent("dynamic-import TLA cycle exits 13", async () => {
    const r = await run(
      {
        "a.mjs": `import "./b.mjs";\n`,
        "b.mjs": `console.log("B_BEFORE");\nawait import("./a.mjs");\nconsole.log("B_AFTER");\n`,
      },
      "./a.mjs",
    );
    expect(r.stdout).toBe("B_BEFORE\n");
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.exitCode).toBe(13);
  });

  test.concurrent("await on an unref'd timer exits 13", async () => {
    const r = await run(
      {
        "entry.mjs": `await new Promise(r => setTimeout(r, 100000).unref());\n`,
      },
      "./entry.mjs",
    );
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.exitCode).toBe(13);
  });

  test.concurrent("ref'd timer keeps the loop alive and TLA settles", async () => {
    const r = await run(
      {
        "entry.mjs": `await new Promise(r => setTimeout(r, 50));\nconsole.log("DONE");\n`,
      },
      "./entry.mjs",
    );
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toEqual({
      stdout: "DONE\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("beforeExit can settle the TLA", async () => {
    // Node parity: a beforeExit handler that resolves the awaited promise
    // lets the entry resume instead of triggering exit 13.
    const r = await run(
      {
        "entry.mjs": `
          let resolve;
          process.on("beforeExit", () => { console.log("beforeExit"); resolve(); });
          await new Promise(r => { resolve = r; });
          console.log("DONE");
        `,
      },
      "./entry.mjs",
    );
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toEqual({
      stdout: "beforeExit\nDONE\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("warning names the stalled module, not the entry", async () => {
    const r = await run(
      {
        "entry.mjs": `import "./mid.mjs";\n`,
        "mid.mjs": `import "./leaf.mjs";\n`,
        "leaf.mjs": `await new Promise(() => {});\n`,
      },
      "./entry.mjs",
    );
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.stderr).toContain("leaf.mjs");
    expect(r.stderr).not.toContain("entry.mjs");
    expect(r.stderr).not.toContain("mid.mjs");
    expect(r.exitCode).toBe(13);
  });

  test.concurrent("warning lists every stalled sibling", async () => {
    const r = await run(
      {
        "entry.mjs": `import "./sib1.mjs"; import "./sib2.mjs";\n`,
        "sib1.mjs": `await new Promise(() => {});\n`,
        "sib2.mjs": `await new Promise(() => {});\n`,
      },
      "./entry.mjs",
    );
    expect(r.stderr).toContain("sib1.mjs");
    expect(r.stderr).toContain("sib2.mjs");
    expect(r.stderr).not.toContain("entry.mjs");
    expect(r.exitCode).toBe(13);
  });

  test.concurrent("explicit process.exitCode is respected over 13", async () => {
    const r = await run(
      {
        "entry.mjs": `
          process.on("exit", code => console.log("exit", code, process.exitCode));
          process.exitCode = 42;
          await new Promise(() => {});
        `,
      },
      "./entry.mjs",
    );
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toEqual({
      stdout: "exit 42 42\n",
      stderr: "",
      exitCode: 42,
    });
  });

  test.concurrent("process exit listener sees code 13", async () => {
    const r = await run(
      {
        "entry.mjs": `
          process.on("exit", code => console.log("exit", code, process.exitCode));
          await new Promise(() => {});
        `,
      },
      "./entry.mjs",
    );
    expect(r.stdout).toBe("exit 13 13\n");
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.exitCode).toBe(13);
  });

  test.concurrent("worker process.exit() does not settle main thread's TLA", async () => {
    const r = await run(
      {
        "entry.mjs": `
          import { Worker, isMainThread } from "worker_threads";
          if (isMainThread) {
            new Worker(new URL(import.meta.url));
            await new Promise(() => {});
          } else {
            process.exit();
          }
        `,
      },
      "./entry.mjs",
    );
    expect(r.stderr).toContain("unsettled top-level await");
    expect(r.exitCode).toBe(13);
  });

  test.concurrent("beforeExit settles TLA which then schedules more async work", async () => {
    const r = await run(
      {
        "entry.mjs": `
          let resolve;
          process.on("beforeExit", () => { console.log("beforeExit"); resolve(); });
          await new Promise(r => { resolve = r; });
          console.log("RESUMED");
          await new Promise(r => setTimeout(r, 20));
          console.log("DONE");
        `,
      },
      "./entry.mjs",
    );
    expect({ stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }).toEqual({
      stdout: "beforeExit\nRESUMED\nDONE\nbeforeExit\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
