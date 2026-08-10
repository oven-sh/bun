import type { Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import {
  cdpClient,
  connectInspector,
  countBanners,
  hasBanner,
  IDLE,
  inspecteeEnv,
  readStreamToEnd,
  readStreamUntil,
  spawnTarget,
  waitForBanner,
  wsUrlFromBanner,
} from "./helpers";

describe.skipIf(isWindows).concurrent("SIGUSR1 activation", () => {
  test("kill -USR1 activates the inspector", async () => {
    const { proc, pid } = await spawnTarget(IDLE);
    await using _ = proc;

    process.kill(pid, "SIGUSR1");

    expect(await waitForBanner(proc)).toMatch(/ws:\/\/localhost:\d+\//);
  });

  test("a process can signal itself", async () => {
    // The handler then runs on the JS thread itself, while it is still inside
    // kill(2); setImmediate runs after startup has armed the handler.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--inspect-port=0",
        "-e",
        `setImmediate(() => process.kill(process.pid, "SIGUSR1")); setInterval(() => {}, 1000);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await waitForBanner(proc)).toMatch(/ws:\/\/localhost:\d+\//);
  });

  test("a second SIGUSR1 does not start a second inspector", async () => {
    const { proc, pid } = await spawnTarget(IDLE);
    await using _ = proc;

    process.kill(pid, "SIGUSR1");
    const reader = proc.stderr.getReader();
    let stderr = await readStreamUntil(reader, hasBanner);

    process.kill(pid, "SIGUSR1");
    // A CDP round trip proves the target's event loop has turned since the
    // second signal landed, so a second banner would be visible by now.
    const ws = await connectInspector(wsUrlFromBanner(stderr));
    try {
      const result = await cdpClient(ws)("Runtime.evaluate", { expression: "6 * 7" });
      expect(result.result.result.value).toBe(42);
    } finally {
      ws.close();
    }

    proc.kill();
    stderr = await readStreamToEnd(reader, stderr);
    reader.releaseLock();

    expect(countBanners(stderr)).toBe(1);
  });

  test("a user SIGUSR1 listener takes precedence", async () => {
    const { proc, pid } = await spawnTarget(
      `console.log(process.pid);
       let n = 0;
       process.on("SIGUSR1", () => { console.log("user " + ++n); if (n === 3) process.exit(0); });
       setInterval(() => {}, 1000);`,
    );
    await using _ = proc;

    const reader = proc.stdout.getReader();
    let stdout = "";
    for (let i = 1; i <= 3; i++) {
      process.kill(pid, "SIGUSR1");
      stdout += await readStreamUntil(reader, s => s.includes(`user ${i}`));
    }
    // The third signal makes the target exit, so stdout reaches EOF.
    stdout = await readStreamToEnd(reader, stdout);
    reader.releaseLock();
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect({ stdout, banners: countBanners(stderr), exitCode }).toEqual({
      stdout: "user 1\nuser 2\nuser 3\n",
      banners: 0,
      exitCode: 0,
    });
  });

  test("removing the last user listener hands SIGUSR1 back to the inspector", async () => {
    const { proc, pid } = await spawnTarget(
      `console.log(process.pid);
       const onSignal = () => { console.log("user"); process.off("SIGUSR1", onSignal); console.log("removed"); };
       process.on("SIGUSR1", onSignal);
       setInterval(() => {}, 1000);`,
    );
    await using _ = proc;

    const stdoutReader = proc.stdout.getReader();
    process.kill(pid, "SIGUSR1");
    const stdout = await readStreamUntil(stdoutReader, s => s.includes("removed"));
    stdoutReader.releaseLock();
    expect(stdout).toBe("user\nremoved\n");

    process.kill(pid, "SIGUSR1");

    expect(await waitForBanner(proc)).toMatch(/ws:\/\/localhost:\d+\//);
  });

  // With the inspector already configured from the command line there is
  // nothing for SIGUSR1 to do; it must neither print a second banner nor
  // terminate the process (the default action).
  test.each(["--inspect=0", "--inspect-wait=0", "--inspect-brk=0"])("SIGUSR1 is ignored under %s", async flag => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), flag, "-e", IDLE],
      env: inspecteeEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    await expectSigusr1Ignored(proc);
  });

  test("SIGUSR1 is still ignored under --inspect after a user listener is added and removed", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--inspect=0",
        "-e",
        `const onSignal = () => {};
         process.on("SIGUSR1", onSignal);
         process.off("SIGUSR1", onSignal);
         ${IDLE}`,
      ],
      env: inspecteeEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // IDLE prints the pid, so a stdout line means the listener has come and gone.
    const stdoutReader = proc.stdout.getReader();
    await readStreamUntil(stdoutReader, s => s.includes("\n"));
    stdoutReader.releaseLock();

    await expectSigusr1Ignored(proc);
  });
});

async function expectSigusr1Ignored(proc: Subprocess<any, "pipe", "pipe">) {
  const reader = proc.stderr.getReader();
  let stderr = await readStreamUntil(reader, hasBanner);

  process.kill(proc.pid, "SIGUSR1");
  // Any CDP connection works as the "loop has turned" ack; under -wait/-brk
  // this is also what lets the target proceed to exit cleanly below.
  const ws = await connectInspector(wsUrlFromBanner(stderr));
  try {
    const result = await cdpClient(ws)("Runtime.evaluate", { expression: "6 * 7" });
    expect(result.result.result.value).toBe(42);
  } finally {
    ws.close();
  }

  proc.kill();
  stderr = await readStreamToEnd(reader, stderr);
  reader.releaseLock();
  await proc.exited;

  expect({ banners: countBanners(stderr), signalCode: proc.signalCode }).toEqual({
    banners: 1,
    signalCode: "SIGTERM",
  });
}
