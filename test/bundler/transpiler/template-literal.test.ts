import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// When targeting Bun's runtime,
// We must escape latin1 characters in raw template literals
// This is somewhat brittle
test("template literal", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "template-literal-fixture-test.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString()).toBe(
    // This is base64 encoded contents of the template literal
    // this narrows down the test to the transpiler instead of the runtime
    "8J+QsDEyMzEyM/CfkLDwn5Cw8J+QsPCfkLDwn5Cw8J+QsDEyM/CfkLAxMjPwn5CwMTIzMTIz8J+QsDEyM/CfkLAxMjPwn5CwLPCfkLB0cnVl",
  );
});

describe("a tag whose template has non-ASCII text", () => {
  const fixture = join(import.meta.dir, "template-literal-tags-fixture.js");
  // What Node prints.
  const expected = {
    raw: ["😀", "a1é2日本", '{"a":"😀"}'],
    cooked: ["😀\n", "é"],
    ownEscapes: ["\\u{1f600}😀\\xe9é"],
    invalidEscape: [true, "\\u{zz}é"],
    newline: ["é\né"],
    sameSite: true,
    otherSite: false,
    frozen: [true, true, true, true],
    rawDescriptor: false,
    length: [2, 2],
    member: [
      ["object", "é|ü|", 1, 2],
      ["object", "é"],
    ],
    classes: [
      ["derived", "ü"],
      ["derived", "ø"],
    ],
    constructed: "é",
    order: ["tag", "first", "second"],
    ascii: "\\u{1f600}\\n",
    nested: "éüx",
  };

  async function run(file: string) {
    await using process = Bun.spawn({ cmd: [bunExe(), file], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      process.stdout.text(),
      process.stderr.text(),
      process.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("gets it in strings.raw", async () => {
    const { stdout, stderr, exitCode } = await run(fixture);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("gets it in strings.raw after bun build --target=bun, whose output is ASCII", async () => {
    using dir = tempDir("template-literal-tags", {});
    const build = await Bun.build({ entrypoints: [fixture], target: "bun", outdir: String(dir) });
    expect(build.success).toBe(true);
    expect(await build.outputs[0].text()).not.toMatch(/[^\x00-\x7f]/);
    const { stdout, stderr, exitCode } = await run(build.outputs[0].path);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("gets CR and CRLF as LF", async () => {
    using dir = tempDir("template-literal-tags", {
      "lines.js": "console.log(JSON.stringify((strings => strings.raw)`é\r\né\ré`));",
    });
    const { stdout, stderr, exitCode } = await run(join(String(dir), "lines.js"));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["é\né\né"]);
    expect(exitCode).toBe(0);
  });
});
