import { bunEnv, bunExe, tempDir } from "harness";
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

test("importing a module with many build errors does not crash while reporting them", async () => {
  // The AggregateError for a failed module build is assembled from one
  // BuildMessage wrapper per log message. Those wrappers used to be collected
  // only in a heap Vec (invisible to the conservative GC scan), so a GC during
  // the loop could finalize earlier wrappers and free their native
  // BuildMessage before the AggregateError was created, causing a
  // use-after-free when the unhandled rejection was printed.
  using dir = tempDir("build-error-many", {
    // 40 declarations + 80 redeclarations -> ~80 build errors in one module
    "bad.js": Array.from({ length: 120 }, (_, i) => `const x${i % 40} = 1;`).join("\n"),
    "index.js": `import("./bad.js");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_JSC_collectContinuously: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Every error in the AggregateError should have been printed.
  expect(stderr).toContain('"x0" has already been declared');
  expect(stderr).toContain('"x39" has already been declared');
  expect(stderr).not.toContain("AddressSanitizer");
  // Unhandled rejection -> clean exit with code 1, not a crash.
  expect(exitCode).toBe(1);
});

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
