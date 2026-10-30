import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unsupported } from "./harness/commands";
import { registry } from "./harness/registry";
import { run } from "./harness/run";
import { test } from "./supported";

const passing = (name: string, seen = "lib") => `import { test, expect } from "bun:test";
import { value } from "./lib";
test("${name}", () => {
  expect(value + (globalThis as any).fromPreload).toBe(3);
  console.log("${name} ran with ${seen}");
});
`;
const files: Record<string, string> = {
  // What is looked through for imports ahead of a build takes the text for one. Nothing is said about it.
  "lib.ts": `export const value: number = 1;\nexport const prose = 'it comes from "./${"a long way off ".repeat(20)}/here", they say';`,
  "preload.ts": `(globalThis as any).fromPreload = 2;`,
  "a.test.ts": passing("a"),
  "b.test.ts": passing("b"),
  "c.test.ts": passing("c"),
  "d.test.ts": passing("d") + `test.skip("d skipped", () => {});\n`,
  "e.test.ts": passing("e") + `test("e fails", () => { expect(1).toBe(2); });\n`,
  "f.test.ts": passing("f"),
  "g.test.ts": `import { nothing } from "./no-such-file";\nconsole.log(nothing);\n${passing("g")}`,
};

const twoFiles = "TestRunLayers:2,TestRunPartFiles:2";
const envOf = (words?: string) => (words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv);

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", "--preload", "./preload.ts", ...flags],
    directory,
    envOf(words),
  );
  const results = [...stderr.matchAll(/^\((pass|fail|skip)\) (.*?)(?: \[.*\])?$/gm)].map(
    match => `${match[1]} ${match[2]}`,
  );
  const count = (word: string) => stderr.match(new RegExp(`^ *(\\d+) ${word}$`, "m"))?.[1];
  return {
    stdout: stdout
      .split("\n")
      .filter(line => line.includes(" ran with ") || line.startsWith("error"))
      .sort(),
    results: results.sort(),
    ran: stderr.match(/^Ran \d+ tests? across \d+ files?/m)?.[0],
    saysOfFolders: stderr.match(/^.*Cannot read directory.*$/m)?.[0],
    pass: count("pass"),
    skip: count("skip"),
    fail: count("fail"),
    exitCode,
  };
}

test("a test run in parts reads as one run", async () => {
  using dir = tempDir("aot-test-run-in-parts", files);
  const plain = await runTests(String(dir), undefined);
  expect(plain.pass).toBe("6");
  expect(await runTests(String(dir), twoFiles, "--aot")).toEqual(plain);
}, 120_000);

test("under --parallel the parts run at once, with the same report", async () => {
  using dir = tempDir("aot-test-run-in-parts-parallel", files);
  const plain = await runTests(String(dir), undefined, "--parallel=3");
  expect(await runTests(String(dir), twoFiles, "--aot", "--parallel=3")).toEqual(plain);
}, 120_000);

test("with --timings the parts take about as long as one another, and each begins with its slowest file", async () => {
  using dir = tempDir("aot-test-run-in-parts-timings", {
    ...files,
    // No time for c: a file nobody has timed may be slow, so it is dealt first, and it counts as one of the slowest tenth, 5000 ms.
    "timings.json": JSON.stringify({
      version: 1,
      files: { "a.test.ts": 10, "b.test.ts": 20, "d.test.ts": 900, "e.test.ts": 30, "f.test.ts": 5000, "g.test.ts": 1 },
    }),
  });
  const { stderr } = await run(
    [bunExe(), "test", "--preload", "./preload.ts", "--aot", "--parallel=1", "--timings=timings.json"],
    String(dir),
    envOf(twoFiles),
  );
  // Each file goes to the part that has the least so far: c | f | d | e b a g. A worker runs a part to its end.
  // g imports a file that is not there, and whether its name is printed is not asked here.
  const order = [...stderr.matchAll(/^([a-f])\.test\.ts:$/gm)].map(match => match[1]).join("");
  expect(order).toContain("eba");
  expect(order).toHaveLength(6);
  const plain = await runTests(String(dir), undefined, "--parallel=3");
  expect(await runTests(String(dir), twoFiles, "--aot", "--parallel=3", "--timings=timings.json")).toEqual(plain);
}, 120_000);

// `sabotage=StoredValuesAreNeverRead` loses values on purpose, and the compiler stops at the read in `leftOf` with an internal error that names the file.
// The word loses them in every file, so the other files read nothing that was stored.
const readsNothingStored = (name: string) => `import { test, expect } from "bun:test";
test("${name}", () => {
  expect(1 + 2).toBe(3);
});
`;
const stopsTheCompiler = {
  ...files,
  ...Object.fromEntries(["a", "b", "d", "e", "f", "g"].map(name => [`${name}.test.ts`, readsNothingStored(name)])),
  "stops.ts": `type Pair = { left: number; right: string };
function leftOf(pair: Pair): number {
  const left = pair.left;
  return left + 1;
}
export const two: number = leftOf({ left: 1, right: "two" });
`,
  "c.test.ts": `import { two } from "./stops";\nconsole.log(two);\n${readsNothingStored("c")}`,
};
const hasTheWord = !unsupported && registry().sabotages?.includes("StoredValuesAreNeverRead");

// The word stops the compiler in Bun's own code too, all of which the program that parts share holds. So this is asked of one program.
test.skipIf(!hasTheWord)(
  "an internal error of the compiler fails the test files that import the file it names",
  async () => {
    using dir = tempDir("aot-test-run-internal-error", stopsTheCompiler);
    const { stderr, exitCode } = await run(
      [bunExe(), "test", "--preload", "./preload.ts", "--aot", "--parallel=2"],
      String(dir),
      envOf("sabotage=StoredValuesAreNeverRead"),
    );
    expect(stderr).toMatch(
      /internal compiler error \(AnalyzeFlow\): OperationWithoutValue: .* in function 'leftOf' at .*stops\.ts:3:/,
    );
    expect(stderr).toContain("bun test --aot does not run this file");
    expect(stderr).not.toContain("could not be compiled");
    for (const name of ["a", "b", "d", "e", "f", "g"]) expect(stderr).toContain(`(pass) ${name}`);
    expect(stderr).not.toContain("(pass) c");
    expect(exitCode).toBe(1);
  },
  120_000,
);

// Such a file is left to the loader of the run, which throws where it is imported, as under plain `bun test`.
test("a file that is no program, which the parts share, fails the test files that import it, and no other", async () => {
  using dir = tempDir("aot-test-run-in-parts-shared-error", {
    ...files,
    "stops.ts": `let same = 1;\nlet same = 2;\nexport const two: number = same;\n`,
    "between.ts": `export { two } from "./stops";\n`,
    "c.test.ts": `import { two } from "./between";\nconsole.log(two);\n${passing("c")}`,
    "g.test.ts": passing("g"),
  });
  const plain = await runTests(String(dir), undefined, "--parallel=2");
  expect(plain.results).toContain("pass g");
  expect(plain.results).not.toContain("pass c");
  expect(await runTests(String(dir), twoFiles, "--aot", "--parallel=2")).toEqual(plain);
}, 120_000);

test("a JavaScript test file runs beside a tsconfig.json that does not allow JavaScript", async () => {
  using dir = tempDir("aot-test-run-in-parts-javascript", {
    "tsconfig.json": "{}",
    "a.test.js": `import { test } from "bun:test";\ntest("a", () => {});\n`,
    "b.test.js": `import { test } from "bun:test";\ntest("b", () => {});\n`,
    "c.test.ts": `import { test } from "bun:test";\ntest("c", () => {});\n`,
  });
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--aot"],
    String(dir),
    envOf("TestRunLayers:2,TestRunPartFiles:1"),
  );
  for (const name of ["a", "b", "c"]) expect(stderr).toContain(`(pass) ${name}`);
  expect(exitCode).toBe(0);
}, 120_000);

test("where nothing that the test files import is a program, each test file fails by itself", async () => {
  using dir = tempDir("aot-test-run-in-parts-empty-layer", {
    ...files,
    "lib.ts": `let same = 1;\nlet same = 2;\nexport const value: number = same;\n`,
    "g.test.ts": `import { test } from "bun:test";\ntest("g", () => {});\n`,
  });
  const plain = await runTests(String(dir), undefined);
  expect(plain.results).toEqual(["pass g"]);
  expect(await runTests(String(dir), twoFiles, "--aot")).toEqual(plain);
}, 120_000);

// Windows has no signal to die by.
test.skipIf(isWindows)(
  "a worker that crashes costs the file that it ran, and the run goes on",
  async () => {
    using dir = tempDir("aot-test-run-in-parts-crash", {
      ...files,
      "c.test.ts": `${passing("c")}test("c crashes", () => {\n  process.kill(process.pid, "SIGABRT");\n  Bun.sleepSync(5000);\n});\n`,
      "g.test.ts": passing("g"),
    });
    const { stderr, exitCode } = await run(
      [bunExe(), "test", "--preload", "./preload.ts", "--aot", "--parallel=2"],
      String(dir),
      envOf(twoFiles),
    );
    expect(stderr).toMatch(/c\.test\.ts.*\(worker crashed: SIGABRT\)/);
    expect(stderr).not.toContain("Aborting");
    // d is in the part of c.
    for (const name of ["a", "b", "d", "e", "f", "g"]) expect(stderr).toContain(`(pass) ${name}`);
    expect(exitCode).toBe(1);
  },
  120_000,
);

// The word makes the compiler fail an assertion where it compiles a function of this name.
test.skipIf(!(!unsupported && registry().sabotages?.includes("FunctionPassFailsAssertion")))(
  "a test file that brings the compiler down fails alone",
  async () => {
    using dir = tempDir("aot-test-run-in-parts-compiler-crash", {
      ...files,
      "c.test.ts": `function stopsTheCompiler(value: number): number {\n  return value + 1;\n}\nconsole.log(stopsTheCompiler(1));\n${passing("c")}`,
      "g.test.ts": passing("g"),
    });
    const { stderr, exitCode } = await run(
      [bunExe(), "test", "--preload", "./preload.ts", "--aot", "--parallel=2"],
      String(dir),
      { ...envOf(`${twoFiles},sabotage=FunctionPassFailsAssertion`), BUN_ENABLE_CRASH_REPORTING: "0" },
    );
    expect(stderr).toMatch(/2 test files together could not be compiled: .*\. Each is compiled by itself/);
    expect(stderr).toMatch(/c\.test\.ts.*\(could not be compiled: /);
    // d is in the part of c.
    for (const name of ["a", "b", "d", "e", "f", "g"]) expect(stderr).toContain(`(pass) ${name}`);
    expect(stderr).not.toContain("(pass) c");
    expect(exitCode).toBe(1);
  },
  120_000,
);

// The word makes the compiler fail an assertion in every build, so in that of the lowest layer.
test.skipIf(!(!unsupported && registry().sabotages?.includes("ProgramPassFailsAssertion")))(
  "where what the test files import cannot be built, that is said once",
  async () => {
    using dir = tempDir("aot-test-run-in-parts-layer-crash", files);
    const { stderr, exitCode } = await run(
      [bunExe(), "test", "--preload", "./preload.ts", "--aot", "--parallel=2"],
      String(dir),
      { ...envOf(`${twoFiles},sabotage=ProgramPassFailsAssertion`), BUN_ENABLE_CRASH_REPORTING: "0" },
    );
    expect(stderr.split("\n").filter(line => line.includes("could not be compiled"))).toEqual([
      expect.stringMatching(
        /^error: what the test files import could not be compiled: .*\. None of the 7 test files ran$/,
      ),
    ]);
    expect(stderr).not.toContain("(pass)");
    expect(exitCode).toBe(1);
  },
  120_000,
);

test("the junit report of a run in parts has every test", async () => {
  using dir = tempDir("aot-test-run-in-parts-junit", files);
  const junit = ["--reporter=junit", "--reporter-outfile=out.xml"];
  await runTests(String(dir), twoFiles, "--aot", ...junit);
  const report = readFileSync(join(String(dir), "out.xml"), "utf8");
  for (const name of ["a", "b", "c", "d", "e", "f", "e fails", "d skipped"]) {
    expect(report).toContain(`name="${name}"`);
  }
}, 120_000);

test("a part that cannot build fails only the file that cannot", async () => {
  using dir = tempDir("aot-test-run-in-parts-bad", {
    ...files,
    "g.test.ts": `let same = 1;\nlet same = 2;\n${passing("g")}`,
  });
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--preload", "./preload.ts", "--aot"],
    String(dir),
    envOf(twoFiles),
  );
  expect(stderr).toMatch(/^ *6 pass$/m);
  expect(stderr).toMatch(/^ *2 fail$/m);
  expect(stderr).toContain("g.test.ts");
  expect(exitCode).toBe(1);
}, 120_000);

test("a test file with a syntax error, alone in its part, is reported as in a run of one program", async () => {
  // No preload: the part's build has the one file to begin with.
  const { "preload.ts": _, "g.test.ts": __, ...rest } = files;
  using dir = tempDir("aot-test-run-in-parts-syntax-error", {
    ...Object.fromEntries(
      Object.entries(rest).map(([name, text]) => [name, text.replace(" + (globalThis as any).fromPreload", " + 2")]),
    ),
    "g.test.ts": `import { test, expect } from "bun:test";\ntest("g", () => {\n  expect(1).toBe(1;\n});\n`,
  });
  async function report(words?: string) {
    const junit = ["--reporter=junit", "--reporter-outfile=out.xml"];
    const { stderr, exitCode } = await run([bunExe(), "test", "--aot", ...junit], String(dir), envOf(words));
    // Not the line that names the file above what a worker wrote: the words and the end of the file come by two pipes.
    const lines = stderr.split("\n").filter(line => /g\.test\.ts:\d|^error|^ *\d+ (pass|fail|error)/.test(line));
    const cases = [...readFileSync(join(String(dir), "out.xml"), "utf8").matchAll(/<testcase name="([^"]*)"/g)];
    return { lines: lines.sort(), cases: cases.map(match => match[1]).sort(), exitCode };
  }
  const one = await report();
  expect(one.lines).toContainEqual(expect.stringContaining("TS1005"));
  expect(one.cases).not.toContain("(worker crashed)");
  expect(await report("TestRunLayers:2,TestRunPartFiles:1")).toEqual(one);
  expect(await report(twoFiles)).toEqual(one);
}, 120_000);

test("a CommonJS file that a test file requires has the test file for its parent, in a realm of its own too", async () => {
  using dir = tempDir("aot-test-run-in-parts-parent", {
    ...files,
    "helper.cjs": `const base = path => String(path).split(/[\\\\/]/).pop();\nmodule.exports = base(module.id) + " " + base(module.parent && module.parent.filename);\n`,
    "h.test.ts": `${passing("h")}test("parent", () => {\n  console.log("helper.cjs ran with " + require("./helper.cjs"));\n});\n`,
  });
  const plain = await runTests(String(dir), undefined, "--isolate");
  expect(plain.stdout).toContain("helper.cjs ran with helper.cjs h.test.ts");
  expect(await runTests(String(dir), twoFiles, "--aot", "--isolate")).toEqual(plain);
}, 120_000);

test("a large file that the parts share reads as a small one: values, positions of errors, the texts of functions", async () => {
  const functions = (letter: string, count: number) =>
    Array.from(
      { length: count },
      (_, index) =>
        `export function ${letter}${index}(value: number): number {\n  // ${letter}${index}: \u00e4\u00f6\u00fc \u20ac\n  if (value === ${index}) throw new Error("${letter}${index} refuses " + value);\n  return value * ${index} + 1;\n}\n`,
    ).join("");
  // The second file ends where a page ends, and the third begins with a byte order mark.
  const wholePages = functions("w", 200);
  const rest = 4096 - (Buffer.byteLength(wholePages) % 4096);
  using dir = tempDir("aot-test-run-in-parts-large", {
    ...files,
    "large.ts": functions("l", 400),
    "whole-pages.ts": wholePages + "//" + "x".repeat(rest + 4096 - 3) + "\n",
    "marked.ts": "\ufeff" + functions("m", 200),
    "i.test.ts": `${passing("i")}import * as large from "./large";\nimport * as wholePages from "./whole-pages";\nimport * as marked from "./marked";
test("large files", () => {
  for (const [all, letter, last] of [[large, "l", 399], [wholePages, "w", 199], [marked, "m", 199]] as const) {
    const where = (() => { try { (all as any)[letter + last](last); } catch (error: any) { return error.message + String(error.stack).split("\\n")[1].replace(/^.*[\\\\/]/, " "); } })();
    console.log(letter + " ran with", Object.keys(all).length, (all as any)[letter + 7](3), where, Bun.hash((all as any)[letter + last].toString().replace(/\\s+|\\/\\/.*|new /g, "")));
  }
});\n`,
  });
  expect(Buffer.byteLength(await Bun.file(String(dir) + "/whole-pages.ts").text()) % 4096).toBe(0);
  const one = await runTests(String(dir), "TestRunLayers:0", "--aot", "--isolate");
  expect(one.stdout.join("\n")).toContain("l ran with 400 22 l399 refuses 399 large.ts:");
  expect(one.stdout.length).toBeGreaterThanOrEqual(3);
  expect(await runTests(String(dir), twoFiles, "--aot", "--isolate")).toEqual(one);
}, 120_000);

test("a shell script that a test file imports is its path", async () => {
  using dir = tempDir("aot-test-run-in-parts-shell-script", {
    ...files,
    "script.sh": "echo script\n",
    "j.test.ts": `${passing("j")}// @ts-ignore\nimport spelled from "./script.sh";
const base = (path: unknown) => String(path).split(/[\\\\/]/).pop();
test("script", async () => {
  const name = "./script";
  console.log("script.sh ran with", base(spelled), base((await import(name + ".sh")).default), base((await import("./script.sh")).default));
});\n`,
  });
  const plain = await runTests(String(dir), undefined, "--isolate");
  expect(plain.stdout).toContain("script.sh ran with script.sh script.sh script.sh");
  expect(await runTests(String(dir), "TestRunLayers:0", "--aot", "--isolate")).toEqual(plain);
  expect(await runTests(String(dir), twoFiles, "--aot", "--isolate")).toEqual(plain);
}, 120_000);

test("what is the host's stays when a Bun.ModuleGraph that used it is disposed", async () => {
  // Without the test file that cannot be built: beside it the library is compiled with the test file that uses it.
  using dir = tempDir("aot-test-run-in-parts-module-graph", {
    "lib.ts": files["lib.ts"],
    "preload.ts": files["preload.ts"],
    "a.test.ts": files["a.test.ts"],
    "l.test.ts": `${passing("l")}// @ts-nocheck
import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("graphs", async () => {
  const appPath = join(mkdtempSync(join(tmpdir(), "graph-app-")), "app.mjs");
  writeFileSync(appPath, 'import http from "node:http";\\nexport const getThrough = (agent, port, path) => new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port, path, agent }, response => { response.resume(); response.on("end", resolve); }).on("error", reject));\\n');
  const open = new Set();
  const server = http.createServer(request => {
    const tag = request.url.slice(1);
    open.add(tag);
    request.socket.on("close", () => open.delete(tag));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const until = async condition => { for (let i = 0; i < 400 && !condition(); i++) await Bun.sleep(5); return condition(); };
  const ofHost = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const seen = [];
  for (const [tag, agentOf] of [["host", () => ofHost], ["global", () => undefined], ["graph", () => new http.Agent({ keepAlive: true })]]) {
    const graph = new Bun.ModuleGraph({});
    const app = await graph.import(appPath);
    graph.run(() => app.getThrough(agentOf(), port, "/" + tag)).catch(() => {});
    seen.push(tag, await until(() => open.has(tag)));
    graph.dispose();
    await until(() => !open.has(tag) || tag !== "graph");
    await Bun.sleep(50);
    seen.push(open.has(tag));
  }
  console.log("the graphs ran with", seen.join(" "));
  ofHost.destroy();
  server.closeAllConnections();
  server.close();
});\n`,
  });
  const plain = await runTests(String(dir), undefined, "--isolate");
  expect(plain.stdout).toContain("the graphs ran with host true true global true true graph true false");
  expect(await runTests(String(dir), twoFiles, "--aot", "--isolate")).toEqual(plain);
}, 120_000);
