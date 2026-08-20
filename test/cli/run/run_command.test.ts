import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";

let cwd: string;

describe("bun", () => {
  test("should error with missing script", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "run", "dev"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toMatch(/Script not found/);
    expect(exitCode).toBe(1);
  });

  test("an empty-string script value is not a runnable script", () => {
    using dir = tempDir("empty-script", {
      "package.json": JSON.stringify({ scripts: { build: "" } }),
    });
    // Zig `asPropertyStringMap` drops empty-valued script entries; an empty
    // `build` must report "Script not found" and exit 1, not run an empty
    // `$ ` command and exit 0. (npm runs empty scripts and exits 0 — Bun
    // intentionally diverges here to match its own prior/Zig behavior.)
    const { exitCode, stdout, stderr } = spawnSync({
      cwd: String(dir),
      cmd: [bunExe(), "run", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toMatch(/Script not found/);
    expect(exitCode).toBe(1);
  });
});

test.if(isWindows)("[windows] A file in drive root runs", async () => {
  const path = "C:\\root-file" + Math.random().toString().slice(2) + ".js";
  try {
    writeFileSync(path, "console.log(`PASS`);");
    const { stdout } = await bunRun("C:\\root-file.js", {});
    expect(stdout).toBe("PASS");
  } catch {
    rmSync(path);
  }
});

// Ctrl+C on a terminal reaches `bun run` and the script together (same pgroup /
// same console). `bun run` must leave it to the script and report its exit; on
// Windows it used to die first with STATUS_CONTROL_C_EXIT. The script raises the
// Ctrl+C itself once it is listening: system conhost's ConPTY does not turn a
// written "\x03" into CTRL_C_EVENT, so on Windows it calls
// GenerateConsoleCtrlEvent on its own (pseudo)console; on POSIX it signals its
// own foreground process group, which is what the line discipline does for ^C.
for (const shell of ["bun", "system"] as const) {
  test.concurrent(`Ctrl+C is left to the script and bun run reports its exit (--shell=${shell})`, async () => {
    using dir = tempDir("run-ctrl-c", {
      "package.json": JSON.stringify({ name: "t", scripts: { go: "bun child.js" } }),
      "child.js": `
        process.on("SIGINT", () => {
          console.log("child got SIGINT");
          process.exit(42);
        });
        setInterval(() => {}, 1000);
        if (process.platform === "win32") {
          const { dlopen } = require("bun:ffi");
          const k32 = dlopen("kernel32.dll", {
            GenerateConsoleCtrlEvent: { args: ["u32", "u32"], returns: "i32" },
          });
          if (k32.symbols.GenerateConsoleCtrlEvent(0, 0) === 0) throw new Error("GenerateConsoleCtrlEvent failed");
        } else {
          process.kill(0, "SIGINT");
        }
      `,
    });

    let output = "";
    const decoder = new TextDecoder();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", `--shell=${shell}`, "go"],
      cwd: String(dir),
      env: bunEnv,
      // Own session / pseudoconsole, so the Ctrl+C stays between `bun run` and the script.
      terminal: {
        cols: 200,
        rows: 24,
        data(_t, chunk: Uint8Array) {
          output += decoder.decode(chunk, { stream: true });
        },
      },
    });

    const exitCode = await proc.exited;
    proc.terminal?.close();
    output += decoder.decode();

    expect(Bun.stripANSI(output)).toContain("child got SIGINT");
    expect(exitCode).toBe(42);
  });

  // ...and if the script *dies* of the Ctrl+C, `bun run` stops there and ends the
  // same way (bash's wait-and-cooperative-exit) rather than running the next command.
  test.concurrent(`a script killed by Ctrl+C stops bun run (--shell=${shell})`, async () => {
    using dir = tempDir("run-ctrl-c-dies", {
      "package.json": JSON.stringify({
        name: "t",
        scripts: { go: 'bun child.js; bun -e "console.log(String.fromCharCode(78,79,80,69))"' },
      }),
      "child.js": `
        setInterval(() => {}, 1000);
        console.log("ready");
        if (process.platform === "win32") {
          const { dlopen } = require("bun:ffi");
          const k32 = dlopen("kernel32.dll", {
            GenerateConsoleCtrlEvent: { args: ["u32", "u32"], returns: "i32" },
          });
          if (k32.symbols.GenerateConsoleCtrlEvent(0, 0) === 0) throw new Error("GenerateConsoleCtrlEvent failed");
        } else {
          process.kill(0, "SIGINT");
        }
      `,
    });

    let output = "";
    const decoder = new TextDecoder();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", `--shell=${shell}`, "go"],
      cwd: String(dir),
      env: bunEnv,
      terminal: {
        cols: 200,
        rows: 24,
        data(_t, chunk: Uint8Array) {
          output += decoder.decode(chunk, { stream: true });
        },
      },
    });

    const exitCode = await proc.exited;
    proc.terminal?.close();
    output += decoder.decode();

    const text = Bun.stripANSI(output);
    expect(text).toContain("ready");
    expect(text).not.toContain("NOPE");
    if (isWindows) {
      expect(exitCode).toBe(0xc000013a); // STATUS_CONTROL_C_EXIT
    } else {
      expect(proc.signalCode).toBe("SIGINT");
    }
  });
}
