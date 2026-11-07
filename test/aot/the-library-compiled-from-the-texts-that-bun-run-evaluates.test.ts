// Some modules of Bun's library have a second text for the compiler (src/js/ahead-of-time), and others have arms behind IS_COMPILED_AHEAD_OF_TIME.
// Under the testing word FirstTexts the compiler reads what `bun run` evaluates instead. One Bun builds a program both ways: where the two executables part, a program can tell the two texts apart.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(170_000);

const parallel = join(import.meta.dir, "parallel");

async function printedInThreeWays(program: string) {
  using directory = tempDir("both-texts-of-the-library", {});
  const printedBy = async (command: string[]) => {
    const { stdout, exitCode } = await run(command, String(directory));
    return { stdout, exitCode };
  };
  const built = async (name: string, ...words: string[]) => {
    const executable = join(String(directory), name);
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", ...words, program, "--outfile", executable],
      String(directory),
    );
    expect(build).toMatchObject({ exitCode: 0 });
    return printedBy([executable]);
  };
  const [plain, second, first] = await Promise.all([
    printedBy([bunExe(), program]),
    built("second"),
    built("first", "--aot-testing=FirstTexts"),
  ]);
  return { plain, second, first };
}

test("a difference that the second text of node:http declares is gone under the word", async () => {
  // docs/compiler/compatibility.mdx, "Smaller differences". If that difference is ever mended, this test needs another program that tells the texts apart: without one it does not show that the word is read.
  const { plain, second, first } = await printedInThreeWays(
    join(parallel, "the-short-roads-of-the-http-server", "declared-the-writable-state-of-the-socket-is-replaced.mjs"),
  );
  expect(plain.exitCode).toBe(0);
  expect(first).toEqual(plain);
  expect(second).not.toEqual(plain);
});

test("a server answers alike from both texts", async () => {
  const { plain, second, first } = await printedInThreeWays(
    join(
      parallel,
      "how-header-values-are-held-is-settled-at-the-first-header",
      "an-option-stored-behind-the-first-header.mjs",
    ),
  );
  expect(plain.exitCode).toBe(0);
  expect(first).toEqual(plain);
  expect(second).toEqual(plain);
});
