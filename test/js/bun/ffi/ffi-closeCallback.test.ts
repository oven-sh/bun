import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("FFI.closeCallback throws on invalid arguments instead of crashing", () => {
  const result = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      'const c = Bun.FFI.closeCallback; for (const a of [208,0,-1,65536.5,2**56,null,undefined,"x",{},NaN,Infinity,-Infinity,true]) { try { c(a); process.exit(1); } catch(e) { if (!e.message.includes("FFI callback")) process.exit(1); } } console.log("ok");',
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.stdout.toString().trim()).toBe("ok");
  expect(result.exitCode).toBe(0);
}, 30_000);
