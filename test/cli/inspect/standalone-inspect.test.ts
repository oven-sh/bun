import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("standalone executables ignore VSCode inspector env vars", () => {
  test("BUN_INSPECT is ignored in standalone executables", () => {
    using dir = tempDir("standalone-inspect", {
      "entry.ts": `
        // If the inspector were enabled, this would hang waiting for a connection.
        // We verify it runs and exits normally despite BUN_INSPECT being set.
        console.log("EXIT_OK");
      `,
    });

    const exePath = String(dir) + "/app";

    // Compile
    const build = spawnSync({
      cmd: [bunExe(), "build", "--compile", String(dir) + "/entry.ts", "--outfile", exePath],
      env: bunEnv,
    });
    expect(build.exitCode).toBe(0);

    // Run with BUN_INSPECT set (as VSCode would set it in a debug terminal).
    // In a non-standalone binary, this would enable the inspector and print
    // inspector banner to stderr. In standalone, it should be ignored.
    const result = spawnSync({
      cmd: [exePath],
      env: {
        ...bunEnv,
        BUN_INSPECT: "ws+unix:///tmp/fake-vscode-socket.sock?break=1",
        BUN_INSPECT_NOTIFY: "unix:///tmp/fake-vscode-notify.sock",
        BUN_INSPECT_CONNECT_TO: "",
      },
      timeout: 5_000,
    });

    expect(result.stdout.toString()).toContain("EXIT_OK");
    expect(result.exitCode).toBe(0);
  });

  test("BUN_OPTIONS still works in standalone executables", () => {
    using dir = tempDir("standalone-inspect-options", {
      "entry.ts": `
        // Verify BUN_OPTIONS is still processed in standalone executables.
        console.log(JSON.stringify(process.execArgv));
      `,
    });

    const exePath = String(dir) + "/app";

    // Compile
    const build = spawnSync({
      cmd: [bunExe(), "build", "--compile", String(dir) + "/entry.ts", "--outfile", exePath],
      env: bunEnv,
    });
    expect(build.exitCode).toBe(0);

    // Run with BUN_OPTIONS=--smol (a harmless flag we can detect via execArgv)
    const result = spawnSync({
      cmd: [exePath],
      env: {
        ...bunEnv,
        BUN_OPTIONS: "--smol",
      },
      timeout: 5_000,
    });

    expect(result.stdout.toString()).toContain("--smol");
    expect(result.exitCode).toBe(0);
  });
});
