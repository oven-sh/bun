import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A zero-length WTF::StringImpl must surface as BunStringTag::Empty; debug
// builds assert on a WTFStringImpl-tagged empty string in Bun::toJS.
test("argv/execArgv options accept empty-string elements", async () => {
  const script = `
    const { Worker } = require("node:worker_threads");
    const w = new Worker(
      'require("node:worker_threads").parentPort.postMessage({ argv: process.argv.slice(2), execArgv: process.execArgv })',
      { eval: true, argv: ["", "a", ""], execArgv: [""] },
    );
    w.on("message", m => { console.log(JSON.stringify(m)); });
    w.on("error", e => { console.error(String(e)); process.exitCode = 1; });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ argv: ["", "a", ""], execArgv: [""] }),
    stderr: "",
    exitCode: 0,
  });
});
