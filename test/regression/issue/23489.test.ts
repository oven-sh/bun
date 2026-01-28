import { YAML } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("YAML double-quoted strings with ... should not trigger document end error - issue #23489", () => {
  // Test the original failing case with Arabic text and emoji
  const yaml1 = 'balance_dont_have_wallet: "👛 لا تمتلك محفظة... !"';
  const result1 = YAML.parse(yaml1);
  expect(result1).toEqual({
    balance_dont_have_wallet: "👛 لا تمتلك محفظة... !",
  });

  // Test various patterns of ... in double-quoted strings
  const yaml2 = `test1: "this has ... dots"
test2: "... at start"
test3: "at end ..."
test4: "👛 ... with emoji"`;
  const result2 = YAML.parse(yaml2);
  expect(result2).toEqual({
    test1: "this has ... dots",
    test2: "... at start",
    test3: "at end ...",
    test4: "👛 ... with emoji",
  });

  // Test that both single and double quotes work
  const yaml3 = `single: 'this has ... dots'
double: "this has ... dots"`;
  const result3 = YAML.parse(yaml3);
  expect(result3).toEqual({
    single: "this has ... dots",
    double: "this has ... dots",
  });
});

test("YAML import with double-quoted strings containing ... - issue #23489", async () => {
  using dir = tempDir("yaml-ellipsis", {
    "test.yml": 'balance: "👛 لا تمتلك محفظة... !"',
    "test.ts": `
      import yaml from "./test.yml";
      console.log(JSON.stringify(yaml));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Unexpected document end");
  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe('{"balance":"👛 لا تمتلك محفظة... !"}');
});
