import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const mark = "wombat-2093";
const part = `// only the source has this: ${mark}\nexport const tell = () => "told";\n`;
const partThatIsOneScalar = part.replace(":", "");
const flavors = [[], ["--no-compile-function-source"], ["--obfuscate"], ["--sourcemap=external"]];
const types = ["json", "jsonc", "json5", "toml", "yaml", "xml", "text"];

async function build(main: string, flavor: string[], source = part) {
  const dir = tempDir("aot-source-of-a-file-imported-with-options", { "main.mjs": main, "part.js": source });
  const directory = String(dir);
  const executable = join(directory, `main${isWindows ? ".exe" : ""}`);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flavor, "main.mjs", "--outfile", executable],
    directory,
  );
  expect(built.exitCode).toBe(0);
  const printed = await run([bunExe(), "build", "--aot-stored-strings", executable], directory, bunEnv);
  expect(printed.exitCode).toBe(0);
  const stored = printed.stdout.split("\0").filter(text => text.includes(mark)).length;
  return { dir, stored, says: async (...words: string[]) => (await run([executable, ...words], directory)).stdout };
}

const tells = (options: string) => `const { tell } = await import("./part.js", ${options});\nconsole.log(tell());\n`;
const made = `const options = process.argv[2] ? { with: { type: process.argv[2] } } : {};
try {
  const all = await import("./part.js", options);
  console.log(all.tell ? all.tell() : String(all.default).includes("only the source"));
} catch (error) {
  console.log(error.message.split(":")[0].replace(/'.*'/, "it"));
}
`;

for (const flavor of flavors) {
  const under = flavor[0] ?? "no flag";
  for (const options of ["{}", "{ with: {} }", "{ assert: {} }"]) {
    test(`${options} written out holds no source (${under})`, async () => {
      const built = await build(tells(options), flavor);
      using dir = built.dir;
      expect(built.stored).toBe(0);
      expect(await built.says()).toBe("told\n");
    });
  }
  test(`a type made when the program runs (${under})`, async () => {
    const built = await build(made, flavor);
    using dir = built.dir;
    expect(built.stored).toBe(flavor.length ? 0 : 1);
    expect(await built.says()).toBe("told\n");
    if (!flavor.length) expect(await built.says("text")).toBe("true\n");
    else for (const type of types) expect(await built.says(type)).toBe(`Cannot import it as ${type}\n`);
  });
  test(`a file whose source is one scalar of YAML (${under})`, async () => {
    const built = await build(made, flavor, partThatIsOneScalar);
    using dir = built.dir;
    if (flavor.length) expect(built.stored).toBe(0);
    else expect(built.stored).toBeGreaterThan(0);
    expect(await built.says()).toBe("told\n");
    expect(await built.says("yaml")).toBe(flavor.length ? "Cannot import it as yaml\n" : "true\n");
  });
  test(`a type that is written out holds the source (${under})`, async () => {
    const built = await build(
      `const { default: text } = await import("./part.js", { with: { type: "text" } });\nconsole.log(text.includes("only the source"));\n`,
      flavor,
    );
    using dir = built.dir;
    expect(built.stored).toBe(1);
    expect(await built.says()).toBe("true\n");
  });
}
