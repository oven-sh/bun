import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// allowNegative: an option literally declared as "no-X" must still be accepted.
// Bun previously stripped the no- prefix before lookup, so the declared option
// could never match and strict mode threw ERR_PARSE_ARGS_UNKNOWN_OPTION.
test("parseArgs({ allowNegative: true }) accepts an option literally declared as 'no-X'", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { parseArgs } = require("node:util");
        const r1 = parseArgs({
          args: ["--no-color"],
          options: { "no-color": { type: "boolean" } },
          allowNegative: true,
        });
        console.log(JSON.stringify(r1));
        const r2 = parseArgs({
          args: ["--no-color", "val"],
          options: { "no-color": { type: "string" } },
          allowNegative: true,
          allowPositionals: true,
        });
        console.log(JSON.stringify(r2));
        const r3 = parseArgs({
          args: ["--no-"],
          options: { "no-": { type: "boolean" } },
          allowNegative: true,
        });
        console.log(JSON.stringify(r3));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.split("\n").filter(Boolean), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: [
      '{"values":{"color":false},"positionals":[]}',
      '{"values":{"no-color":"val"},"positionals":[]}',
      '{"values":{"":false},"positionals":[]}',
    ],
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});
