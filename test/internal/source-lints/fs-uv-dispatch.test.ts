import { expect, test } from "bun:test";
import path from "path";

// The `for_each_fs_uv_op!` x-macro in src/runtime/dispatch.rs stamps the
// Windows libuv fs-request dispatch arms. Its inner matches end in a wildcard
// whose unreachability rests on the outer match guard listing exactly the
// same tags (#30787). Two invariants keep that wildcard from becoming
// release-build UB:
//
// 1. Every consumer derives its outer or-pattern from the table via
//    `for_each_fs_uv_op!(__fs_pat)`. A hand-written
//    `task_tag::Open | task_tag::Close | ...` list can silently drift when a
//    row is added, making the inner `unreachable_unchecked()` reachable.
//
// 2. The inner-match wildcards panic under `cfg!(debug_assertions)` before
//    falling through to `unreachable_unchecked()`, so a dispatch regression
//    surfaces as a controlled crash in debug/ASAN builds instead of UB.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const source = await Bun.file(path.join(root, "src/runtime/dispatch.rs")).text();

test("fs-uv consumers derive their or-patterns from the table", () => {
  // Both the run_task arm and the shutdown-release arm must expand the guard
  // from the macro, never hand-write the tag list.
  const generated = source.match(/for_each_fs_uv_op!\(__fs_pat\)/g) ?? [];
  expect(generated.length).toBeGreaterThanOrEqual(2);

  // A hand-written multi-tag or-pattern over the uv fs tags is the drift
  // hazard this lint exists to reject.
  expect(source).not.toMatch(/task_tag::Open\s*\n?\s*\|\s*task_tag::Close/);
});

test("fs-uv inner-match wildcards panic in debug builds before unreachable_unchecked", () => {
  // Each inner dispatch macro (`__fs_run`, `__fs_release`) spans from its
  // `macro_rules!` definition to the `for_each_fs_uv_op!` invocation that
  // expands it. Within that span, the wildcard must contain the
  // `cfg!(debug_assertions)` panic guard.
  for (const name of ["__fs_run", "__fs_release"]) {
    const start = source.indexOf(`macro_rules! ${name}`);
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf(`for_each_fs_uv_op!(${name})`, start);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).toContain("core::hint::unreachable_unchecked()");
    expect(body).toContain("cfg!(debug_assertions)");
  }
});
