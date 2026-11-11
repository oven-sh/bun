import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The source text of a compiled file isn't in the executable, so reading it as data doesn't find it. That holds for an entry point
// too: the file that starts a worker, and the main file itself. existsSync() and statSync() see them.
const reads = (name: string) => `import fs from "node:fs";
const at = new URL("./${name}", import.meta.url);
const show = async (what, answer) => {
  let value;
  try {
    value = JSON.stringify(await answer());
  } catch (error) {
    value = "throws " + error.code;
  }
  console.log(what + ":", value);
};
await show("readFileSync", () => fs.readFileSync(at, "utf8"));
await show("readFileSync of bytes", () => fs.readFileSync(at).length);
await show("promises.readFile", () => fs.promises.readFile(at, "utf8"));
await show("Bun.file", () => Bun.file(at).text());
await show("openSync", () => fs.closeSync(fs.openSync(at, "r")) ?? "opened");
await show("existsSync", () => fs.existsSync(at));
await show("statSync", () => fs.statSync(at).isFile());
`;
const starts = (name: string) => `const worker = new Worker(new URL("./${name}", import.meta.url).href);
worker.onmessage = event => {
  console.log("worker:", event.data);
  worker.terminate();
};
`;
const refused = `readFileSync: throws ENOENT
readFileSync of bytes: throws ENOENT
promises.readFile: throws ENOENT
Bun.file: throws ENOENT
openSync: throws ENOENT
existsSync: true
statSync: true
`;
const projects: Record<string, { files: Record<string, string>; says: string }> = {
  "the file that starts a worker": {
    files: { "main.mjs": reads("job.js") + starts("job.js"), "job.js": `postMessage("job");\n` },
    says: refused + "worker: job\n",
  },
  "a TypeScript file that starts a worker": {
    files: { "main.mjs": reads("job.ts") + starts("job.ts"), "job.ts": `postMessage("job" as string);\n` },
    says: refused + "worker: job\n",
  },
  "the main file itself": { files: { "main.mjs": reads("main.mjs") }, says: refused },
  "a file that is imported": {
    files: { "main.mjs": `import "./lib.mjs";\n` + reads("lib.mjs"), "lib.mjs": `globalThis.loaded = true;\n` },
    says: refused,
  },
};

test.concurrent.each(Object.keys(projects))(
  "%s",
  async name => {
    using dir = tempDir("aot-text-of-an-entry-point", {
      "package.json": `{ "name": "app", "private": true }`,
      ...projects[name].files,
    });
    const cwd = String(dir);
    const executable = join(cwd, isWindows ? "compiled.exe" : "compiled");
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable],
      cwd,
      bunEnv,
    );
    expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    for (const file of Object.keys(projects[name].files)) rmSync(join(cwd, file));
    const compiled = await run([executable], cwd, bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      stdout: projects[name].says,
      exitCode: 0,
    });
  },
  240_000,
);
