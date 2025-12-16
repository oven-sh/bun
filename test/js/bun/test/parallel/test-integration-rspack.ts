import { expect } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

const cwd = tmpdirSync();
console.log([0, cwd]);

let proc = Bun.spawn({
  cmd: [bunExe(), "create", "rsbuild@latest", "app", "--template", "solid-ts"],
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
