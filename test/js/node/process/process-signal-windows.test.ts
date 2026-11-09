// What a console has to say to its processes is a signal to JavaScript, as in Node.js:
//   CTRL_C_EVENT     → SIGINT
//   CTRL_BREAK_EVENT → SIGBREAK
//   CTRL_CLOSE_EVENT → SIGHUP

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { release } from "node:os";

// Windows build number ("10.0.17763" is Server 2019, "10.0.26100" is 11 24H2).
const windowsBuild = isWindows ? Number(release().split(".")[2]) : 0;

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

test.skipIf(!isWindows)("Ctrl+Break is SIGBREAK", async () => {
  const script = `
    process.on("SIGBREAK", signal => process.exit(signal === "SIGBREAK" ? 9 : 1));
    setInterval(() => {}, 1 << 30);
    const CTRL_BREAK_EVENT = 1;
    require("bun:ffi")
      .dlopen("kernel32.dll", { GenerateConsoleCtrlEvent: { args: ["u32", "u32"], returns: "i32" } })
      .symbols.GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, 0);
  `;
  await using terminal = new Bun.Terminal({ data() {} });
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, terminal });
  expect(await proc.exited).toBe(9);
});

// On Server 2019 a process hears nothing when the pseudoconsole it runs on is closed.
test.skipIf(!isWindows).todoIf(windowsBuild < 20348)("the end of the console is SIGHUP", async () => {
  const script = `
    process.on("SIGHUP", signal => process.exit(signal === "SIGHUP" ? 9 : 1));
    setInterval(() => {}, 1 << 30);
    process.stdout.write("READY;");
  `;
  const ready = Promise.withResolvers<void>();
  let output = "";
  await using terminal = new Bun.Terminal({
    data(_, chunk: Uint8Array) {
      output += Buffer.from(chunk).toString("latin1");
      if (output.includes("READY;")) ready.resolve();
    },
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, terminal });
  proc.exited.then(code => ready.reject(new Error(`exited with code ${code}: ${JSON.stringify(output)}`)));

  await ready.promise;
  terminal.close();
  expect(await proc.exited).toBe(9);
});
