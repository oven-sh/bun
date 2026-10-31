// How a run in parts reads: ./test-run-in-parts.test.ts.
import { expect } from "bun:test";
import { tempDir } from "harness";
import { files, passing, runTests, twoFiles } from "./harness/test-run-in-parts";
import { test } from "./supported";

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

test("a mock that comes before an ES module is loaded stands for the whole module", async () => {
  using dir = tempDir("aot-test-run-in-parts-mock-first", {
    ...files,
    "real.mjs": `console.log("real.mjs ran with its body");\nexport const given = () => "real";\nexport const leftOut = 1;\nexport default "real default";\n`,
    "loaded.mjs": `export const given = () => "real";\nexport const kept = 2;\n`,
    "k.test.ts": `${passing("k")}import { mock } from "bun:test";\nimport * as loaded from "./loaded.mjs";
mock.module("./real.mjs", () => ({ given: () => "fake" }));
mock.module("./loaded.mjs", () => ({ given: () => "fake" }));
test("mocks", async () => {
  const real = await import("./real.mjs");
  console.log("the mock ran with", real.given(), Object.keys(real).join(), typeof real.default, typeof real.leftOut, "default" in real);
  const name = "./real";
  const again = await import(name + ".mjs");
  console.log("the mock by a computed name ran with", again === real, typeof again.default, JSON.stringify({ ...again }));
  console.log("a module that was loaded ran with", loaded.given(), loaded.kept, Object.keys(loaded).join());
});\n`,
  });
  const plain = await runTests(String(dir), undefined, "--isolate");
  expect(plain.stdout).toContain("the mock ran with fake given undefined undefined false");
  expect(plain.stdout).toContain("a module that was loaded ran with fake 2 given,kept");
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
