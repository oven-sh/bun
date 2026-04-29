// Regression: panic on Windows when the HTTP client thread fails to start
// reported only "Unexpected" because std.Thread.spawn discards the Win32
// error code in its Windows backend (an `errdefer HeapFree` runs between
// CreateThread failing and the caller's `catch`, clobbering GetLastError).
//
// HTTPThread now hand-rolls the CreateThread path so it captures
// GetLastError at the failure site before any cleanup. This test exercises
// the pure message-formatter used in the panic path so the Win32 error
// code makes it into the panic message the reporter sees in bun.report.
//
// Refs:
//   https://github.com/oven-sh/bun/issues/29933
//   https://github.com/oven-sh/bun/issues/24878
//   https://github.com/oven-sh/bun/issues/22080
//   https://github.com/oven-sh/bun/issues/19085
//   https://github.com/oven-sh/bun/issues/14424

import { formatHttpThreadSpawnPanic } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

// Each row is one independent assertion on the formatter contract.
// `test.each` gives per-row failure output so regressions name the
// specific case that broke (vs. one failing batched `test`).
test.each([
  // Windows — message must include the captured Win32 code as hex.
  //   0x8 = ERROR_NOT_ENOUGH_MEMORY — the most likely cause of the
  //     reported crash (embedded runtime, commit-limit pressure).
  //   0x5af = ERROR_COMMITMENT_LIMIT — any arbitrary code round-trips
  //     as hex so future crash reports are actionable.
  //   0x0 = no error set — still reported so triage can distinguish
  //     "captured zero" from "captured nothing".
  //   0x2a = 42 = simulate a future std error name the formatter
  //     doesn't know about; it must still echo the name cleanly.
  ["SpawnFailed", 0x8, true, "Failed to start HTTP Client thread: SpawnFailed (Win32 error 0x8)"],
  ["Unexpected", 0x5af, true, "Failed to start HTTP Client thread: Unexpected (Win32 error 0x5af)"],
  ["Unexpected", 0, true, "Failed to start HTTP Client thread: Unexpected (Win32 error 0x0)"],
  ["NewKindOfErr", 42, true, "Failed to start HTTP Client thread: NewKindOfErr (Win32 error 0x2a)"],
  // Non-Windows — no Win32 code, keep the pre-fix message verbatim
  // so release notes see zero noise on Linux/macOS. `std.Thread.spawn`
  // passes `ThreadQuotaExceeded` / `SystemResources` through now
  // (no more blanket → Unexpected).
  ["ThreadQuotaExceeded", 0, false, "Failed to start HTTP Client thread: ThreadQuotaExceeded"],
  ["SystemResources", 0, false, "Failed to start HTTP Client thread: SystemResources"],
  ["LockedMemoryLimitExceeded", 0, false, "Failed to start HTTP Client thread: LockedMemoryLimitExceeded"],
  ["OutOfMemory", 0, false, "Failed to start HTTP Client thread: OutOfMemory"],
])("formatHttpThreadSpawnPanic(%j, %i, %j) → %j", (errName, code, isWindows, expected) => {
  expect(formatHttpThreadSpawnPanic(errName as string, code as number, isWindows as boolean)).toBe(expected as string);
});

// Defensive: out-of-range Win32 codes must clamp to 0 in the JS binding, so the
// panic message renders a predictable `0x0` rather than a truncated int.
test.each([
  // A code > u16::MAX (Win32 codes are u16 in Zig's Win32Error enum).
  [0x1_0000],
  // Another out-of-range value that happens to share low bits with a real code
  // — the clamp must not mistake it for 0x8 = ERROR_NOT_ENOUGH_MEMORY.
  [0x10008],
  // Negative — JS numbers can go negative, must not underflow into u16.
  [-1],
])("formatHttpThreadSpawnPanic clamps out-of-range code %i to 0", code => {
  expect(formatHttpThreadSpawnPanic("Unexpected", code, true)).toBe(
    "Failed to start HTTP Client thread: Unexpected (Win32 error 0x0)",
  );
});

// Defensive: if an absurdly long error name would overflow the 256-byte
// scratch buffer, the formatter must return the static fallback string
// rather than leaking uninitialized stack memory (the original form of
// this function did the latter, flagged by coderabbit).
test("formatHttpThreadSpawnPanic returns static fallback on overflow", () => {
  const longName = "X".repeat(512);
  expect(formatHttpThreadSpawnPanic(longName, 0x8, true)).toBe("Failed to start HTTP Client thread");
  expect(formatHttpThreadSpawnPanic(longName, 0, false)).toBe("Failed to start HTTP Client thread");
});
