// The pages about bun compile show commands and what they print. Each command that is directly followed by its output
// is run here. Every line of the output on the page has to be printed, in that order; a page may leave lines out.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithBunTypes } from "harness";
import { join } from "path";
import { unsupported } from "../aot/run-programs";

const compiles = !unsupported;
const hasTheShellOfThePages = !isWindows;

type Example = {
  line: number;
  commands: string;
  printed: string;
  filesAbove: Record<string, string>;
  hasBunTypes: boolean;
};

// What a section shows in front of this command happens in a folder where it has not been run yet.
const installsBunTypes = "bun add -d @types/bun";
const restOfSection = (page: string, index: number) => page.slice(index, page.indexOf("\n#", index) + 1 || page.length);

// Bun itself and what it has built. Nothing that needs the network.
const isRunHere = (command: string) => /^(bun (?!add |install|x |create |upgrade)|\.\/)/.test(command);

function examplesOf(page: string) {
  const files: Record<string, string> = {};
  const examples: Example[] = [];
  let commands: { text: string; line: number } | undefined;
  let end = 0;
  for (const block of page.matchAll(/^([ \t]*)```(\S*)([^\n]*)\n(.*?)^[ \t]*```[ \t]*$/gms)) {
    const [, indentation, language, rest] = block;
    const text = block[4].replaceAll(new RegExp("^" + indentation, "gm"), "");
    const name = rest.trim().split(" ")[0];
    // Only tags such as <Tab> and other code blocks may stand between the commands and what they print.
    const between = page.slice(end, block.index).replace(/<[^>]*>/g, "");
    if (between.trim() !== "") commands = undefined;
    if (/^[\w./-]+\.\w+$/.test(name)) files[name] = text;
    if (language === "bash") commands = { text: text.trim(), line: page.slice(0, block.index).split("\n").length };
    if (language === "bash" && !text.trim().split("\n").every(isRunHere)) commands = undefined;
    if (language === "txt" && commands)
      examples.push({
        line: commands.line,
        commands: commands.text,
        printed: text,
        filesAbove: { ...files },
        hasBunTypes: !restOfSection(page, block.index).includes(installsBunTypes),
      });
    if (language === "txt") commands = undefined;
    end = block.index + block[0].length;
  }
  return { files, examples };
}

const withoutTimes = (text: string) =>
  text
    .replace(/^\n+/, "")
    .trimEnd()
    .split("\n")
    .map(line => line.replace(/ *\[\d+(\.\d+)?m?s\]/, "").trimEnd());

const pages = readdirSync(join(import.meta.dir, "..", "..", "docs", "bundler")).filter(name =>
  /^aot.*\.mdx$/.test(name),
);

describe.skipIf(!compiles || !hasTheShellOfThePages).each(pages)("docs/bundler/%s", name => {
  const page = readFileSync(join(import.meta.dir, "..", "..", "docs", "bundler", name), "utf8");
  const { files, examples } = examplesOf(page);

  test("has examples", () => {
    expect(examples).not.toBeEmpty();
  });

  const titled = examples.map(it => [`line ${it.line}: ${it.commands.replaceAll("\n", "; ")}`, it] as const);
  const printsWhatThePageSays = async (_: string, { commands, printed, filesAbove, hasBunTypes }: Example) => {
    using dir = (hasBunTypes ? tempDirWithBunTypes : tempDir)("aot-docs", { ...files, ...filesAbove });
    const cwd = realpathSync(String(dir));
    mkdirSync(join(cwd, ".bin"));
    symlinkSync(bunExe(), join(cwd, ".bin", "bun"));
    await using proc = Bun.spawn({
      cmd: ["sh", "-c", `{ ${commands}\n} 2>&1`],
      cwd,
      env: { ...bunEnv, NO_COLOR: "1", PATH: `${join(cwd, ".bin")}:${bunEnv.PATH}` },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
    const output = withoutTimes(stdout.replaceAll(cwd, "/path/to"));
    const expected = withoutTimes(printed);
    let at = 0;
    const found = expected.filter(line => {
      const index = output.indexOf(line, at);
      if (index < 0) return false;
      at = index + 1;
      return true;
    });
    expect({ found, output }).toEqual({ found: expected, output });
  };
  test.concurrent.each(titled)("%s", printsWhatThePageSays, 120_000);
});
