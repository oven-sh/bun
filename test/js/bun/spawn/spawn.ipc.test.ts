import { spawn } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, gcTick } from "harness";
import path from "path";

describe.each(["advanced", "json"])("ipc mode %s", mode => {
  it("the subprocess should be defined and the child should send", done => {
    gcTick();
    const returned_subprocess = spawn([bunExe(), path.join(__dirname, "bun-ipc-child.js")], {
      ipc: (message, subProcess) => {
        expect(subProcess).toBe(returned_subprocess);
        expect(message).toBe("hello");
        subProcess.kill();
        done();
        gcTick();
      },
      stdio: ["inherit", "inherit", "inherit"],
      serialization: mode,
    });
  });

  it("the subprocess should receive the parent message and respond back", done => {
    gcTick();

    const parentMessage = "I am your father";
    const childProc = spawn([bunExe(), path.join(__dirname, "bun-ipc-child-respond.js")], {
      ipc: (message, subProcess) => {
        expect(message).toBe(`pong:${parentMessage}`);
        subProcess.kill();
        done();
        gcTick();
      },
      stdio: ["inherit", "inherit", "inherit"],
      serialization: mode,
    });

    childProc.send(parentMessage);
    gcTick();
  });

  it("ipc works when preceded by a non-pipe extra stdio slot", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    await using child = spawn([bunExe(), path.join(__dirname, "bun-ipc-child.js")], {
      env: bunEnv,
      stdio: ["inherit", "inherit", "inherit", "ignore"],
      serialization: mode,
      ipc: message => resolve(message),
    });
    child.exited.then(code => reject(new Error(`exited ${code} before message`)));
    expect(await promise).toBe("hello");
  });
});

// handleIPCClose must clear `ipc_data`; computeHasPendingActivity() treats a
// non-null `ipc_data` as pending and keeps the JSRef Strong. If it is never
// cleared, the JSSubprocess is never collected and every spawn({ ipc }) leaks
// the Subprocess, its Process, stdio pipes, and the IPC SendQueue buffers.
test("Subprocess with ipc is collectable after the IPC channel closes", async () => {
  const script = /* js */ `
    let collected = 0;
    const registry = new FinalizationRegistry(() => {
      collected++;
    });

    const ITERS = 8;

    async function once() {
      const proc = Bun.spawn({
        cmd: [process.execPath, "-e", ""],
        env: process.env,
        stdio: ["ignore", "ignore", "ignore"],
        ipc: () => {},
      });
      await proc.exited;
      registry.register(proc, undefined);
    }

    for (let i = 0; i < ITERS; i++) {
      await once();
    }

    // Drive the event loop so the deferred _onAfterIPCClosed task fires
    // handleIPCClose, then GC. Without the fix, 0 are ever collected.
    for (let i = 0; i < 60 && collected < ITERS; i++) {
      await Bun.sleep(10);
      Bun.gc(true);
    }

    console.log(JSON.stringify({ collected, iters: ITERS }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const stderrLines = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(stderrLines).toBe("");
  const { collected, iters } = JSON.parse(stdout.trim());
  expect(collected).toBe(iters);
  expect(exitCode).toBe(0);
});
