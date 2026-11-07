// The two programs of parallel/errors about tokens that start a line, once more with a carriage return in front of every line feed. Git and Prettier end every line of an .mjs file with a line feed alone, so the copies are written here.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned, unsupported, withoutDebugInformation } from "./harness/commands";
import { compileCommand } from "./harness/flags";

const transpiled = "stack-positions-of-tokens-that-start-a-line";
const asWritten = `${transpiled}-as-written`;
const textOf = (name: string) => readFileSync(join(import.meta.dir, "parallel", "errors", `${name}.mjs`), "utf8");

// In these rows the source map knows the token that starts a line: the frame of the row is where the program that runs as it is written has it.
const rowsWithAMappedToken = [
  "a member of undefined",
  "a member behind a line that is a comment",
  "a member behind a comment that ends in its line",
  "a getter behind a call and ?.",
  "a getter behind a call, a comment and ?.",
  "an element of undefined",
  "an element behind a line that is a comment",
  "an optional call",
  "an optional call behind a comment",
  "a function that is called where it is written",
  "a list that takes values",
  "a list that takes values, with a comment that its line begins with",
  "a tagged template",
  "a tagged template behind a comment",
];

/** Where the function of each of those rows is reported: below its frame are the call in `show` and the call of `show`. */
const placesOf = (stdout: string) =>
  Object.fromEntries(
    rowsWithAMappedToken.map(label => [
      label,
      stdout
        .split("\n")
        .find(row => row.startsWith(`${label} | `))
        ?.split(" ")
        .at(-3),
    ]),
  );

/** A folder with each program as it is stored, and with a carriage return in front of every line feed. */
function bothWays(...names: string[]) {
  const files = (text: (name: string) => string) => Object.fromEntries(names.map(name => [`${name}.mjs`, text(name)]));
  return tempDir("aot-tokens-behind-carriage-returns", {
    "line-feeds": files(textOf),
    "carriage-returns": files(name => textOf(name).replaceAll("\n", "\r\n")),
  });
}

async function ran(cmd: string[], cwd: string) {
  const { stdout, stderr, exitCode } = await spawned(cmd, cwd, bunEnv);
  return { stdout, stderr, exitCode };
}

test("the program that runs as it is written is the other one from its third line on, and both are ASCII without a carriage return", () => {
  const [printed, written] = [transpiled, asWritten].map(name => textOf(name).split("\n"));
  expect(written[0]).toBe("// @bun");
  expect(written.slice(2)).toEqual(printed.slice(2));
  expect([transpiled, asWritten].filter(name => /[^\x00-\x7f]|\r/.test(textOf(name)))).toEqual([]);
});

describe.concurrent("tokens that start a line behind a carriage return and a line feed", () => {
  test("a frame at a token that the source map knows is where the program that runs as it is written has it", async () => {
    using dir = bothWays(transpiled, asWritten);
    const cwd = join(String(dir), "carriage-returns");
    const [printed, written] = await Promise.all(
      [transpiled, asWritten].map(async name => {
        const { stdout, ...ended } = await ran([bunExe(), `./${name}.mjs`], cwd);
        return { places: placesOf(stdout), ...ended };
      }),
    );
    expect(written).toEqual({
      places: Object.fromEntries(rowsWithAMappedToken.map(label => [label, expect.stringMatching(/^\d+:\d+$/)])),
      stderr: "",
      exitCode: 0,
    });
    expect(printed).toEqual(written);
  });

  for (const name of [transpiled, asWritten]) {
    test.skipIf(!!unsupported)(
      `${name}: the copy prints what the program prints, and its executable what the copy prints`,
      async () => {
        using dir = bothWays(name);
        const cwd = join(String(dir), "carriage-returns");
        const executable = join(cwd, isWindows ? `${name}.exe` : name);
        const build = [...compileCommand, ...withoutDebugInformation(), `./${name}.mjs`, "--outfile", executable];
        const [withLineFeeds, plain, ended] = await Promise.all([
          ran([bunExe(), `./${name}.mjs`], join(String(dir), "line-feeds")),
          ran([bunExe(), `./${name}.mjs`], cwd),
          spawned([bunExe(), ...build], cwd, bunEnv),
        ]);
        // Each row prints one line.
        expect({ ...withLineFeeds, stdout: withLineFeeds.stdout.split("\n").length - 1 }).toEqual({
          stdout: textOf(name).match(/^show\(/gm)!.length,
          stderr: "",
          exitCode: 0,
        });
        expect(plain).toEqual(withLineFeeds);
        built(ended);
        expect(await ran([executable], cwd)).toEqual(plain);
      },
    );
  }
});
