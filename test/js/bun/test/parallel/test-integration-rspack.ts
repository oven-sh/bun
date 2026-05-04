import { expect } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

const cwd = tmpdirSync();
console.log([0, cwd]);

let proc = Bun.spawn({
  // Pinned: rsbuild 2.0.x bundles mimalloc v3 inside @rspack/binding-win32-arm64-msvc.
  // Two static mimalloc instances in one process deterministically segfault in ntdll
  // during ExitProcess on Windows arm64 (FLS / process-detach cleanup). Tracked
  // separately; this test exists to guard the napi TSFN finalizer, not rsbuild HEAD.
  cmd: [bunExe(), "create", "rsbuild@1", "app", "--template", "solid-ts"],
  stdio: ["ignore", "inherit", "inherit"],
  cwd,
  env: bunEnv,
});
await proc.exited;
console.log([1]);
expect(proc.signalCode).toBeNull();
expect(proc.exitCode).toBe(0);

proc = Bun.spawn({
  cmd: [bunExe(), "install"],
  stdio: ["ignore", "inherit", "inherit"],
  cwd: join(cwd, "app"),
  env: bunEnv,
});
await proc.exited;
console.log([2]);
expect(proc.signalCode).toBeNull();
expect(proc.exitCode).toBe(0);

proc = Bun.spawn({
  cmd: [bunExe(), "--bun", "run", "build"],
  stdio: ["ignore", "inherit", "inherit"],
  cwd: join(cwd, "app"),
  env: bunEnv,
});
await proc.exited;
console.log([3]);
expect(proc.signalCode).toBeNull();
expect(proc.exitCode).toBe(0);
