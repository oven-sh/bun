// `new Worker(file, { preload: [..] })`: the Worker loads what `preload` names before `file`. The build reads each of those names as it
// reads `file`, so an executable and a compiled test run hold the files. It read a name only where that was a text, and left every
// other file out without a word.
import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { compileCommand, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const added = (name: string) => `globalThis.preloaded = [...(globalThis.preloaded ?? []), "${name}"];`;

// The build can read what every Worker here starts from. Where it cannot read one, it follows each name that the program writes anywhere, and
// finds most of these files that way.
// Each name stands in one list, in this order. The file that it names is src/<its key>.mjs.
const inOneList: [string, string][] = [
  ["text", `"./src/text.mjs"`],
  ["url", `new URL("./url.mjs", import.meta.url)`],
  ["href", `new URL("./href.mjs", import.meta.url).href`],
  ["pathOfUrl", `fileURLToPath(new URL("./pathOfUrl.mjs", import.meta.url))`],
  ["joined", `join(import.meta.dir, "joined.mjs")`],
  ["resolved", `resolve(import.meta.dirname, "./resolved.mjs")`],
  ["plus", `import.meta.dir + "/plus.mjs"`],
  ["template", "`${import.meta.dir}/template.mjs`"],
  ["answered", `import.meta.resolve("./answered.mjs")`],
  ["held", `held`],
  ["stored", `stored`],
  ["either", `process.argv.length > 9 ? join(import.meta.dir, "nobody.mjs") : join(import.meta.dir, "either.mjs")`],
  ["byDefault", `process.env.PRELOAD_THAT_NOBODY_SETS ?? join(import.meta.dir, "byDefault.mjs")`],
  ["code", `"data:text/javascript," + encodeURIComponent(${JSON.stringify(added("code"))})`],
];
const inCommonJs: [string, string][] = [
  ["ofFolder", `__dirname + "/ofFolder.mjs"`],
  ["joinedToFolder", `require("node:path").join(__dirname, "joinedToFolder.mjs")`],
  ["required", `require.resolve("./required.mjs")`],
];
const inTypeScript: [string, string][] = [
  ["typedHref", `new URL("./typedHref.mjs", import.meta.url).href`],
  ["typedAnswer", `import.meta.resolve("./typedAnswer.mjs")`],
];
const alone = ["pathname", "behindNames", "ofNode"];
const preloaded = [...inOneList, ...inCommonJs, ...inTypeScript].map(([name]) => name).concat(alone, "nobody");
const listOf = (names: [string, string][]) => names.map(([, name]) => name).join(", ");

const files = {
  "package.json": `{ "name": "p" }`,
  "tsconfig.json": JSON.stringify({
    compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"] },
  }),
  ...Object.fromEntries(preloaded.map(name => [`src/${name}.mjs`, added(name) + "\n"])),
  "src/w.mjs": `postMessage((globalThis.preloaded ?? ["nothing"]).join(" "));\n`,
  "src/w-of-node.mjs": `import { parentPort } from "node:worker_threads";\nparentPort.postMessage((globalThis.preloaded ?? ["nothing"]).join(" "));\n`,
  "src/starts.mjs": `import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker as Thread } from "node:worker_threads";
const w = new URL("./w.mjs", import.meta.url);
const held = fileURLToPath(new URL("./held.mjs", import.meta.url));
let stored = join(import.meta.dir, "nobody.mjs");
if (process.argv.length < 9) stored = join(import.meta.dir, "stored.mjs");
const options = { preload: [join(import.meta.dir, "behindNames.mjs")] };
const same = options;
export const starts = {
  list: () => new Worker(w, { preload: [${listOf(inOneList)}] }),
  pathname: () => new Worker(w, { preload: new URL("./pathname.mjs", import.meta.url).pathname }),
  behindNames: () => new Worker(w, same),
  ofNode: () => new Thread(new URL("./w-of-node.mjs", import.meta.url), { preload: [join(import.meta.dir, "ofNode.mjs")] }),
};
`,
  "src/starts.cjs": `exports.inCommonJs = () => new Worker(__dirname + "/w.mjs", { preload: [${listOf(inCommonJs)}] });\n`,
  "src/starts.ts": `export const inTypeScript = (): Worker =>\n  new Worker(new URL("./w.mjs", import.meta.url).href, { preload: [${listOf(inTypeScript)}] });\n`,
  "answers.mjs": `import { starts } from "./src/starts.mjs";
import inCommonJs from "./src/starts.cjs";
import { inTypeScript } from "./src/starts.ts";
export async function answers() {
  const seen = [];
  for (const [name, start] of Object.entries({ ...starts, ...inCommonJs, inTypeScript })) {
    const worker = start();
    const got = await new Promise(done => {
      const take = value => done(value?.data ?? value);
      const fail = error => done("error: " + String(error.message).split("\\n")[0]);
      worker.onmessage = take;
      worker.on?.("message", take);
      worker.onerror = fail;
      worker.on?.("error", fail);
    });
    seen.push(name + ": " + got);
    await worker.terminate();
  }
  return seen;
}
`,
  "main.mjs": `import { answers } from "./answers.mjs";\nfor (const line of await answers()) console.log("SEEN", line);\nprocess.exit(0);\n`,
};
const namesOf = (names: [string, string][]) => names.map(([name]) => name).join(" ");
const expected = [
  "list: " + namesOf(inOneList),
  "pathname: pathname",
  "behindNames: behindNames",
  "ofNode: ofNode",
  "inCommonJs: " + namesOf(inCommonJs),
  "inTypeScript: " + namesOf(inTypeScript),
];
const seenIn = (text: string) =>
  text
    .split("\n")
    .filter(line => line.startsWith("SEEN "))
    .map(line => line.slice("SEEN ".length));
const warnings = (text: string) => [...text.matchAll(/^warn: (TS\d+)/gm)].map(match => match[1]);

test("each Worker has preloaded its files in an executable whose sources are moved away", async () => {
  using dir = tempDir("aot-what-a-worker-preloads", files);
  const cwd = String(dir);
  expect(seenIn((await run([bunExe(), "run", "main.mjs"], cwd, bunEnv)).stdout)).toEqual(expected);
  // On one thread: the engine of a debug build of Bun crashes on several where a program is this large.
  const threads = isDebug ? [withThreads(1)] : [];
  const built = await run([bunExe(), ...compileCommand, ...threads, "main.mjs", "--outfile", "compiled"], cwd, bunEnv);
  expect({
    exitCode: built.exitCode,
    warnings: warnings(built.stderr),
    said: built.exitCode ? built.stdout + built.stderr : "",
  }).toEqual({ exitCode: 0, warnings: [], said: "" });
  renameSync(join(cwd, "src"), join(cwd, "moved-away"));
  expect(seenIn((await run([join(cwd, "compiled")], cwd, bunEnv)).stdout)).toEqual(expected);
});

test("each Worker has preloaded its files in a test run", async () => {
  using dir = tempDir("aot-what-a-worker-preloads-in-a-test-run", {
    ...files,
    "a.test.mjs": `import { expect, test } from "bun:test";
import { answers } from "./answers.mjs";
test("each Worker answers with what it preloaded", async () => {
  expect(await answers()).toEqual(${JSON.stringify(expected)});
});
`,
  });
  // On one thread, as above.
  const env = { ...bunEnv, ...(isDebug && { BUN_DEBUG_TEST_AOT_WORDS: "threads=1" }) };
  const tested = await run([bunExe(), "test", "--timeout=60000", "--aot", "./a.test.mjs"], String(dir), env);
  expect({
    exitCode: tested.exitCode,
    warnings: warnings(tested.stderr),
    said: tested.exitCode ? tested.stdout + tested.stderr : "",
  }).toEqual({ exitCode: 0, warnings: [], said: "" });
});
