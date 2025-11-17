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
console.log([1, proc.exitCode, proc.signalCode]);

proc = Bun.spawn({
  cmd: [bunExe(), "install"],
  stdio: ["ignore", "inherit", "inherit"],
  cwd: join(cwd, "app"),
  env: bunEnv,
});
await proc.exited;
console.log([2, proc.exitCode, proc.signalCode]);

proc = Bun.spawn({
  cmd: [bunExe(), "--bun", "run", "build"],
  stdio: ["ignore", "inherit", "inherit"],
  cwd: join(cwd, "app"),
  env: bunEnv,
});
await proc.exited;
console.log([3, proc.exitCode, proc.signalCode]);
