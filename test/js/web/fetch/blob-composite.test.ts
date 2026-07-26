import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// `new Blob(parts)` used to memcpy every Blob-typed part into the new blob's
// backing store, so memory scaled with the repeat count and framing a payload
// doubled it. The constructor now references in-memory Blob parts and only
// materialises a contiguous buffer on first read.

const MB = 1024 * 1024;

describe("new Blob([...]) with Blob parts", () => {
  test("shares storage instead of copying", async () => {
    // Run in a subprocess so RSS is measured against a clean baseline; the
    // test runner's own heap is noisy under ASAN.
    const script = `
      const MB = 1024 * 1024;
      const rss = () => process.memoryUsage().rss;
      const part = new Blob([new Uint8Array(32 * MB).fill(7)]);
      Bun.gc(true);
      const m0 = rss();
      const repeated = new Blob(Array(16).fill(part));
      const framed = new Blob(["HDR\\n", part, "\\nFTR"]);
      Bun.gc(true);
      const m1 = rss();
      process.stdout.write(JSON.stringify({
        deltaMB: Math.round((m1 - m0) / MB),
        repeatedSize: repeated.size,
        framedSize: framed.size,
      }));
      // keep alive
      if (repeated.size < 0 || framed.size < 0) throw 0;
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    const { deltaMB, repeatedSize, framedSize } = JSON.parse(stdout);
    expect(repeatedSize).toBe(16 * 32 * MB);
    expect(framedSize).toBe(32 * MB + 8);
    // 16 copies of a 32 MB part plus one framed copy is >512 MB when the
    // bytes are duplicated. With sharing the delta is just bookkeeping.
    // ASAN quarantine and debug heaps add noise, so allow generous slack;
    // the unfixed behaviour is an order of magnitude over this bound.
    const bound = isASAN || isDebug ? 64 : 16;
    expect(deltaMB).toBeLessThan(bound);
    expect(exitCode).toBe(0);
  });

  test("bytes are identical to a flat construction", async () => {
    const payload = new Uint8Array(1000);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 131) & 0xff;
    const inner = new Blob([payload]);

    const composite = new Blob(["HDR\n", inner, inner.slice(100, 200), "\nFTR"]);
    const flat = new Blob(["HDR\n", payload, payload.subarray(100, 200), "\nFTR"]);

    expect(composite.size).toBe(flat.size);
    expect(new Uint8Array(await composite.arrayBuffer())).toEqual(
      new Uint8Array(await flat.arrayBuffer()),
    );
    expect(await composite.text()).toBe(await flat.text());

    // .slice() across a part boundary
    const a = composite.slice(2, 10);
    const b = flat.slice(2, 10);
    expect(await a.bytes()).toEqual(await b.bytes());

    // .stream() yields the same bytes in order
    let got = new Uint8Array(0);
    for await (const chunk of composite.stream()) {
      const next = new Uint8Array(got.length + chunk.length);
      next.set(got);
      next.set(chunk, got.length);
      got = next;
    }
    expect(got).toEqual(new Uint8Array(await flat.arrayBuffer()));
  });

  test("Response body and Bun.write round-trip", async () => {
    const payload = new Blob([new Uint8Array(50_000).fill(0xab)]);
    const composite = new Blob(["<<", payload, ">>"]);

    const body = await new Response(composite).bytes();
    expect(body.length).toBe(50_004);
    expect(body[0]).toBe("<".charCodeAt(0));
    expect(body[2]).toBe(0xab);
    expect(body[50_001]).toBe(0xab);
    expect(body[50_002]).toBe(">".charCodeAt(0));

    using dir = tempDir("blob-composite", {});
    const dest = `${dir}/out.bin`;
    const n = await Bun.write(dest, composite);
    expect(n).toBe(50_004);
    expect(new Uint8Array(await Bun.file(dest).arrayBuffer())).toEqual(body);
  });

  test("new File with Blob parts keeps its name", async () => {
    const inner = new Blob([new Uint8Array(10).fill(1)]);
    const f = new File(["a", inner, "b"], "hello.bin");
    expect(f.name).toBe("hello.bin");
    expect(f.size).toBe(12);
    expect(await f.text()).toBe("a" + "\x01".repeat(10) + "b");
  });

  test("structuredClone of a composite Blob", async () => {
    const inner = new Blob([new Uint8Array(256).fill(9)]);
    const composite = new Blob(["x", inner, "y"]);
    const cloned = structuredClone(composite);
    expect(cloned.size).toBe(258);
    expect(await cloned.bytes()).toEqual(await composite.bytes());
  });

  test("nested composites flatten to the same bytes", async () => {
    const leaf = new Blob([new Uint8Array([1, 2, 3, 4])]);
    const mid = new Blob(["<", leaf, ">"]);
    const outer = new Blob([mid, mid, leaf]);
    expect(outer.size).toBe(6 + 6 + 4);
    expect([...new Uint8Array(await outer.arrayBuffer())]).toEqual([
      60, 1, 2, 3, 4, 62, 60, 1, 2, 3, 4, 62, 1, 2, 3, 4,
    ]);
  });
});
