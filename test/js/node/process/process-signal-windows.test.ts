// What a console has to say to its processes is a signal to JavaScript, as in Node.js:
//   CTRL_C_EVENT     → SIGINT
//   CTRL_BREAK_EVENT → SIGBREAK
//   CTRL_CLOSE_EVENT → SIGHUP

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// process.kill(pid, name) looks `name` up where process.on(name, fn) does.
test.skipIf(!isWindows)("SIGHUP and SIGBREAK are recognised as signal names on Windows", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const os = require("node:os");
      if (os.constants.signals.SIGHUP !== 1) throw new Error("SIGHUP constant wrong");
      if (os.constants.signals.SIGBREAK !== 21) throw new Error("SIGBREAK constant wrong");

      for (const sig of ["SIGHUP", "SIGBREAK"]) {
        // Registering a listener must not throw.
        const fn = () => {};
        process.on(sig, fn);
        process.off(sig, fn);

        // Resolving the name in process.kill must not throw ERR_UNKNOWN_SIGNAL.
        // (Neither can be sent on Windows: ENOSYS, which matches Node.js.)
        try {
          process.kill(process.pid, sig);
          console.log(sig, "no error");
        } catch (e) {
          console.log(sig, e.code ?? e.message);
        }
      }
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).not.toContain("ERR_UNKNOWN_SIGNAL");
  expect(stdout.trim().split("\n")).toEqual(["SIGHUP ENOSYS", "SIGBREAK ENOSYS"]);
  expect(exitCode).toBe(0);
});

test.skipIf(!isWindows)("Ctrl+Break is SIGBREAK and the end of the console is SIGHUP", async () => {
  using dir = tempDir("process-signal-windows", {});
  const script = `
    const fs = require("node:fs");
    const say = line => fs.appendFileSync("said.txt", line + "\\n");
    process.on("SIGBREAK", signal => {
      say(signal);
      process.stdout.write("BROKE;");
    });
    process.on("SIGHUP", signal => {
      say(signal);
      process.exit(9);
    });
    setInterval(() => {}, 1 << 30);
    const CTRL_BREAK_EVENT = 1;
    require("bun:ffi")
      .dlopen("kernel32.dll", { GenerateConsoleCtrlEvent: { args: ["u32", "u32"], returns: "i32" } })
      .symbols.GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, 0);
  `;
  const broke = Promise.withResolvers<void>();
  let output = "";
  await using terminal = new Bun.Terminal({
    data(_, chunk: Uint8Array) {
      output += Buffer.from(chunk).toString("latin1");
      if (output.includes("BROKE;")) broke.resolve();
    },
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, cwd: String(dir), terminal });
  proc.exited.then(code => broke.reject(new Error(`exited with code ${code}: ${JSON.stringify(output)}`)));
  // Ends a child that a signal does not reach while the test can still report how far it got.
  const watchdog = setTimeout(() => proc.kill(), 20_000);

  await broke.promise;
  terminal.close();
  const exitCode = await proc.exited;
  clearTimeout(watchdog);
  expect(readFileSync(join(String(dir), "said.txt"), "utf8")).toBe("SIGBREAK\nSIGHUP\n");
  expect(exitCode).toBe(9);
});
