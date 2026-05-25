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

test("AggregateError from a module with many build errors survives GC during its creation", async () => {
  // A module that fails to load with multiple errors produces an
  // AggregateError of BuildMessage objects. The wrappers used to be collected
  // in a heap Vec the conservative GC scan cannot see, so a collection in the
  // middle of creating them freed the native payloads and printing or
  // inspecting the AggregateError afterwards was a use-after-free.
  using dir = tempDir("aggregate-build-errors", {
    "bad.js": Array.from({ length: 250 }, (_, i) => `let dup${i} = 1; let dup${i} = 2;`).join("\n"),
    "index.js": `
      let aggregate;
      try {
        await import("./bad.js");
        throw new Error("expected import to fail");
      } catch (e) {
        aggregate = e;
      }
      Bun.gc(true);
      if (aggregate.constructor.name !== "AggregateError") {
        throw new Error("expected AggregateError, got " + aggregate.constructor.name);
      }
      if (aggregate.errors.length < 2) {
        throw new Error("expected multiple build errors, got " + aggregate.errors.length);
      }
      for (const sub of aggregate.errors) {
        if (typeof sub.message !== "string") throw new Error("bad message");
        void sub.position;
      }
      console.error(aggregate);
      console.log("OK", aggregate.errors.length);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      // Make a collection land while the per-message error wrappers are being created.
      BUN_JSC_collectContinuously: "true",
      BUN_JSC_forceRAMSize: "1000000",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("AddressSanitizer");
  expect(stdout).toContain("OK 250");
  expect(exitCode).toBe(0);
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
