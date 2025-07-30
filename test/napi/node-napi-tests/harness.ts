import { spawn, spawnSync } from "bun";
import { bunExe, bunEnv, isCI, isMusl } from "../../harness";

// Tests that intentionally abort and should not generate core dumps when they abort
// due to a Node-API error
const abortingJsNativeApiTests = ["test_finalizer/test_fatal_finalize.js"];

export async function build(dir: string) {
  const child = spawn({
    cmd: [bunExe(), "x", "node-gyp@11", "rebuild", "--debug", "-j", "max", "--verbose"],
    cwd: dir,
    stderr: "pipe",
    stdout: "ignore",
    stdin: "inherit",
    env: {
      ...bunEnv,
      npm_config_target: "v24.3.0",
      CXXFLAGS: (bunEnv.CXXFLAGS ?? "") + (process.platform == "win32" ? " -std=c++20" : " -std=gnu++20"),
      // on linux CI, node-gyp will default to g++ and the version installed there is very old,
      // so we make it use clang instead
      ...(process.platform == "linux" && isCI
        ? {
            CC: !isMusl ? "/usr/lib/llvm-19/bin/clang" : "/usr/lib/llvm19/bin/clang",
            CXX: !isMusl ? "/usr/lib/llvm-19/bin/clang++" : "/usr/lib/llvm19/bin/clang++",
          }
        : {}),
    },
  });
  await child.exited;
  if (child.exitCode !== 0) {
    const stderr = await new Response(child.stderr).text();
    console.error(`node-gyp rebuild in ${dir} failed:\n${stderr}`);
    console.error("bailing out!");
    process.exit(1);
  }
}

export function run(dir: string, test: string) {
  const env = abortingJsNativeApiTests.includes(test)
    ? { ...bunEnv, BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT: "1" }
    : bunEnv;
  const result = spawnSync({
    cmd: [bunExe(), "run", test],
    cwd: dir,
    stderr: "inherit",
    stdout: "ignore",
    stdin: "inherit",
    env,
  });
  expect(result.success).toBeTrue();
  expect(result.exitCode).toBe(0);
}
