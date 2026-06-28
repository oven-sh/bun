import { spawn, spawnSync } from "bun";
import { beforeAll, expect, it } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, canBuildNodeAddons, normalizeBunSnapshot } from "harness";
import { join } from "path";

const addonPath = join(__dirname, "napi-app/build/Debug/napitests.node");

beforeAll(() => {
  if (!canBuildNodeAddons()) return;
  // Build the native addons in napi-app, but only if the one this test needs
  // is missing (napi.test.ts or a previous run usually has built it already).
  // The addon doesn't link against bun, so an existing binary stays valid
  // across bun builds; skipping the install avoids re-running the node-gyp
  // rebuild, which is slow and occasionally flaky under resource pressure.
  if (existsSync(addonPath)) {
    return;
  }
  for (let attempt = 0; ; attempt++) {
    const install = spawnSync({
      cmd: [bunExe(), "install", "--verbose"],
      cwd: join(__dirname, "napi-app"),
      stderr: "inherit",
      env: bunEnv,
      stdout: "inherit",
      stdin: "inherit",
    });
    if (install.success && existsSync(addonPath)) {
      return;
    }
    if (attempt >= 1) {
      throw new Error("building napi-app addons failed");
    }
  }
}, 300_000);

it.skipIf(!canBuildNodeAddons())(
  "napi_close_handle_scope tolerates scopes closed out of order",
  async () => {
    // Closing handle scopes in the wrong order (or closing one whose enclosing
    // scope was already closed) is addon misbehavior, but Node-API reports such
    // errors through status codes. Node returns napi_ok (0) for every close in
    // this fixture and keeps running; Bun used to fail a release assertion
    // ("Unbalanced napi_handle_scope opens and closes") and abort.
    const { BUN_INSPECT_CONNECT_TO: _, ASAN_OPTIONS, ...rest } = bunEnv;
    await using proc = spawn({
      cmd: [
        bunExe(),
        join(__dirname, "napi-app/main.js"),
        "test_napi_handle_scope_out_of_order_close",
        JSON.stringify([]),
      ],
      env: {
        ...rest,
        // If the close wrongly aborts, die with a plain abort instead of
        // hanging in the crash reporter / ASAN symbolizer.
        ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=1:symbolize=0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    // stderr is drained (a blocked pipe would stall the child) but not asserted
    // on: debug and ASAN builds emit benign warnings there.
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // the statuses and output below are exactly what Node.js prints for this fixture
    expect({ stdout: normalizeBunSnapshot(stdout), exitCode }).toEqual({
      stdout: [
        "close outer status: 0",
        "close inner status: 0",
        "close escapable outer status: 0",
        "close escapable inner status: 0",
        "still alive",
      ].join("\n"),
      exitCode: 0,
    });
  },
  30_000,
);
