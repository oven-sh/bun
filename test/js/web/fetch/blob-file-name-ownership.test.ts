import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `structuredClone` of a blob-backed object serializes its path/name bytes and
// deserializes them into a fresh store that owns its own copy, so a bad free or
// a missing free only surfaces when the round-trip is repeated under GC — and a
// double free is a hard crash under a debug (ASAN) build. The two cases below
// cover the two distinct owned buffers the (de)serializer allocates:
//
//   - `new File([bytes], name)` is a `Data::Bytes` store; the round-trip goes
//     through `SerializeTag::Bytes` and adopts the name into `Bytes.stored_name`
//     (`Box<[u8]>`).
//   - `Bun.file(path)` is a `Data::File` store; the round-trip goes through
//     `SerializeTag::File` and adopts the path into `PathLike::String`
//     (`CowSlice<u8>`, owned arm).
test("structuredClone round-trips File (Bytes) and Bun.file (File) names without leaking or double-freeing", async () => {
  using dir = tempDir("blob-name-ownership", {
    "payload.bin": "the file contents",
  });
  const filePath = `${String(dir)}/payload.bin`;
  const script = `
    const NAME = "owned-name-" + Buffer.alloc(512, "x").toString() + ".bin";
    const FILE_PATH = ${JSON.stringify(filePath)};

    // Data::Bytes store -> SerializeTag::Bytes -> Bytes.stored_name (Box<[u8]>).
    for (let i = 0; i < 2000; i++) {
      const f = new File(["payload-" + i], NAME, { type: "application/octet-stream" });
      const c = structuredClone(f);
      if (c.name !== NAME) throw new Error("bytes name mismatch: " + c.name.slice(0, 16));
      if (c.size !== f.size) throw new Error("bytes size mismatch");
    }

    // Data::File store -> SerializeTag::File -> PathLike::String (CowSlice owned).
    for (let i = 0; i < 2000; i++) {
      const f = Bun.file(FILE_PATH);
      const c = structuredClone(f);
      if (c.name !== FILE_PATH) throw new Error("file name mismatch: " + c.name);
    }

    Bun.gc(true);
    // Keep one clone of each kind alive past GC, then read through it to touch
    // the deserialized owned buffers after a collection.
    const bytesClone = structuredClone(new File(["final"], NAME, { type: "text/plain" }));
    const fileClone = structuredClone(Bun.file(FILE_PATH));
    process.stdout.write(JSON.stringify({
      bytesName: bytesClone.name,
      bytesText: await bytesClone.text(),
      fileName: fileClone.name,
      fileText: await fileClone.text(),
    }));
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
    bytesName: "owned-name-" + Buffer.alloc(512, "x").toString() + ".bin",
    bytesText: "final",
    fileName: filePath,
    fileText: "the file contents",
  });
  expect(exitCode).toBe(0);
});
