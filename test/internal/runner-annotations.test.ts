/**
 * scripts/runner.node.mjs runs every test file with GITHUB_ACTIONS=true and reads the
 * `::error file=...,line=...,col=...,title=...::stack` lines bun test prints for each
 * failure back out of its output; the title and stack become the <failure> of the junit
 * report it uploads. parseGitHubActionCommand() in scripts/utils.mjs is that parsing step.
 * bun test escapes the values the way actions/toolkit does (src/bun_core/fmt.rs), so the
 * parser has to undo exactly that.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { parseGitHubActionCommand, unescapeGitHubAction, unescapeGitHubActionProperty } from "../../scripts/utils.mjs";

describe("parseGitHubActionCommand", () => {
  test("decodes the properties and the message of a bun test failure", () => {
    // The title is `<name>: <first line of the message>` with `:` `,` `%` encoded; the
    // message is the rest of the error message and the stack, with newlines encoded.
    const line =
      "::error file=test/a%2Cb.test.ts,line=3,col=5,title=error: ENOENT%3A a = b%2C c 100%25::Expected: x%0A      at f (test/a,b.test.ts:3:5)";
    expect(parseGitHubActionCommand(line)).toEqual({
      command: "error",
      properties: {
        file: "test/a,b.test.ts",
        line: "3",
        col: "5",
        title: "error: ENOENT: a = b, c 100%",
      },
      message: "Expected: x\n      at f (test/a,b.test.ts:3:5)",
    });
  });

  test("keeps everything after the first = of a property", () => {
    expect(parseGitHubActionCommand('::error title=error: Test "a = b" timed out after 5000ms::')).toEqual({
      command: "error",
      properties: { title: 'error: Test "a = b" timed out after 5000ms' },
      message: "",
    });
  });

  test("parses commands without properties and ignores lines that are not commands", () => {
    expect(parseGitHubActionCommand("::group::test/a.test.ts")).toEqual({
      command: "group",
      properties: {},
      message: "test/a.test.ts",
    });
    expect(parseGitHubActionCommand("::endgroup::")).toEqual({ command: "endgroup", properties: {}, message: "" });
    expect(parseGitHubActionCommand("error: not a command")).toBeUndefined();
    expect(parseGitHubActionCommand("::error file=a.test.ts,title=cut off before the terminator")).toBeUndefined();
    expect(parseGitHubActionCommand("::::")).toBeUndefined();
  });
});

describe("unescaping", () => {
  test("properties decode the five property escapes, messages only the three data escapes", () => {
    expect(unescapeGitHubActionProperty("a%3Ab%2Cc%0Ad%0De%25f")).toBe("a:b,c\nd\re%f");
    expect(unescapeGitHubAction("a%3Ab%2Cc%0Ad%0De%25f")).toBe("a%3Ab%2Cc\nd\re%f");
  });

  test("an escaped % is not decoded a second time", () => {
    // Text that itself read "%0A" or "%2C" was escaped to %250A / %252C.
    expect(unescapeGitHubAction("see %250A here")).toBe("see %0A here");
    expect(unescapeGitHubActionProperty("see %252C here")).toBe("see %2C here");
  });

  test("other % sequences are left alone", () => {
    expect(unescapeGitHubAction("%0a %2F 100% %")).toBe("%0a %2F 100% %");
    expect(unescapeGitHubActionProperty("%0a %2F 100% %")).toBe("%0a %2F 100% %");
  });
});

test("round-trips the annotations bun test prints for a failure and a timeout", async () => {
  using dir = tempDir("runner-annotations", {
    "odd,name%path.test.ts": [
      `import { test } from "bun:test";`,
      `test("a = b", () => {`,
      `  throw new Error("ENOENT: a = b, c 100%");`,
      `});`,
      `test("t = 1", () => new Promise(() => {}), 1);`,
      ``,
    ].join("\n"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: String(dir),
    env: { ...bunEnv, GITHUB_ACTIONS: "true" },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  const annotations = stderr
    .split("\n")
    .filter(line => line.startsWith("::error"))
    .map(line => parseGitHubActionCommand(line));
  expect(annotations).toEqual([
    {
      command: "error",
      properties: {
        file: expect.stringMatching(/(^|[\\/])odd,name%path\.test\.ts$/),
        line: "3",
        col: expect.stringMatching(/^\d+$/),
        title: "error: ENOENT: a = b, c 100%",
      },
      message: expect.stringMatching(/^\n {6}at /),
    },
    {
      command: "error",
      properties: { title: expect.stringMatching(/^error: Test "t = 1" timed out after \d+ms$/) },
      message: "",
    },
  ]);
  expect(exitCode).toBe(1);
});
