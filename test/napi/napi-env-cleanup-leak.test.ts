import { spawnSync } from "bun";
import { beforeAll, expect, it } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons, isASAN, isWindows } from "harness";
import { join } from "path";

const napiAppDir = join(__dirname, "napi-app");
const addonName = "napitests";
const addonPath = join(napiAppDir, `build/Debug/${addonName}.node`);

// Lives outside napi.test.ts so that it only depends on the one addon it uses.
// Same build strategy as napi-finalizer-delete-ref.test.ts: napi.test.ts (or a
// previous run) has usually built the addon already, and it does not link
// against bun, so an existing binary is still valid; otherwise build just this
// target, falling back to napi-app's full install script.
beforeAll(() => {
  if (!canBuildNodeAddons() || !isASAN || isWindows || existsSync(addonPath)) return;
  const run = (cmd: string[]) =>
    spawnSync({ cmd, cwd: napiAppDir, env: bunEnv, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  if (!existsSync(join(napiAppDir, "node_modules/node-gyp"))) {
    run([bunExe(), "install", "--ignore-scripts"]);
  }
  run([bunExe(), "--bun", "node-gyp", "configure", "build", "--debug", "-j", "max", addonName]);
  if (!existsSync(addonPath)) {
    run([bunExe(), "install"]);
  }
  if (!existsSync(addonPath)) {
    throw new Error(`building ${addonName} failed`);
  }
}, 300_000);

// create_ref_with_finalizer never deletes the reference napi_wrap handed out,
// as addons commonly do with a constructor reference. That reference keeps the
// env alive past exit, so ~NapiEnv never runs; the env's cleanup has to be what
// releases the module file name process.dlopen() built for it. Checked with
// LeakSanitizer the way CI runs the ASAN build.
it.skipIf(!canBuildNodeAddons() || !isASAN || isWindows)(
  "an env kept alive by an undeleted reference does not leak its module file name",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `require(${JSON.stringify(addonPath)}).create_ref_with_finalizer(true);`],
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(__dirname, "../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  },
  // On a failure LSan symbolizes the report, which takes a while with the debug binary.
  90_000,
);
