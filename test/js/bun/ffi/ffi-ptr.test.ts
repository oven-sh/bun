import { ptr, read } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("ptr() returns an address that stays valid", () => {
  // A typed array of at most 1000 bytes keeps its bytes in GC storage until
  // something needs its ArrayBuffer. The bytes move at that moment, so ptr()
  // has to give the view its ArrayBuffer first.
  const views: Record<string, () => NodeJS.TypedArray> = {
    "Buffer.allocUnsafe(16)": () => Buffer.allocUnsafe(16),
    "Buffer.alloc(16)": () => Buffer.alloc(16),
    "Buffer.from(string, 'latin1')": () => Buffer.from("abcdefghijklmnop", "latin1"),
    "new Uint8Array(16)": () => new Uint8Array(16),
    "new Float64Array(2)": () => new Float64Array(2),
    "new TextEncoder().encode(string)": () => new TextEncoder().encode("abcdefghijklmnop"),
    "new Uint8Array(1000)": () => new Uint8Array(1000),
  };

  test.each(Object.keys(views))("%s keeps its address after a .buffer read", name => {
    const view = views[name]();
    const address = ptr(view);
    new Uint8Array(view.buffer, view.byteOffset, view.byteLength)[0] = 0x5a;
    expect({ moved: ptr(view) !== address, byte: read.u8(address, 0) }).toEqual({ moved: false, byte: 0x5a });
  });

  test("a view above 1000 bytes needs no ArrayBuffer: its bytes do not move", () => {
    const view = new Uint8Array(4096);
    const before = process.memoryUsage().arrayBuffers;
    const address = ptr(view);
    const created = process.memoryUsage().arrayBuffers - before >= view.byteLength;
    view.buffer;
    expect({ created, moved: ptr(view) !== address }).toEqual({ created: false, moved: false });
  });

  // https://github.com/oven-sh/bun/issues/32054
  test("a view keeps its address after DFG tier-up", async () => {
    const code = `
      import { ptr, read } from "bun:ffi";
      const out = new Float64Array(1);
      out[0] = 1.5;
      const outPtr = ptr(out);
      function main() {
        let sum = 0;
        for (let i = 0; i < 10_000; i++) {
          sum += out[0];
        }
        return sum;
      }
      main();
      out[0] = 42.5;
      console.log(JSON.stringify({ moved: ptr(out) !== outPtr, value: read.f64(outPtr) }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: {
        ...bunEnv,
        // The DFG folds the view into the compiled loop and watches its
        // ArrayBuffer, which it has to create. These make that happen early
        // and on the main thread.
        BUN_JSC_useConcurrentJIT: "false",
        BUN_JSC_thresholdForOptimizeAfterWarmUp: "100",
        BUN_JSC_thresholdForOptimizeSoon: "100",
      },
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual({ moved: false, value: 42.5 });
    expect(exitCode).toBe(0);
  });
});
