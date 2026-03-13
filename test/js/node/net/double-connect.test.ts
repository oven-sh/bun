import { bunExe } from "harness";

test.failing("double connect", () => {
  const output = Bun.spawnSync({
    cmd: [bunExe(), import.meta.dirname + "/double-connect-repro.mjs", "minimal"],
  });
  expect({
    exitCode: output.exitCode,
    stderr: output.stderr.toString("utf-8"),
    stdout: output.stdout.toString("utf-8"),
  }).toMatchInlineSnapshot(`
    {
      "exitCode": 0,
      "stderr": "",
      "stdout": 
    "[parent] server listening on port true
    [connection] create
    [connection] connected
    \x1B[92m[parent] got connection\x1B[m
    [connection] closed
    "
    ,
    }
  `);
});
