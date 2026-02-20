import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("handle-crash-patterns WASM IPInt detection", () => {
  const scriptPath = new URL("../../../scripts/handle-crash-patterns.ts", import.meta.url).pathname;

  function runPattern(body: string): { close: boolean; reason?: string; comment?: string } {
    const result = Bun.spawnSync({
      cmd: [bunExe(), scriptPath],
      env: {
        ...bunEnv,
        GITHUB_ISSUE_NUMBER: "1",
        GITHUB_ISSUE_TITLE: "test",
        GITHUB_ISSUE_BODY: body,
      },
    });
    return JSON.parse(result.stdout.toString());
  }

  test("detects wasm_trampoline_wasm_ipint_call_wide32 in decoded stack trace", () => {
    const result = runPattern("Segmentation fault at address 0x7F7146505845\n- wasm_trampoline_wasm_ipint_call_wide32");
    expect(result.close).toBe(true);
    expect(result.reason).toBe("not_planned");
    expect(result.comment).toContain("#17841");
  });

  test("detects WASM IPInt crash by address suffix 0x46505845 from issue #27291", () => {
    // This is the actual body pattern from issue #27291, which only had
    // the raw crash address without the decoded stack trace symbols.
    const result = runPattern(
      "panic(main thread): Segmentation fault at address 0x7FA746505845\n\nElapsed: 50255203ms",
    );
    expect(result.close).toBe(true);
    expect(result.reason).toBe("not_planned");
    expect(result.comment).toContain("#17841");
  });

  test("detects WASM IPInt crash by address suffix from issue #17841", () => {
    const result = runPattern("Segmentation fault at address 0x7F7146505845");
    expect(result.close).toBe(true);
    expect(result.reason).toBe("not_planned");
    expect(result.comment).toContain("#17841");
  });

  test("does not false-positive on different segfault addresses", () => {
    expect(runPattern("Segmentation fault at address 0x7FA746505846").close).toBe(false);
    expect(runPattern("Segmentation fault at address 0x12345678").close).toBe(false);
    expect(runPattern("Segmentation fault at address 0xDEADBEEF").close).toBe(false);
  });

  test("does not false-positive on segmentation fault without address", () => {
    expect(runPattern("Segmentation fault happened").close).toBe(false);
  });
});
