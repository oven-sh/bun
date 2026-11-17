// `--disallow-code-generation-from-strings=strict` in an executable: whatever would turn a string or a file on the disk into
// code ends in the flag's own error, an EvalError with one text. An executable built with --aot refuses code from the disk
// anyway, in words of its own. Where the flag is set it says what the flag says, so the two builds print the same.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run as runCommand } from "./harness/run";
// One by one: the runner gives this file a process of its own and eight cases at once, beside two more like it: too many builds for four cores.
import { beforeAll, describe, testOneByOne as test } from "./supported";

raiseDefaultTimeout(240_000);

const refusal = "EvalError: Code generation from strings disallowed for this context";
const takesEachRoad = `for (const [name, run] of roads) {
  try {
    console.log(name, "=>", String(await run()));
  } catch (error) {
    const { name: kind, message, code } = error as Error & { code?: string };
    console.log(name, "=>", kind + ": " + message.split("\\n")[0].replaceAll(process.cwd(), "<cwd>"), code);
  }
}
`;
// Two programs: text that is evaluated in a program that also loads by a computed name may ask for any module of Bun's own, so one program with all the roads holds them all,
// and its build takes six times what these two take together.
const programs = ["texts", "files"] as const;
// A data: URL that is written in an import is part of the executable. One that the program makes is a string.
const asUrl = (text: string) => "data:text/javascript," + text;
const urlsOfImports = `import written from "${asUrl("export default 1")}";
import * as star from "./star.mjs";
export async function takeEachRoad(say) {
  const held = "${asUrl("export default 2")}";
  const head = "data:text/javascript,";
  const heldText = "${asUrl("module.exports = 3")}";
  const roads = {
    "import statement": () => written,
    "export star": () => star.listed,
    "import() of a literal": async () => (await import("${asUrl("export default 4")}")).default,
    "import() of a template": async () => (await import(\`${asUrl("export default 5")}\`)).default,
    "import() of a sum of literals": async () => (await import("data:text/javascript," + "export default 6")).default,
    "import() of base64": async () => (await import("data:text/javascript;base64,ZXhwb3J0IGRlZmF1bHQgNw==")).default,
    "import() of an escaped literal": async () => (await import("${asUrl("export%20default%208")}")).default,
    "import() of a literal that imports another": async () =>
      (await import("${asUrl("export { default } from 'data:text/javascript,export default 9'")}")).default,
    "import() of a literal that throws": async () => (await import("${asUrl("throw new RangeError('thrown')")}")).default,
    "require() of a literal": () => require("${asUrl("module.exports = 10")}"),
    "import() of JSON": async () => (await import("data:application/json,[11]")).default,
    "import() of JSON by its type": async () => (await import("data:application/json,[12]", { with: { type: "json" } })).default,
    "the same literal twice": async () =>
      (await import("${asUrl("export default {}")}")).default === (await import("${asUrl("export default {}")}")).default,
    "import() of one of two literals": async () =>
      (await import(process.env.OTHER_URL ? "${asUrl("export default 16")}" : "${asUrl("export default 17")}")).default,
    "require() of one of two literals": () =>
      require(process.env.OTHER_URL ? "${asUrl("module.exports = 18")}" : "${asUrl("module.exports = 19")}"),
    "import() of a const": async () => (await import(held)).default,
    "import() of a sum with a const": async () => (await import(head + "export default 13")).default,
    "import() of joined literals": async () => (await import(["data:text/javascript", "export default 14"].join(","))).default,
    "import() of a name of the run": async () => (await import(process.env.OTHER_URL)).default,
    "import() of a literal's text as a name of the run": async () => (await import(process.env.LITERAL_URL)).default,
    "import() of a const's text as a name of the run": async () => (await import(process.env.CONST_URL)).default,
    "require() of a const": () => require(heldText),
    "require() of a name of the run": () => require(process.env.OTHER_URL),
    "require() of a const's text as a name of the run": () => require(process.env.REQUIRED_URL),
    "import() of a URL object": async () => (await import(new URL("${asUrl("export default 15")}"))).default,
  };
  for (const [name, run] of Object.entries(roads)) {
    try {
      say(name + " => " + (await run()));
    } catch (error) {
      say(name + " => " + error.name + ": " + error.message.split("\\n")[0]);
    }
  }
}
`.replaceAll("\\`", "`");
const urlPrograms = { "urls": ["urls.mjs"], "urls-beside-worker": ["urls-beside-worker.mjs", "./url-worker.mjs"] };
const madeUrls = {
  OTHER_URL: asUrl("export default 'other'"),
  LITERAL_URL: asUrl("export default 4"),
  CONST_URL: asUrl("export default 2"),
  REQUIRED_URL: asUrl("module.exports = 3"),
};
const files = {
  "texts.ts": `import * as vm from "node:vm";
// A constant text is compiled when the executable is built. This one is made when the program runs.
const made = (text: string) => text + " ".repeat(Number(process.argv.length > 99));
const roads: [string, () => unknown][] = [
  ["eval", () => (0, eval)(made("1 + 1"))],
  ["direct eval", () => eval(made("1 + 1"))],
  ["Function", () => new Function(made("return 2"))()],
  ["vm.Script", () => new vm.Script(made("2"))],
  ["vm.runInNewContext", () => vm.runInNewContext(made("2"))],
];
${takesEachRoad}`,
  "files.ts": `import { createRequire } from "node:module";
const onDisk = process.cwd() + "/disk.js";
const data = process.cwd() + "/data.json";
const roads: [string, () => unknown][] = [
  ["require of code on the disk", () => createRequire(import.meta.url)(onDisk)],
  ["import.meta.require of code on the disk", () => import.meta.require(onDisk)],
  ["import() of code on the disk", () => import(onDisk)],
  ["require of data on the disk", () => createRequire(import.meta.url)(data).kind],
  ["require of a file that is not there", () => createRequire(import.meta.url)(onDisk + ".absent.js")],
];
${takesEachRoad}`,
  "roads.mjs": urlsOfImports,
  "star.mjs": `export * from "${asUrl("export const listed = 16")}";\n`,
  "urls.mjs": `import { takeEachRoad } from "./roads.mjs";\nawait takeEachRoad(line => console.log(line));\n`,
  "urls-beside-worker.mjs": `import { takeEachRoad } from "./roads.mjs";
await takeEachRoad(line => console.log("main: " + line));
const worker = new Worker(new URL("./url-worker.mjs", import.meta.url));
await new Promise(done => {
  worker.onmessage = ({ data }) => (data === null ? done() : console.log("worker: " + data));
  worker.onerror = ({ message }) => done(console.log("worker failed: " + message));
});
worker.terminate();
try {
  new Worker("${asUrl("postMessage(1)")}").terminate();
  console.log("a Worker of a literal => started");
} catch (error) {
  console.log("a Worker of a literal => " + error.name);
}
`,
  "url-worker.mjs": `import { takeEachRoad } from "./roads.mjs";\nawait takeEachRoad(line => postMessage(line));\npostMessage(null);\n`,
  "disk.js": `console.log("disk.js ran");\nmodule.exports = 5;\n`,
  "data.json": `{ "kind": "data" }\n`,
  "before.js": `console.log("before.js ran");\n`,
};
const named = (name: string) => (isWindows ? name + ".exe" : name);
const strict = "--disallow-code-generation-from-strings=strict";

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, NO_COLOR: "1", ...env });
  return { stdout, stderr, exitCode };
}

const folders = new Map<string, Promise<string>>();
const made: Disposable[] = [];
afterAll(() => made.forEach(folder => folder[Symbol.dispose]()));
/** A folder with the programs built without --aot and with it, once for each list of flags. */
const folderBuiltWith = (buildFlags: string[]) =>
  folders.getOrInsertComputed(buildFlags.join(" "), async () => {
    const dir = tempDir("aot-strict-flag", files);
    made.push(dir);
    const cwd = String(dir);
    for (const program of programs)
      for (const [how, flags] of [
        ["without", []],
        ["with", ["--aot"]],
      ] as const) {
        const outfile = named(`${program}-${how}`);
        const built = await run(
          [bunExe(), "build", "--compile", ...flags, ...buildFlags, program + ".ts", "--outfile", outfile],
          cwd,
        );
        expect(built.stderr).not.toMatch(/^error\b/m);
        expect(built.exitCode).toBe(0);
      }
    for (const [program, entryPoints] of Object.entries(urlPrograms))
      for (const [how, flags] of [
        ["without", []],
        ["with", ["--aot"]],
      ] as const) {
        const outfile = named(`${program}-${how}`);
        const built = await run(
          [bunExe(), "build", "--compile", ...flags, ...buildFlags, ...entryPoints, "--outfile", outfile],
          cwd,
        );
        expect(built.stderr).not.toMatch(/^error\b/m);
        expect(built.exitCode).toBe(0);
      }
    return cwd;
  });

test("data: URLs under the flag without a value", async () => {
  const cwd = await folderBuiltWith(["--compile-exec-argv=--disallow-code-generation-from-strings"]);
  for (const how of ["without", "with"]) {
    const { stdout, exitCode } = await run([join(cwd, named("urls-" + how))], cwd, madeUrls);
    const lines = stdout.split("\n");
    for (const line of ["import statement => 1", "import() of a literal => 4", "import() of a const => 2"])
      expect(lines).toContain(line);
    expect(exitCode).toBe(0);
  }
});

describe.each([
  ["in the executable's own arguments", ["--compile-exec-argv=" + strict], ""],
  ["in BUN_OPTIONS", [], strict + " "],
])("the flag %s", (_, buildFlags, options) => {
  let cwd: string;
  beforeAll(async () => void (cwd = await folderBuiltWith(buildFlags)));
  const both = async (
    env: Record<string, string>,
    program: (typeof programs)[number] | keyof typeof urlPrograms = "files",
  ) => ({
    without: await run([join(cwd, named(program + "-without"))], cwd, env),
    with: await run([join(cwd, named(program + "-with"))], cwd, env),
  });

  test("every road from a string or a file on the disk to code", async () => {
    const env = options ? { BUN_OPTIONS: options.trim() } : {};
    const ofText = await both(env, "texts");
    expect(ofText.with).toEqual(ofText.without);
    expect(ofText.with.stdout.split("\n").length).toBe(6);
    const ran = await both(env);
    expect(ran.with).toEqual(ran.without);
    const lines = ran.with.stdout.split("\n");
    for (const road of ["require", "import.meta.require", "import()"])
      expect(lines).toContain(`${road} of code on the disk => ${refusal} undefined`);
    expect(lines).toContain("require of data on the disk => data");
    expect(ran.with.stdout).not.toContain("disk.js ran");
  });

  test.each(["urls", "urls-beside-worker"] as const)("data: URLs: %s", async program => {
    const ran = await both({ ...madeUrls, ...(options ? { BUN_OPTIONS: options.trim() } : {}) }, program);
    expect(ran.with).toEqual(ran.without);
    const lines = ran.with.stdout.split("\n");
    for (const where of program === "urls" ? [""] : ["main: ", "worker: "]) {
      expect(lines).toContain(where + "import statement => 1");
      expect(lines).toContain(where + "import() of a literal => 4");
      expect(lines).toContain(where + "require() of a literal => 10");
      for (const name of [
        "import() of a const",
        "import() of joined literals",
        "import() of a literal's text as a name of the run",
      ])
        expect(lines).toContain(`${where}${name} => ${refusal}`);
    }
    if (program === "urls-beside-worker") expect(lines).toContain("a Worker of a literal => EvalError");
  });

  test.each([
    "--preload=./before.js",
    "--preload ./before.js",
    "-r ./before.js",
    "--require ./before.js",
    "--import ./before.js",
  ])("BUN_OPTIONS=%s", async option => {
    const ran = await both({ BUN_OPTIONS: options + option });
    expect(ran.with).toEqual(ran.without);
    expect(ran.with).toMatchObject({ stdout: "", exitCode: 1 });
    expect(ran.with.stderr.split("\n")[0]).toBe(refusal);
  });

  test("BUN_INSPECT_PRELOAD", async () => {
    const ran = await both({
      BUN_INSPECT_PRELOAD: join(cwd, "before.js"),
      ...(options ? { BUN_OPTIONS: options.trim() } : {}),
    });
    expect(ran.with).toEqual(ran.without);
    expect(ran.with.stderr.split("\n")[0]).toBe(refusal);
  });
});

test("without the flag an executable built with --aot says what to do about it", async () => {
  const cwd = await folderBuiltWith([]);
  const app = join(cwd, named("files-with"));
  expect((await run([app], cwd)).stdout).toMatch(
    /^require of code on the disk => Error: Cannot load '.*disk\.js': it isn't in this executable, which only runs code that was compiled into it\. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk\. MODULE_NOT_FOUND$/m,
  );
  expect(await run([app], cwd, { BUN_OPTIONS: "--preload ./before.js" })).toEqual({
    stdout: "",
    stderr:
      "error: --preload can't be used with this executable because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code\n",
    exitCode: 1,
  });
});
