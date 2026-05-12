import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// Round-trips a fixture file through Bun's runtime transpiler to confirm the
// cooked form of a template literal containing astral-plane characters (🐰)
// survives transpile → JSC handoff with the expected bytes.
test("template literal cooked form preserves astral-plane bytes", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "template-literal-fixture-test.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString()).toBe(
    // base64-encoded UTF-8 bytes the fixture writes out — comparing bytes
    // rather than codepoints isolates this to the transpiler path.
    "8J+QsDEyMzEyM/CfkLDwn5Cw8J+QsPCfkLDwn5Cw8J+QsDEyM/CfkLAxMjPwn5CwMTIzMTIz8J+QsDEyM/CfkLAxMjPwn5CwLPCfkLB0cnVl",
  );
});

// Each case below confirms that `String.raw` returns the source bytes verbatim
// for non-ASCII characters. Before the fix, Bun's printer re-escaped anything
// > 0x7F in the raw portion of a template literal to `\uXXXX`, which then
// showed up literally in `String.raw`'s output.
test.each([
  { name: "BMP box-drawing", input: "╭─╮", codepoints: [0x256d, 0x2500, 0x256e] },
  { name: "Cyrillic", input: "Привет, Мир", codepoints: [...("Привет, Мир" as string)].map(c => c.codePointAt(0)!) },
  { name: "CJK", input: "你好世界", codepoints: [...("你好世界" as string)].map(c => c.codePointAt(0)!) },
  { name: "emoji (surrogate pair)", input: "Hello 🌍", codepoints: [...("Hello 🌍" as string)].map(c => c.codePointAt(0)!) },
])("String.raw preserves non-ASCII: $name", async ({ input, codepoints }) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.stdout.write(JSON.stringify({raw: String.raw\`${input}\`, codepoints: [...String.raw\`${input}\`].map(c => c.codePointAt(0))}))`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ raw: input, codepoints });
  expect(exitCode).toBe(0);
});

test("RegExp.prototype.source preserves non-ASCII", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.stdout.write(JSON.stringify({source: /╭─╮/.source, codepoints: [.../╭─╮/.source].map(c => c.codePointAt(0))}))`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ source: "╭─╮", codepoints: [0x256d, 0x2500, 0x256e] });
  expect(exitCode).toBe(0);
});
