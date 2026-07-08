import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// allowNegative strips the "no-" prefix; a bare "--no-" leaves an empty option
// name. The resulting BunString (ZigString tag, len 0) used to reach
// Identifier::fromString with a null WTF::String and segfault the process.
test("parseArgs({ allowNegative: true }) with bare '--no-' does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { parseArgs } = require("node:util");
        const r1 = parseArgs({ args: ["--no-"], allowNegative: true, strict: false });
        console.log(JSON.stringify(r1));
        try {
          parseArgs({ args: ["--no-"], allowNegative: true, strict: true });
          console.log("no throw");
        } catch (e) {
          console.log(e.code);
        }
        const r2 = parseArgs({
          args: ["--no-", "--no-"],
          allowNegative: true,
          strict: false,
          options: { "": { type: "boolean", multiple: true } },
        });
        console.log(JSON.stringify(r2));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.split("\n").filter(Boolean), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: [
      '{"values":{"":false},"positionals":[]}',
      "ERR_PARSE_ARGS_UNKNOWN_OPTION",
      '{"values":{"":[false,false]},"positionals":[]}',
    ],
    exitCode: 0,
    signalCode: null,
  });
});
