import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The preload's mock comes back where the factory ends its own mock. What the factory returns goes to the load that ran it.
const projectOf = (name: string, files: Record<string, string>, ask: string) => ({
  "package.json": `{ "name": "made-up", "private": true }\n`,
  "bunfig.toml": `[test]\npreload = ["./preload.cjs"]\n`,
  "preload.cjs": `const { mock } = require("bun:test");\nmock.module("${name}", () => ({ who: "preload" }));\n`,
  "a_test.cjs": `const { test, vi } = require("bun:test");
const name = "${name}";
${ask}
test("one", async () => {
  console.log("SAID at first", await ask());
  vi.doMock(name, () => {
    vi.doUnmock(name);
    return { who: "of the test" };
  });
  console.log("SAID under it", await ask());
  console.log("SAID behind", await ask());
});
`,
  "b_test.cjs": `const { test } = require("bun:test");
const name = "${name}";
${ask}
test("two", async () => {
  console.log("SAID next", await ask());
});
`,
  ...files,
});

const byRequire = `const ask = () => require(name).who;`;
const byImport = `const ask = async () => (await import(name)).who;`;
const shapes = {
  "a CommonJS file": projectOf("./part.cjs", { "part.cjs": `exports.who = "real";\n` }, byRequire),
  "an ES file by import()": projectOf("./part.mjs", { "part.mjs": `export const who = "real";\n` }, byImport),
  "a package": projectOf(
    "made-up-pack",
    {
      "node_modules/made-up-pack/package.json": `{ "name": "made-up-pack", "version": "1.0.0", "main": "index.cjs" }\n`,
      "node_modules/made-up-pack/index.cjs": `exports.who = "real";\n`,
    },
    byRequire,
  ),
};

async function linesOf(project: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-a-factory-that-ended-its-own-mock-over-a-preloads", project);
  const { stdout } = await run([bunExe(), "test", ...flags, "./a_test.cjs", "./b_test.cjs"], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  return stdout.split("\n").filter(line => line.startsWith("SAID"));
}

for (const [shape, project] of Object.entries(shapes)) {
  test(`${shape}: the next test file gets the preload's mock`, async () => {
    expect((await linesOf(project)).at(-1)).toBe("SAID next preload");
    expect((await linesOf(project, "--aot")).at(-1)).toBe("SAID next preload");
  });

  test.failing(
    `${shape}: it prints what bun test prints: a wrong answer today: under \`bun test --aot\` what the factory returned still answers behind the load that ran it`,
    async () => {
      const plain = await linesOf(project);
      expect(plain.at(-2)).toBe("SAID behind preload");
      expect(await linesOf(project, "--aot")).toEqual(plain);
    },
  );
}
