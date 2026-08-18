import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import path from "node:path";

// The fuzzilli REPRL wrapper (src/js/eval/fuzzilli-reprl.ts) executes
// fuzzer-generated scripts in-process. A payload that kills the process, or
// that gets the wrapper to speak the REPRL protocol a second time, makes
// fuzzilli report a crash for whatever script happens to run next.
const reprlPath = path.join(import.meta.dir, "..", "..", "..", "..", "src", "js", "eval", "fuzzilli-reprl.ts");

async function run(cmd: string[]) {
  await using proc = Bun.spawn({
    cmd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout), stderr: normalizeBunSnapshot(stderr), exitCode };
}

function runFixture(scenario: string) {
  return run([bunExe(), path.join(import.meta.dir, "fuzzilli-reprl.fixture.ts"), scenario]);
}

// process.execve either replaces the process image or aborts, so the wrapper
// stubs it out before the loop starts.
test.concurrent("REPRL loop survives a payload that calls process.execve", async () => {
  expect(await runFixture("execve")).toEqual({
    stdout: "CONTROL_WRITES=HELO,status=0,status=0 LIVE=true",
    stderr: "",
    exitCode: 0,
  });
});

// require(Bun.main + "?x") evaluates the wrapper again on the main thread. The
// second copy must throw before it writes its own HELO to the control FD.
test.concurrent("REPRL loop survives a payload that evaluates the wrapper again", async () => {
  expect(await runFixture("reenter")).toEqual({
    stdout: [
      "uncaught:Error: fuzzilli-reprl: the REPRL loop is already running in this process",
      "CONTROL_WRITES=HELO,status=256,status=0 LIVE=true",
    ].join("\n"),
    stderr: "",
    exitCode: 0,
  });
});

// new Worker(Bun.main) evaluates the wrapper on a second thread, with its own
// globals but the same FDs. That copy must stop before the handshake.
test.concurrent("wrapper evaluated in a Worker does not start a second REPRL loop", async () => {
  const result = await run([
    bunExe(),
    "-e",
    `
      const worker = new Worker(${JSON.stringify(reprlPath)});
      worker.addEventListener("error", event => {
        console.log(event.message.split("\\n").find(line => line.startsWith("error:")));
      });
      worker.addEventListener("close", event => console.log("close:", event.code));
    `,
  ]);
  expect(result).toEqual({
    stdout: ["error: fuzzilli-reprl: the REPRL loop is already running in this process", "close: 1"].join("\n"),
    stderr: "",
    exitCode: 0,
  });
});
