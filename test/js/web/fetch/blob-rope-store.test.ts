import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// `new Blob([blobA, blobB, ...])` shares each Blob part's backing store as a
// rope segment instead of memcpy'ing every part into one fresh contiguous
// buffer at construction time. The asserted RSS ceilings below are an order of
// magnitude under what the eager-copy constructor costs, with headroom for
// ASAN/debug allocator overhead.

async function runRssDelta(body: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const rssMB = () => process.memoryUsage().rss / 1024 / 1024;\n` + body],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim().split("\n").pop()!);
}

test.concurrent("new Blob([big, big, ...]) shares the source Blob's store instead of copying", async () => {
  const result = await runRssDelta(`
    const UNIT = 64 * 1024 * 1024;
    const base = new Blob([new Uint8Array(UNIT)]);
    const parts = Array.from({ length: 8 }, () => base);
    const before = rssMB();
    const composite = new Blob(parts);
    const after = rssMB();
    process.stdout.write(JSON.stringify({ delta: after - before, size: composite.size }));
  `);
  expect(result.size).toBe(8 * 64 * 1024 * 1024);
  // Pre-rope: copies 8 * 64 MB = 512 MB into a fresh buffer (+512 MB RSS).
  // Rope: 8 StoreRef clones + one small Vec<RopeSegment>.
  expect(result.delta).toBeLessThan(isASAN || isDebug ? 64 : 32);
});

test.concurrent("new Blob([header, big, footer]) shares the Blob part and snapshots the scalar parts", async () => {
  const result = await runRssDelta(`
    const UNIT = 64 * 1024 * 1024;
    const big = new Blob([new Uint8Array(UNIT)]);
    const header = new Uint8Array(16);
    const footer = new Uint8Array(16);
    const before = rssMB();
    const framed = new Blob([header, big, footer]);
    const after = rssMB();
    process.stdout.write(JSON.stringify({ delta: after - before, size: framed.size }));
  `);
  expect(result.size).toBe(64 * 1024 * 1024 + 32);
  // Pre-rope: one 64 MB memcpy into the joined buffer.
  expect(result.delta).toBeLessThan(isASAN || isDebug ? 32 : 16);
});

test("rope-backed Blob is byte-exact across arrayBuffer/stream/slice/text", async () => {
  const a = new Uint8Array(1000).map((_, i) => i % 256);
  const b = new Uint8Array(2000).map((_, i) => (i * 7) % 256);
  const c = new Uint8Array(500).map((_, i) => (255 - i) % 256);
  const blobA = new Blob([a]);
  const blobB = new Blob([b]);
  const composite = new Blob([blobA, "hello", blobB, c]);
  const expected = Buffer.concat([a, Buffer.from("hello"), b, c]);

  expect(composite.size).toBe(expected.length);
  expect(Buffer.from(await composite.arrayBuffer())).toEqual(expected);

  // A second composite (the first one's rope was flattened by arrayBuffer()
  // above) so stream() is exercised against an unflattened rope too.
  const forStream = new Blob([blobA, "hello", blobB, c]);
  const chunks: Buffer[] = [];
  for await (const ch of forStream.stream()) chunks.push(Buffer.from(ch));
  expect(Buffer.concat(chunks)).toEqual(expected);

  const forSlice = new Blob([blobA, "hello", blobB, c]);
  expect(Buffer.from(await forSlice.slice(500, 1500).arrayBuffer())).toEqual(expected.subarray(500, 1500));

  const textBlob = new Blob([new Blob(["foo"]), "bar", new Blob(["baz"])]);
  expect(await textBlob.text()).toBe("foobarbaz");
});

test("typed-array parts are snapshotted at construction time", async () => {
  const src = new Uint8Array([1, 2, 3, 4, 5]);
  const base = new Blob([new Uint8Array([9, 9, 9])]);
  const composite = new Blob([base, src]);
  src.fill(0);
  expect(new Uint8Array(await composite.arrayBuffer())).toEqual(new Uint8Array([9, 9, 9, 1, 2, 3, 4, 5]));
});

test("a Blob part that is itself rope-backed splices into the outer rope", async () => {
  const a = new Blob([new Uint8Array([1, 2, 3])]);
  const b = new Blob([new Uint8Array([4, 5, 6])]);
  const inner = new Blob([a, b]);
  const c = new Blob([new Uint8Array([7, 8])]);
  const outer = new Blob([inner, c, inner.slice(2, 5)]);
  expect(outer.size).toBe(11);
  expect(new Uint8Array(await outer.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 3, 4, 5]));
});

test("structuredClone of a rope-backed File preserves bytes and name", async () => {
  const a = new Blob([new Uint8Array([1, 2, 3, 4])]);
  const b = new Blob([new Uint8Array([5, 6, 7, 8])]);
  const file = new File([a, b], "rope.bin", { type: "application/octet-stream" });
  const clone = structuredClone(file);
  expect(clone.name).toBe("rope.bin");
  expect(clone.size).toBe(8);
  expect(new Uint8Array(await clone.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
});

test("FormData.append filename sticks for a rope-backed Blob", async () => {
  const a = new Blob([new Uint8Array([1, 2])]);
  const b = new Blob([new Uint8Array([3, 4])]);
  const rope = new Blob([a, b]);
  const fd = new FormData();
  fd.append("k", rope, "x.bin");
  const entry = fd.get("k") as File;
  expect(entry.name).toBe("x.bin");
  expect(new Uint8Array(await entry.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
});

test("Bun.Archive accepts a rope-backed Blob", async () => {
  const tar = new Bun.Archive({ "a.txt": "hello from rope" });
  const buf = await tar.bytes();
  const rope = new Blob([new Blob([buf.subarray(0, 10)]), new Blob([buf.subarray(10)])]);
  const ar = new Bun.Archive(rope);
  const files = await ar.files();
  expect(await files.get("a.txt")!.text()).toBe("hello from rope");
});
