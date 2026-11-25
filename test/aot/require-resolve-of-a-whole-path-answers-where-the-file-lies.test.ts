// `require.resolve("/app/lib/part.cjs")`: a whole path, written out, to a file that is there at the build. The executable answers where the file lies on the disk,
// as `bun <file>` does. `bun build --format=cjs` writes a whole path for a relative one. Each case prints what `bun <the main file>` prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "part.cjs": `exports.value = "part";\n`,
  "folder/index.js": `module.exports = "folder";\n`,
  "data.json": `{ "value": "data" }\n`,
  "note.txt": "note\n",
  "no-ending": "no ending\n",
  "worker.js": `postMessage("worker");\n`,
};

const prelude = `const fs = require("node:fs");
const read = name => console.log(name, fs.readFileSync(name, "utf8").trim());
`;

type Case = {
  main: string;
  text: (at: (name: string) => string) => string;
  prints: (at: (name: string) => string) => string;
};
const reads = (name: keyof typeof files, written: string = name): Case => ({
  main: "main.cjs",
  text: at => `${prelude}read(require.resolve(${at(written)}));\n`,
  prints: at => `${JSON.parse(at(name))} ${files[name].trim()}\n`,
});
const cases: Record<string, Case> = {
  "code": reads("part.cjs"),
  "a folder": reads("folder/index.js", "folder"),
  "an ending left out": reads("folder/index.js", "folder/index"),
  "data": reads("data.json"),
  "text": reads("note.txt"),
  "no ending": reads("no-ending"),
  "from a folder below": { ...reads("part.cjs"), main: "below/main.cjs" },
  "the free require of an ES module": {
    main: "main.mjs",
    text: at =>
      `import fs from "node:fs";\nconsole.log(fs.readFileSync(require.resolve(${at("note.txt")}), "utf8").trim());\n`,
    prints: () => "note\n",
  },
  "a constant": {
    main: "main.cjs",
    text: at => `${prelude}const name = ${at("data.json")};\nread(require.resolve(name));\n`,
    prints: at => `${JSON.parse(at("data.json"))} ${files["data.json"].trim()}\n`,
  },
  "one of two": {
    main: "main.cjs",
    text: at =>
      `${prelude}const pick = other => require.resolve(other ? ${at("note.txt")} : ${at("part.cjs")});\nread(pick(true));\nread(pick(false));\n`,
    prints: at => `${JSON.parse(at("note.txt"))} note\n${JSON.parse(at("part.cjs"))} ${files["part.cjs"].trim()}\n`,
  },
  "inside a wrapped module of a bundle": {
    main: "main.cjs",
    text: at =>
      `${prelude}var wrap = (run, module) => () => (module || run((module = { exports: {} }).exports, module), module.exports);\nvar part = wrap(exports => {\n  exports.where = require.resolve(${at("part.cjs")});\n});\nread(part().where);\n`,
    prints: at => `${JSON.parse(at("part.cjs"))} ${files["part.cjs"].trim()}\n`,
  },
  "what it answers is loaded": {
    main: "main.cjs",
    text: at =>
      `console.log(require(require.resolve(${at("part.cjs")})).value, require(require.resolve(${at("data.json")})).value);\n`,
    prints: () => "part data\n",
  },
  "a variable that holds what it answers is loaded": {
    main: "main.cjs",
    text: at =>
      `${prelude}const where = require.resolve(${at("part.cjs")});\nread(where);\nconsole.log(require(where).value, require(where) === require(${at("part.cjs")}));\n`,
    prints: at => `${JSON.parse(at("part.cjs"))} ${files["part.cjs"].trim()}\npart true\n`,
  },
  "the file is loaded by its name too": {
    main: "main.cjs",
    text: at => `${prelude}console.log(require(${at("part.cjs")}).value);\nread(require.resolve(${at("part.cjs")}));\n`,
    prints: at => `part\n${JSON.parse(at("part.cjs"))} ${files["part.cjs"].trim()}\n`,
  },
  "a worker starts what it answers": {
    main: "main.cjs",
    text: at =>
      `const worker = new Worker(require.resolve(${at("worker.js")}));\nworker.onmessage = event => {\n  console.log(event.data);\n  worker.terminate();\n};\n`,
    prints: () => "worker\n",
  },
  ...(!isWindows && { "a link": reads("part.cjs", "link/part.cjs") }),
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { main, text, prints } = cases[name];
  using outside = tempDir("aot-require-resolve-of-a-whole-path-outside", files);
  if (!isWindows) symlinkSync(String(outside), join(String(outside), "link"));
  const at = (file: string) => JSON.stringify(join(String(outside), file));
  using sources = tempDir("aot-require-resolve-of-a-whole-path", { [main]: text(at) });
  using elsewhere = tempDir("aot-require-resolve-of-a-whole-path-run", {});
  const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
  const built = await run([bunExe(), "build", "--compile", "--aot", main, "--outfile", executable], String(sources));
  expect(built.exitCode).toBe(0);
  const plain = await run([bunExe(), main], String(sources), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: prints(at), exitCode: 0 });
  for (const folder of [String(sources), String(elsewhere)]) {
    const compiled = await run([executable], folder, bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: prints(at), exitCode: 0 });
  }
});
