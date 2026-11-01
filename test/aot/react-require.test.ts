import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// React's enqueueTask() reads `require` off the module object under a key that it puts together, "to get around the bundlers", and swallows an error: act() then takes
// MessageChannel instead of setImmediate, and nobody is told.
const name = `const name = ("require" + Math.random()).slice(0, 7);`;
const say = `const say = (what, f) => { try { console.log("SAY", what, f()); } catch (error) { console.log("SAY", what, "threw", error.constructor.name); } };`;
const forms = `
say("as React", () => typeof (module && module[name]).call(module, "timers").setImmediate);
say("called directly", () => typeof module[name]("timers").setImmediate);
say("optional", () => typeof module?.[name]?.("timers").setImmediate);
say("held", () => { const held = module[name]; return typeof held.call(module, "node:path").join; });
say("the same function", () => module[name] === module.require);
say("other keys", () => [typeof module["ex" + "ports".slice(0, 5)], module[("id" + Math.random()).slice(0, 2)] === module.id].join());
say("a file that a require() names too", () => module[name]("./other.cjs").other);
say("typeof", () => typeof module[name]);
say("in", () => name in module);
function inner(module) { return module[name]; }
say("a parameter of that name", () => inner({ require: "mine" }));
`;
const other = { "other.cjs": `exports.other = "the other file";` };
const printed = (text: string) => text.split("\n").filter(line => line.startsWith("SAY"));

test("an executable", async () => {
  using dir = tempDir("aot-react-require", {
    ...other,
    "entry.cjs": `${name}\n${say}\nrequire("./other.cjs");\n${forms}`,
  });
  const plain = await run([bunExe(), "entry.cjs"], String(dir), bunEnv);
  expect(printed(plain.stdout).length).toBe(10);
  expect(printed(plain.stdout).join("\n")).not.toContain("threw");
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "entry.cjs", "--outfile", "compiled"],
    String(dir),
    bunEnv,
  );
  expect(build.stderr).not.toContain("error");
  const compiled = await run([`${dir}/compiled`], String(dir), bunEnv);
  expect(printed(compiled.stdout)).toEqual(printed(plain.stdout));
  expect(compiled.exitCode).toBe(0);
});

const ways: [string, Record<string, string>][] = [
  ["one program", { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1", BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  [
    "layers",
    { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1", BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:8" },
  ],
];

const testFiles: Record<string, string> = {
  "the runner's names come off a require()": `const { test, vi } = require("vitest");\n${name}\n${say}\nrequire("./other.cjs");\ntest("forms", () => {${forms}});`,
  "test alone": `const { test } = require("bun:test");\n${name}\n${say}\nrequire("./other.cjs");\ntest("forms", () => {${forms}});`,
  "under fake timers": `const { test, vi } = require("vitest");
test("fires", async () => {
  ${name}
  const enqueueTask = module[name].call(module, "timers").setImmediate;
  vi.useFakeTimers();
  await new Promise(resolve => enqueueTask(resolve));
  console.log("SAY it still fires");
  vi.useRealTimers();
}, 2000);`,
};

for (const [title, text] of Object.entries(testFiles)) {
  for (const [way, env] of ways) {
    test(`a test file: ${title}: ${way}`, async () => {
      using dir = tempDir("aot-react-require", { ...other, "forms.test.cjs": text });
      const plain = await run([bunExe(), "test"], String(dir), bunEnv);
      expect(plain.exitCode).toBe(0);
      expect(printed(plain.stdout).length).toBeGreaterThan(0);
      const compiled = await run([bunExe(), "test", "--aot"], String(dir), { ...bunEnv, ...env });
      expect(printed(compiled.stdout)).toEqual(printed(plain.stdout));
      expect(compiled.exitCode).toBe(0);
    });
  }
}

// Each road by itself: beside another road that keeps the loader every one of them works.
const roads: Record<string, [string, string]> = {
  "called directly": ["cjs", `console.log("SAY", typeof module[name]("node:fs").readFileSync);`],
  "called through an optional chain": ["cjs", `console.log("SAY", typeof module?.[name]?.("node:fs").readFileSync);`],
  "read and called later": [
    "cjs",
    `const held = module[name];\nconsole.log("SAY", typeof held.call(module, "node:fs").readFileSync);`,
  ],
  "another name for the module object": [
    "cjs",
    `const same = module;\nconsole.log("SAY", typeof same[name]("node:fs").readFileSync);`,
  ],
  "the module object is handed on": [
    "cjs",
    `function read(object, key) { return object[key]; }\nconsole.log("SAY", typeof read(module, name).call(module, "node:fs").readFileSync);`,
  ],
  "import.meta": ["mjs", `console.log("SAY", typeof import.meta[name]("node:fs").readFileSync);`],
  "below a type assertion": ["cts", `console.log("SAY", typeof (module as any)[name]("node:fs").readFileSync);`],
};

for (const [title, [extension, text]] of Object.entries(roads)) {
  test.concurrent(`alone in an executable: ${title}`, async () => {
    using dir = tempDir("aot-react-require", { [`entry.${extension}`]: `${name}\n${text}` });
    const plain = await run([bunExe(), `entry.${extension}`], String(dir), bunEnv);
    expect(printed(plain.stdout)).toEqual(["SAY function"]);
    await run(
      [bunExe(), "build", "--compile", "--aot", `entry.${extension}`, "--outfile", "compiled"],
      String(dir),
      bunEnv,
    );
    const compiled = await run([`${dir}/compiled`], String(dir), bunEnv);
    expect({ printed: printed(compiled.stdout), stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
      printed: ["SAY function"],
      stderr: "",
      exitCode: 0,
    });
  });
  test.concurrent(`alone in a test file: ${title}`, async () => {
    const runner = extension === "mjs" ? `import { test } from "bun:test";` : `const { test } = require("bun:test");`;
    using dir = tempDir("aot-react-require", {
      [`road.test.${extension}`]: `${runner}\n${name}\ntest("road", () => {\n${text}\n});`,
    });
    const plain = await run([bunExe(), "test"], String(dir), bunEnv);
    expect(printed(plain.stdout)).toEqual(["SAY function"]);
    const compiled = await run([bunExe(), "test", "--aot"], String(dir), { ...bunEnv, ...ways[0][1] });
    expect({ printed: printed(compiled.stdout), exitCode: compiled.exitCode }).toEqual({
      printed: ["SAY function"],
      exitCode: 0,
    });
  });
}

// The name stands nowhere in the file: the refusal that the documentation describes, and it is loud.
test("a file that does not spell the name is refused loudly", async () => {
  using dir = tempDir("aot-react-require", {
    "entry.cjs": `const name = [114, 101, 113, 117, 105, 114, 101].map(code => String.fromCharCode(code)).join("");\nconsole.log("SAY", typeof module[name]("timers").setImmediate);`,
  });
  await run([bunExe(), "build", "--compile", "--aot", "entry.cjs", "--outfile", "compiled"], String(dir), bunEnv);
  const compiled = await run([`${dir}/compiled`], String(dir), bunEnv);
  expect(printed(compiled.stdout)).toEqual([]);
  expect(compiled.stderr).toContain("The module loader was not compiled into this executable");
  expect(compiled.exitCode).not.toBe(0);
});
