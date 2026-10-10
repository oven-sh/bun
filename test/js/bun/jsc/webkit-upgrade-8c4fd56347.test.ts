import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Coverage for the WebKit 8c4fd56347 sync (oven-sh/WebKit#503). Each case pins
// an observable behavior difference between the previous JSC and the new one.

describe.concurrent("WebKit 8c4fd56347 upgrade", () => {
  test("Promise.try returns a native promise as-is (7f38ebbabf)", () => {
    // PromiseResolve(C, value) instead of NewPromiseCapability(C): a native
    // promise returned by the callback is the result, not wrapped.
    const p = Promise.resolve(1);
    expect(Promise.try(() => p)).toBe(p);
  });

  test("Uint8Array.prototype.setFromBase64 on a zero-length target reads nothing (b1701b3489)", () => {
    // FromBase64 returns before it looks at any character when maxLength is 0,
    // so input that is not base64 at all is accepted.
    expect(new Uint8Array(0).setFromBase64("#")).toEqual({ read: 0, written: 0 });
    expect(new Uint8Array(new ArrayBuffer(8), 4, 0).setFromBase64("====")).toEqual({ read: 0, written: 0 });
    expect(() => Uint8Array.fromBase64("#")).toThrow(SyntaxError);
  });

  test("WebAssembly.Module.imports() descriptors have the spec shape (010e57fb4b)", () => {
    // The js-types proposal's `type` field is only present with useWasmJSTypes.
    // (module (import "env" "f" (func)))
    const bytes = new Uint8Array([
      0x00,
      0x61,
      0x73,
      0x6d,
      0x01,
      0x00,
      0x00,
      0x00, // magic, version
      0x01,
      0x04,
      0x01,
      0x60,
      0x00,
      0x00, // type section: () -> ()
      0x02,
      0x09,
      0x01,
      0x03,
      0x65,
      0x6e,
      0x76,
      0x01,
      0x66,
      0x00,
      0x00, // import section: env.f func 0
    ]);
    expect(WebAssembly.Module.imports(new WebAssembly.Module(bytes))).toEqual([
      { module: "env", name: "f", kind: "function" },
    ]);
  });

  test("the DFG keeps the overflow check of an otherwise unused ++ / -- (7711916200)", async () => {
    // DFGFixupPhase cleared NodeMustGenerate on the CheckOverflow ArithAdd /
    // ArithSub it lowered Inc / Dec to, so the check could be dead-code
    // eliminated and the Int32 result silently wrapped.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        function inc(k) { let y = k; ++y; return (y | 0) === y; }
        function dec(k) { let y = k; --y; return (y | 0) === y; }
        for (let i = 0; i < 20000; ++i) { inc(1); dec(1); }
        console.log(JSON.stringify([inc(2147483647), dec(-2147483648)]));
        `,
      ],
      env: {
        ...bunEnv,
        BUN_JSC_useConcurrentJIT: "0",
        BUN_JSC_thresholdForJITAfterWarmUp: "10",
        BUN_JSC_thresholdForOptimizeAfterWarmUp: "100",
        BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "1000",
      },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("[false,false]\n");
    expect(exitCode).toBe(0);
  });
});
