// Windows console-control → signal mapping.
//
// libuv's uv__signal_control_handler (src/win/signal.c) maps:
//   CTRL_C_EVENT     → SIGINT
//   CTRL_BREAK_EVENT → SIGBREAK
//   CTRL_CLOSE_EVENT → SIGHUP
//
// process.on('SIGHUP'/'SIGBREAK') must therefore create a uv_signal_t on
// Windows so those console events reach JS, matching Node.js.

import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { bunEnv, bunExe, isArm64, isWindows } from "harness";

// bun:ffi (TinyCC) is unavailable on Windows arm64.
test.skipIf(!isWindows || isArm64)(
  "process.on('SIGHUP') receives CTRL_CLOSE_EVENT when the console window closes",
  async () => {
    // GenerateConsoleCtrlEvent cannot send CTRL_CLOSE_EVENT, but conhost
    // translates WM_CLOSE on a console window into CTRL_CLOSE_EVENT for every
    // attached process — exactly what clicking the window's ✕ does. The child
    // allocates its OWN console so closing it cannot affect the test runner.
    const child = spawn(
      bunExe(),
      [
        "-e",
        /* js */ `
        const { dlopen } = require("bun:ffi");
        const k32 = dlopen("kernel32.dll", {
          FreeConsole:      { args: [], returns: "i32" },
          AllocConsole:     { args: [], returns: "i32" },
          GetConsoleWindow: { args: [], returns: "ptr" },
        });
        const u32 = dlopen("user32.dll", {
          PostMessageW: { args: ["ptr", "u32", "usize", "isize"], returns: "i32" },
        });

        // Detach from any inherited console, then create our own.
        k32.symbols.FreeConsole();
        if (!k32.symbols.AllocConsole()) {
          console.log("skip: AllocConsole failed");
          process.exit(0);
        }

        process.on("SIGHUP", sig => {
          console.log("received", sig);
          process.exit(0);
        });

        const hwnd = k32.symbols.GetConsoleWindow();
        if (!hwnd) {
          console.log("skip: no console window");
          process.exit(0);
        }

        // WM_CLOSE on the console window → conhost sends CTRL_CLOSE_EVENT →
        // libuv dispatches SIGHUP.
        const WM_CLOSE = 0x0010;
        u32.symbols.PostMessageW(hwnd, WM_CLOSE, 0n, 0n);

        // Keep the event loop alive so the signal can be delivered.
        setInterval(() => {}, 1000);
      `,
      ],
      // windowsHide → CREATE_NO_WINDOW so the child starts with no inherited
      // console; FreeConsole() above is then a harmless no-op.
      { env: bunEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );

    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8").on("data", d => (stdout += d));
    child.stderr!.setEncoding("utf8").on("data", d => (stderr += d));

    const code = await new Promise<number | null>(r => child.on("close", r));

    if (stdout.includes("skip:")) {
      console.warn("environment cannot allocate a console; skipping:", stdout.trim());
      return;
    }

    expect(stderr).toBe("");
    expect(stdout).toContain("received SIGHUP");
    expect(code).toBe(0);
  },
);

test.skipIf(!isWindows || isArm64)("process.on('SIGBREAK') receives CTRL_BREAK_EVENT", async () => {
  // detached → UV_PROCESS_DETACHED → CREATE_NEW_PROCESS_GROUP, so
  // GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid) targets only the child.
  const child = spawn(
    bunExe(),
    [
      "-e",
      /* js */ `
      process.on("SIGBREAK", sig => { console.log("received", sig); process.exit(0); });
      setInterval(() => {}, 1000);
      console.log("ready");
    `,
    ],
    { env: bunEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );

  let stdout = "";
  let stderr = "";
  child.stdout!.setEncoding("utf8").on("data", d => (stdout += d));
  child.stderr!.setEncoding("utf8").on("data", d => (stderr += d));

  await new Promise<void>(resolve => {
    child.stdout!.on("data", () => stdout.includes("ready") && resolve());
  });

  const { dlopen } = require("bun:ffi");
  const k32 = dlopen("kernel32.dll", {
    GenerateConsoleCtrlEvent: { args: ["u32", "u32"], returns: "i32" },
  });
  const CTRL_BREAK_EVENT = 1;
  if (!k32.symbols.GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, child.pid!)) {
    child.kill();
    console.warn("GenerateConsoleCtrlEvent failed (no shared console); skipping");
    return;
  }

  const code = await new Promise<number | null>(r => child.on("close", r));
  expect(stderr).toBe("");
  expect(stdout).toContain("received SIGBREAK");
  expect(code).toBe(0);
});
