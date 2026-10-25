import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import path from "node:path";

// `bun fuzzilli` runs fuzzer-generated scripts in-process through the REPRL
// wrapper (src/js/eval/fuzzilli-reprl.ts). process.kill, process.abort and
// process.execve do nothing there, in every global. Status 0: the payload returned.
async function runPayload(payload: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fuzzilli-reprl.fixture.ts"), payload],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout, exitCode, signalCode: proc.signalCode };
}

const returned = { stdout: "STATUSES=0,0 LIVE=true\n", exitCode: 0, signalCode: null };

const workerSource =
  "self.onmessage = e => { process.kill(process.pid, 'SIGKILL'); process.abort(); " +
  "const done = new Int32Array(e.data); Atomics.store(done, 0, 1); Atomics.notify(done, 0); };";

test.concurrent.each([
  ["process.kill", `process.kill(process.pid, "SIGKILL");`],
  ["process.abort", `process.abort();`],
  [
    "process.kill and process.abort in a ShadowRealm",
    `new ShadowRealm().evaluate("process.kill(process.pid, 'SIGKILL'); process.abort(); 0");`,
  ],
  [
    "process.kill and process.abort in a Worker",
    `const done = new Int32Array(new SharedArrayBuffer(4)); ` +
      `new Worker("data:text/javascript," + encodeURIComponent(${JSON.stringify(workerSource)})).postMessage(done.buffer); ` +
      `if (Atomics.wait(done, 0, 0, 30000) === "timed-out") throw new Error("the worker did not answer");`,
  ],
  [
    "process.kill still validates its arguments",
    `let code; try { process.kill("not a pid", "SIGKILL"); } catch (e) { code = e.code; } ` +
      `if (code !== "ERR_INVALID_ARG_TYPE") throw new Error("process.kill did not reject the pid: " + code);`,
  ],
])("REPRL wrapper: %s", async (_name, payload) => {
  expect(await runPayload(payload)).toEqual(returned);
});

// process.execve throws ERR_FEATURE_UNAVAILABLE_ON_PLATFORM on Windows.
test.concurrent.skipIf(isWindows).each([
  ["process.execve with a path that does not exist", `process.execve("fuzzilli-reprl-execve-does-not-exist", []);`],
  [
    "process.execve",
    `process.execve(process.execPath, [process.execPath, "-e", "console.log('execve replaced the process')"]);`,
  ],
  [
    "process.execve in a ShadowRealm",
    `new ShadowRealm().evaluate("process.execve(process.execPath, [process.execPath, '-e', '0']); 0");`,
  ],
  [
    "process.execve still validates its arguments",
    `let code; try { process.execve(1); } catch (e) { code = e.code; } ` +
      `if (code !== "ERR_INVALID_ARG_TYPE") throw new Error("process.execve did not reject the path: " + code);`,
  ],
])("REPRL wrapper: %s", async (_name, payload) => {
  expect(await runPayload(payload)).toEqual(returned);
});
