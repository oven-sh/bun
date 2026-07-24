import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

// These tests spawn bun concurrently; under debug+ASAN a spawn takes seconds
// and contention pushes some past the 5s default, so use a generous per-test
// timeout. SPAWN_TIMEOUT bounds the pre-fix hang (killed -> non-null signal).
const SPAWN_TIMEOUT = 20_000;
setDefaultTimeout(isDebug ? 60_000 : 30_000);

// https://github.com/oven-sh/bun/issues/33283
// Node warns and exits 13 on an unsettled entry top-level await instead of
// hanging; the spawn `timeout` turns the pre-fix hang into a clean failure.

async function run(files: Record<string, string>, entry: string) {
  using dir = tempDir("unsettled-tla", { "package.json": "{}", ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: SPAWN_TIMEOUT,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Hang guard: the process must exit on its own, not be killed by the spawn
  // timeout (a reintroduced busy-spin would surface as a non-null signal here).
  expect(proc.signalCode).toBeNull();
  return { stdout, stderr, exitCode };
}

describe.concurrent("unsettled top-level await", () => {
  test("await on a never-resolving promise exits 13", async () => {
    const r = await run(
      {
        "entry.mjs": `console.log("BEFORE");\nawait new Promise(() => {});\nconsole.log("AFTER");\n`,
      },
      "./entry.mjs",
    );
    expect(r.stdout).toBe("BEFORE\n");
    expect(r.stderr).toContain("Detected unsettled top-level await");
    expect(r.exitCode).toBe(13);
  });

  test("dynamic-import top-level-await cycle exits 13", async () => {
    const r = await run(
      {
        "a.mjs": `import "./b.mjs";\n`,
        "b.mjs": `console.log("B_BEFORE");\nawait import("./a.mjs");\nconsole.log("B_AFTER");\n`,
      },
      "./a.mjs",
    );
    expect(r.stdout).toBe("B_BEFORE\n");
    expect(r.stderr).toContain("Detected unsettled top-level await");
    expect(r.exitCode).toBe(13);
  });

  test("self-import via import.meta.url exits 13", async () => {
    // `await import(import.meta.url)` awaits the entry's own evaluation
    // promise: a spec-level deadlock, not a bun bug, but bun must detect it
    // and exit 13 rather than hang.
    const r = await run(
      {
        "entry.mjs": `console.log("BEFORE");\nawait import(import.meta.url);\nconsole.log("AFTER");\n`,
      },
      "./entry.mjs",
    );
    expect(r.stdout).toBe("BEFORE\n");
    expect(r.stderr).toContain("Detected unsettled top-level await");
    expect(r.stderr).toContain("entry.mjs");
    expect(r.exitCode).toBe(13);
  });

  test("await on an unref'd timer exits 13", async () => {
    const r = await run(
      {
        "entry.mjs": `await new Promise(r => setTimeout(r, 100000).unref());\n`,
      },
      "./entry.mjs",
    );
    expect(r.stderr).toContain("Detected unsettled top-level await");
    expect(r.exitCode).toBe(13);
  });

  test("a ref'd timer keeps the loop alive and the await settles (exit 0)", async () => {
    const r = await run(
      {
        "entry.mjs": `await new Promise(r => setTimeout(r, 50));\nconsole.log("DONE");\n`,
      },
      "./entry.mjs",
    );
    expect(r.stdout).toBe("DONE\n");
    expect(r.stderr).not.toContain("Detected unsettled top-level await");
    expect(r.exitCode).toBe(0);
  });

  test("a beforeExit handler can settle the await (exit 0)", async () => {
    // Node parity: a beforeExit handler that resolves the awaited promise lets
    // the entry resume instead of triggering exit 13.
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
    expect(r.stdout).toBe("beforeExit\nDONE\n");
    expect(r.stderr).not.toContain("Detected unsettled top-level await");
    expect(r.exitCode).toBe(0);
  });

  test("warning names the stalled module, not the entry", async () => {
    const r = await run(
      {
        "entry.mjs": `import "./mid.mjs";\n`,
        "mid.mjs": `import "./leaf.mjs";\n`,
        "leaf.mjs": `await new Promise(() => {});\n`,
      },
      "./entry.mjs",
    );
    expect(r.stderr).toContain("Detected unsettled top-level await");
    expect(r.stderr).toContain("leaf.mjs");
    expect(r.stderr).not.toContain("entry.mjs");
    expect(r.stderr).not.toContain("mid.mjs");
    expect(r.exitCode).toBe(13);
  });

  test("warning lists every stalled sibling", async () => {
    const r = await run(
      {
        "entry.mjs": `import "./sib1.mjs";\nimport "./sib2.mjs";\n`,
        "sib1.mjs": `await new Promise(() => {});\n`,
        "sib2.mjs": `await new Promise(() => {});\n`,
      },
      "./entry.mjs",
    );
    expect(r.stderr).toContain("Detected unsettled top-level await");
    expect(r.stderr).toContain("sib1.mjs");
    expect(r.stderr).toContain("sib2.mjs");
    expect(r.stderr).not.toContain("entry.mjs");
    expect(r.exitCode).toBe(13);
  });

  test("--print prints a top-level await that beforeExit settles", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-p", `let r; process.on("beforeExit", () => r(42)); await new Promise(res => { r = res; });`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: SPAWN_TIMEOUT,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(proc.signalCode).toBeNull();
    expect(stdout.trim()).toBe("42");
    expect(stderr).not.toContain("Detected unsettled top-level await");
    expect(exitCode).toBe(0);
  });

  test("--print emits the value before beforeExit output for a non-TLA entry", async () => {
    // A synchronously-settled entry prints before beforeExit (Node's order),
    // exercising the print-before-beforeExit path.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-p", `process.on("beforeExit", () => console.log("BE")); 123`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: SPAWN_TIMEOUT,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(proc.signalCode).toBeNull();
    expect(stdout).toBe("123\nBE\n");
    expect(exitCode).toBe(0);
  });

  test("a resumed body that throws after beforeExit exits 1", async () => {
    const r = await run(
      {
        "entry.mjs": `let r; process.on("beforeExit", () => r());\nawait new Promise(res => { r = res; });\nthrow new Error("boom");\n`,
      },
      "./entry.mjs",
    );
    expect(r.stderr).toContain("boom");
    expect(r.stderr).not.toContain("Detected unsettled top-level await");
    expect(r.exitCode).toBe(1);
  });

  test("uncaughtException handler runs (and its async work) for a throw after beforeExit (exit 0)", async () => {
    const r = await run(
      {
        "entry.mjs": `process.on("uncaughtException", e => { console.log("caught", e.message); setTimeout(() => console.log("cleanup done"), 1); });\nlet r; process.on("beforeExit", () => r());\nawait new Promise(res => { r = res; });\nthrow new Error("boom");\n`,
      },
      "./entry.mjs",
    );
    expect(r.stdout).toBe("caught boom\ncleanup done\n");
    expect(r.exitCode).toBe(0);
  });

  test("bun -p with an unsettled top-level await exits 13 without printing a pending promise", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-p", `await new Promise(() => {})`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: SPAWN_TIMEOUT,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(proc.signalCode).toBeNull();
    expect(stdout).toBe("");
    expect(stderr).toContain("Detected unsettled top-level await");
    expect(exitCode).toBe(13);
  });

  test("bun -e with an unsettled top-level await exits 13", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `await new Promise(() => {})`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: SPAWN_TIMEOUT,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(proc.signalCode).toBeNull();
    expect(stderr).toContain("Detected unsettled top-level await");
    expect(exitCode).toBe(13);
  });
});
