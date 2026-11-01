// A mock is taken back while a graph that imports the mocked module is still being loaded: a plugin's async onLoad holds another import of that graph.
//
// Under `bun test` a mock waits: its factory runs once everything else that the graph asks for has come. A mock that is taken back before that never ran, and the graph gets the file;
// one that is put in its place meanwhile is the one that runs.
//
// A compiled test run used to end with a segmentation fault here. The graph is the engine's loader's, because a plugin serves one of its imports, and it held the record of the mocked
// module, which the end of the mock had let go of: what the run time then did for the module never reached that record.
//
// TODO(4306): the compiled run still calls the factory as soon as the loader comes to the mocked module, so the graph keeps the first mock. The cases marked `failing` say what `bun test`
// prints, and turn red on the day the compiled run prints it too: then the mark goes.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { waysFor } from "./harness/ways";
import { test } from "./supported";

const shared = {
  "user.js": `import { x } from "./k.js"; import { s } from "./slow.js"; console.log("user runs"); export const seen = x + "/" + s;\n`,
  "k.js": `console.log("k runs"); export const x = "real";\n`,
  "slow.js": `export const s = "slow";\n`,
};
const start = `const asked = Promise.withResolvers(), gate = Promise.withResolvers();
  Bun.plugin({
    name: "slow",
    setup(build) {
      build.onLoad({ filter: /slow\\.js$/ }, async () => {
        console.log("onLoad asked");
        asked.resolve();
        await gate.promise;
        console.log("onLoad answers");
        return { contents: 'export const s = "slow";', loader: "js" };
      });
    },
  });
  vi.doMock("./k.js", () => { console.log("factory runs"); return { x: "first" }; });`;
const imports = `const user = import("./user.js"); await asked.promise;`;
const end = `console.log("seen", (await user).seen);`;

const forms: Record<string, { body: string; printsAsPlain?: boolean; files?: Record<string, string> }> = {
  "the mock is taken back while the plugin waits": {
    body: `${imports} console.log("unmock"); vi.doUnmock("./k.js"); gate.resolve(); ${end}`,
  },
  "the mock stays": {
    body: `${imports} gate.resolve(); ${end}`,
  },
  "the mock is taken back right behind the word that lets the plugin go on": {
    body: `${imports} gate.resolve(); console.log("unmock"); vi.doUnmock("./k.js"); ${end}`,
  },
  "another mock is put in its place": {
    body: `${imports} vi.doUnmock("./k.js"); vi.doMock("./k.js", () => { console.log("second factory runs"); return { x: "second" }; }); gate.resolve(); ${end}`,
  },
  "the module is imported again afterwards": {
    body: `${imports} vi.doUnmock("./k.js"); gate.resolve(); ${end} console.log("k again", (await import("./k.js")).x);`,
  },
  "the module was imported under the mock before": {
    body: `console.log("k first", (await import("./k.js")).x); ${imports} vi.doUnmock("./k.js"); gate.resolve(); ${end}`,
    printsAsPlain: true,
  },
  "the file behind the mock imports another file": {
    body: `${imports} vi.doUnmock("./k.js"); gate.resolve(); ${end}`,
    files: {
      "k.js": `import { y } from "./deeper.js"; console.log("k runs"); export const x = "real" + y;\n`,
      "deeper.js": `console.log("deeper runs"); export const y = "+deeper";\n`,
    },
  },
};

async function runTests(cwd: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using proc = Bun.spawn({ cmd: [bunExe(), "test", ...flags], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    lines: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")),
    exitCode,
    signalCode: proc.signalCode,
    crash: /Segmentation fault[^\n]*|panic\([^\n]*/.exec(stdout + stderr)?.[0] ?? null,
  };
}

const ways = [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
] as const;
// No case is about the layers. On a build in which the record that was let go of is run, the six tests that fail over two layers fail as one program too, five by the fault.
const witness = "the mock is taken back while the plugin waits";

for (const [name, { body, printsAsPlain, files }] of Object.entries(forms)) {
  for (const [way, words] of waysFor(ways, name === witness)) {
    const project = {
      ...shared,
      ...files,
      "x.test.js": `import { test, vi } from "bun:test";\ntest("x", async () => {\n  ${start}\n  ${body}\n});\n`,
    };
    let ran:
      | Promise<{ plain: Awaited<ReturnType<typeof runTests>>; compiled: Awaited<ReturnType<typeof runTests>> }>
      | undefined;
    const run = () =>
      (ran ??= (async () => {
        using dir = tempDir("aot-unmock-while-loading", project);
        return { plain: await runTests(String(dir), undefined), compiled: await runTests(String(dir), words, "--aot") };
      })());

    test(`${name}, ${way}: the run ends by itself`, async () => {
      const { compiled } = await run();
      expect({ signalCode: compiled.signalCode, crash: compiled.crash }).toEqual({ signalCode: null, crash: null });
    });
    (printsAsPlain ? test : test.failing)(`${name}, ${way}: it prints what bun test prints`, async () => {
      const { plain, compiled } = await run();
      expect(plain.lines.at(-1)).toMatch(/^(seen|k again) /);
      expect({ lines: compiled.lines, exitCode: compiled.exitCode }).toEqual({
        lines: plain.lines,
        exitCode: plain.exitCode,
      });
    });
  }
}
