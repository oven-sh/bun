// A mock is taken back while a graph that imports the mocked module is still being loaded: a plugin's async onLoad holds another import of that graph.
//
// Under `bun test` a mock waits: its factory runs once everything else that the graph asks for has come. A mock that is taken back before that never ran, and the graph gets the file;
// one that is put in its place meanwhile is the one that runs.
//
// A compiled test run used to end with a segmentation fault here. The graph is the engine's loader's, because a plugin serves one of its imports, and it held the record of the mocked
// module, which the end of the mock had let go of: what the run time then did for the module never reached that record.
//
// Then it called the factory at the import() call, so the graph kept the first mock, and a factory that failed there left the call waiting for ever. Now the call leaves the factory to
// the fetch of the mocked module, which the loader makes for such a graph anyway, and that fetch takes its turn as under `bun test`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

const forms: Record<string, string> = {
  "the mock is taken back while the plugin waits": `${imports} console.log("unmock"); vi.doUnmock("./k.js"); gate.resolve(); ${end}`,
  "another mock is laid in its place while the plugin waits": `${imports} vi.doMock("./k.js", () => { console.log("second factory runs"); return { x: "second" }; }); gate.resolve(); ${end}`,
  "the mocked module is imported while the plugin waits": `${imports} console.log("k", (await import("./k.js")).x); gate.resolve(); ${end}`,
  "the module was imported under the mock before": `console.log("k first", (await import("./k.js")).x); ${imports} vi.doUnmock("./k.js"); gate.resolve(); ${end}`,
  "the factory fails": `vi.doMock("./k.js", () => { console.log("factory fails"); throw new Error("the factory failed"); }); const user = import("./user.js").then(it => it, error => ({ seen: error.message })); await asked.promise; gate.resolve(); ${end}`,
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

// No case is about the layers: on a build in which the record that was let go of is run, what failed over two layers failed as one program too.
for (const [name, body] of Object.entries(forms)) {
  const project = {
    ...shared,
    "x.test.js": `import { test, vi } from "bun:test";\ntest("x", async () => {\n  ${start}\n  ${body}\n});\n`,
  };
  test(`${name}: it prints what bun test prints`, async () => {
    using dir = tempDir("aot-unmock-while-loading", project);
    const plain = await runTests(String(dir), undefined);
    const compiled = await runTests(String(dir), "TestRunLayers:0", "--aot");
    expect(plain.lines.at(-1)).toMatch(/^seen /);
    expect(compiled).toEqual(plain);
  });
}
