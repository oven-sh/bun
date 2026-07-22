// Build the winsysfuzz interception DLL + tools (Windows, MSVC via CMake).
//
//   bun build.ts            # codegen + configure (if needed) + Release build
//   bun build.ts --clean    # wipe build/ first
//
// Runs the syscall codegen (NtTrace.cfg -> generated hook table), then
// drives CMake: configure into ./build once, build the Release config.
// Outputs land in build/Release/{winsysfuzz.dll, wsfrun.exe, wsfsym.exe}.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;
const buildDir = join(here, "build");
if (process.argv.includes("--clean") && existsSync(buildDir)) rmSync(buildDir, { recursive: true, force: true });

const run = (cmd: string[], label: string) => {
  console.log(`[build] ${label}: ${cmd.join(" ")}`);
  const r = Bun.spawnSync(cmd, { cwd: here, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) {
    console.error(`[build] ${label} FAILED (exit ${r.exitCode})`);
    process.exit(r.exitCode ?? 1);
  }
};

// 1. Codegen: regenerate src/generated/hooks.gen.{h,cpp} + the manifest.
run([process.execPath, "codegen.ts"], "codegen");

// 2. Configure once (Visual Studio generator, x64), reconfigure on demand.
if (!existsSync(join(buildDir, "CMakeCache.txt"))) run(["cmake", "-S", ".", "-B", "build", "-A", "x64"], "configure");

// 3. Build the Release configuration.
run(["cmake", "--build", "build", "--config", "Release", "--parallel"], "build");
console.log("[build] done -> build/Release/{winsysfuzz.dll, wsfrun.exe, wsfsym.exe}");
