import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

test("BuildError is modifiable", async () => {
  try {
    await import("../util/inspect-error-fixture-bad.js");
    expect.unreachable();
  } catch (e) {
    var error: BuildMessage = e as BuildMessage;
    if (error.name !== "BuildMessage") {
      throw new Error("Expected BuildMessage, got " + error.name);
    }
  }

  const message = error!.message;
  // @ts-ignore
  expect(() => (error!.message = "new message")).not.toThrow();
  expect(error!.message).toBe("new message");
  expect(error!.message).not.toBe(message);
});

test("aggregated module load errors survive a GC during error creation", async () => {
  // When a module fails to transpile with more than one log message, the
  // module loader wraps every BuildMessage/ResolveMessage in a JS cell and
  // aggregates them into an AggregateError. Those freshly created cells used
  // to be held only in a native heap Vec, which the conservative GC cannot
  // see, so a collection during aggregation freed them and printing the
  // error afterwards read freed memory (heap-use-after-free under ASAN).
  using dir = tempDir("build-error-aggregate-gc", {
    // Every line is a recoverable parse error so the transpiler log contains
    // many messages and the aggregate path is taken.
    "many-errors.js": Array.from({ length: 60 }, (_, i) => `v${i}: 1 2 3`).join("\n") + "\n",
    // Same failure, but on a Worker thread (how the fuzzer originally hit it).
    "worker-parent.js": `
      const w = new Worker(new URL("./many-errors.js", import.meta.url).href);
      w.addEventListener("error", () => {});
    `,
  });

  // collectContinuously is extremely slow on Windows; forceRAMSize still
  // pressures the GC enough there (same approach as require-esm-gc-roots).
  const gcEnv = isWindows
    ? { ...bunEnv, BUN_JSC_forceRAMSize: String(64 * 1024 * 1024) }
    : { ...bunEnv, BUN_JSC_collectContinuously: "1" };

  const runs = [
    (async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "many-errors.js"],
        env: gcEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("AddressSanitizer");
      expect(stderr).toContain("error:");
      expect(exitCode).toBe(1);
    })(),
    (async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "worker-parent.js"],
        env: gcEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("AddressSanitizer");
      expect(exitCode).toBe(0);
    })(),
  ];
  await Promise.all(runs);
}, 90_000);

test("BuildMessage finalize frees with the same allocator it was created with", async () => {
  // BuildMessage.create() clones the message with the passed allocator
  // but finalize() was freeing it with bun.default_allocator and never
  // destroying the struct itself.
  using dir = tempDir("build-message-finalize", { "bad.js": "function bad( {" });
  const entry = join(String(dir), "bad.js");
  for (let i = 0; i < 20; i++) {
    const r = await Bun.build({ entrypoints: [entry], throw: false });
    expect(r.success).toBe(false);
    expect(r.logs.length).toBeGreaterThan(0);
    for (const e of r.logs) {
      void e.message;
      void e.level;
      void e.position;
      void e.notes;
      void String(e);
    }
    Bun.gc(true);
  }
});
