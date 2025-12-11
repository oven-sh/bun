import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("SIGUSR1 inspector activation", () => {
  test("user SIGUSR1 listener takes precedence over inspector activation", async () => {
    using dir = tempDir("sigusr1-test", {
      "test.js": `
        const fs = require("fs");
        const path = require("path");

        process.on("SIGUSR1", () => {
          console.log("USER_HANDLER_CALLED");
          setTimeout(() => process.exit(0), 100);
        });

        fs.writeFileSync(path.join(process.cwd(), "pid"), String(process.pid));
        console.log("READY");

        setInterval(() => {}, 1000);
      `,
    });

    await using proc = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();

    let output = "";
    while (!output.includes("READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += new TextDecoder().decode(value);
    }

    const pid = parseInt(await Bun.file(join(String(dir), "pid")).text(), 10);

    process.kill(pid, "SIGUSR1");

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output += new TextDecoder().decode(value);
    }

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(output).toContain("USER_HANDLER_CALLED");
    expect(stderr).not.toContain("Debugger listening");
    expect(exitCode).toBe(0);
  });
});
