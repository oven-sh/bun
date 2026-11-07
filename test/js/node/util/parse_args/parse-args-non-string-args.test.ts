import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import { parseArgs } from "node:util";

// parseArgs converts an `args` element to a string and classifies that string. An element that
// is not a string can convert to another string the next time. The raw name of `--name=value`
// and of an option in a short option group is cut out of the string, so it has to come from the
// string that was classified.
describe("parseArgs: args elements that are not strings", () => {
  const kinds = [
    "object with toString",
    "String subclass with toString",
    "array with toString",
    "object with Symbol.toPrimitive",
    "object with valueOf",
  ];

  // One process runs every case of the fixture. It is not this process, because a second
  // conversion made parseArgs abort the process in all cases but the first two.
  let lines: { case: string; kind?: string }[] = [];
  let exit: { stderr: string; exitCode: number } | undefined;
  beforeAll(async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "parse-args-non-string-args-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    exit = { stderr, exitCode };
    lines = stdout
      .split(/\r?\n/)
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line));
  });

  test.each([
    "tokens, --name=value, later string has '=' at another index",
    "tokens, --name=value, later conversion throws",
    "tokens, --name=value",
    "tokens, UTF-16 --name=value",
    "tokens, Latin-1 --name=value",
    "tokens, short option group",
    "tokens, UTF-16 short option group",
    "tokens, string option inside a short option group",
    "strict, unknown --name=value",
    "strict, unknown --name=value, later string is empty",
    "strict, unknown UTF-16 --name=value",
    "strict, unknown option in a short option group",
    "strict, ambiguous value after a short option group",
    "args omitted, element in process.argv",
  ])("an element is converted once and parses like that string: %s", name => {
    const [fromString, ...fromElements] = lines.filter(line => line.case === name);
    expect(fromElements).toEqual(kinds.map(kind => ({ ...fromString, kind, conversions: 1 })));
  });

  // After an abort, this is the test that shows the panic message.
  test("the process that ran the cases prints no error and exits with code 0", () => {
    expect(exit).toEqual({ stderr: "", exitCode: 0 });
  });

  // The raw name of a lone option is not cut out of a string. Node gives the element too.
  test("a lone option has the element itself as rawName", () => {
    const short = new String("-f");
    const long = new String("--foo");
    const args: any[] = [short, long];
    const { tokens }: { tokens: any[] } = parseArgs({ args, strict: false, tokens: true });

    expect(tokens.map(token => token.name)).toEqual(["f", "foo"]);
    expect(tokens[0].rawName).toBe(short);
    expect(tokens[1].rawName).toBe(long);
  });
});
