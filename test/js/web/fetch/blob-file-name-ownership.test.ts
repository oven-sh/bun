import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A `File.name` is stored on the blob's backing store as an owned,
// heap-allocated buffer (`Store.Bytes.stored_name`). `structuredClone`
// serializes that buffer and deserializes it into a fresh store whose path
// payload (`PathLike::String`) owns its own copy. Both the source and the clone
// free that buffer on teardown, so an ownership bug — a missing free (leak) or a
// double free — only surfaces when the round-trip is repeated under GC pressure.
// This exercises the owned-buffer path directly; under a debug (ASAN) build a
// double free is a hard crash.
test("structuredClone of a named File round-trips its name without leaking or double-freeing", async () => {
  const script = `
    const NAME = "owned-name-" + Buffer.alloc(512, "x").toString() + ".bin";
    for (let i = 0; i < 2000; i++) {
      const f = new File(["payload-" + i], NAME, { type: "application/octet-stream" });
      const c = structuredClone(f);
      if (c.name !== NAME) throw new Error("name mismatch: " + c.name.slice(0, 16));
      if (c.size !== f.size) throw new Error("size mismatch");
    }
    Bun.gc(true);
    // A second named clone we keep alive, then read, to hit the deserialized
    // store's owned path payload after GC.
    const f = new File(["final"], NAME, { type: "text/plain" });
    const c = structuredClone(f);
    process.stdout.write(JSON.stringify({ name: c.name, text: await c.text() }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // ASAN debug builds emit a startup "WARNING: ASAN interferes ..." line; drop
  // it before asserting the subprocess produced no other stderr (e.g. an ASAN
  // double-free report).
  const stderrLines = stderr.split("\n").filter(line => !line.startsWith("WARNING: ASAN interferes"));
  expect(stderrLines.join("\n")).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    name: "owned-name-" + Buffer.alloc(512, "x").toString() + ".bin",
    text: "final",
  });
  expect(exitCode).toBe(0);
});
