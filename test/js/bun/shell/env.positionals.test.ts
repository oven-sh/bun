import { $, spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import * as path from "node:path";
import { createTestBuilder } from "./test_builder";
const TestBuilder = createTestBuilder(import.meta.path);

$.nothrow();
describe("$ argv", async () => {
  for (let i = 0; i < process.argv.length; i++) {
    const element = process.argv[i];
    TestBuilder.command`echo $${{ raw: i }}`
      .exitCode(0)
      .stdout(process.argv[i] + "\n")
      .runAsTest(`$${i} should equal process.argv[${i}]`);
  }
});

test("$ argv: standalone", async () => {
  const script = path.join(import.meta.dir, "fixtures", "positionals.bun.sh");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "run", script, "a", "b", "c"],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(stderr).toBeDefined();
  const err = await stderr.text();
  expect(err).toBeEmpty();

  expect(stdout).toBeDefined();
  const out = await stdout.text();
  expect(out.split("\n")).toEqual([script, "a", "bb", ""]);
});

test("$ argv: standalone: not enough args", async () => {
  const script = path.join(import.meta.dir, "fixtures", "positionals.bun.sh");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "run", script],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(stderr).toBeDefined();
  const err = await stderr.text();
  expect(err).toBeEmpty();

  expect(stdout).toBeDefined();
  const out = await stdout.text();
  expect(out.split("\n")).toEqual([script, "", "", ""]);
});

test("$ argv: standalone: only 10", async () => {
  const script = path.join(import.meta.dir, "fixtures", "positionals2.bun.sh");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "run", script, "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(stderr).toBeDefined();
  const err = await stderr.text();
  expect(err).toBeEmpty();

  expect(stdout).toBeDefined();
  const out = await stdout.text();
  expect(out.split("\n")).toEqual([script, "a", "bb", "c", "d", "e", "f", "g", "h", "i", "a0", ""]);
});

test("$ argv: standalone: non-ascii", async () => {
  const script = path.join(import.meta.dir, "fixtures", "positionals2.bun.sh");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "run", script, "キ", "テ", "ィ", "・", "ホ", "ワ", "イ", "ト"],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(stderr).toBeDefined();
  const err = await stderr.text();
  expect(err).toBeEmpty();

  expect(stdout).toBeDefined();
  const out = await stdout.text();
  expect(out.split("\n")).toEqual([script, "キ", "テテ", "ィ", "・", "ホ", "ワ", "イ", "ト", "", "キ0", ""]);
});

// bash and dash keep `"$2"` as one empty word when there is no second argument.
test.concurrent.each([
  ["standalone script", "quoted.bun.sh", `echo a "$1" "$2" $2 b\n`, ["run"]],
  ["Bun.$", "quoted.js", 'await Bun.$`echo a "$2" "$3" $3 b`;\n', []],
] as const)("a quoted positional that is not set is one empty word: %s", async (_, file, source, runArgs) => {
  using dir = tempDir("shell-quoted-positional", { [file]: source });
  await using proc = spawn({
    cmd: [bunExe(), ...runArgs, path.join(String(dir), file), "x"],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "a x  b\n", stderr: "", exitCode: 0 });
});
