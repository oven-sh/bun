// How a test run reads: ./test-run-in-parts.test.ts.
import { expect } from "bun:test";
import { tempDir } from "harness";
import { files, passing, runTests } from "./harness/test-run-in-parts";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

// Four things that code sees, each in a test file of its own, in ONE project: a build costs what it costs whatever stands in it.
test("code sees in a compiled test run what it sees in a plain one", async () => {
  const functions = (letter: string, count: number) =>
    Array.from(
      { length: count },
      (_, index) =>
        `export function ${letter}${index}(value: number): number {\n  // ${letter}${index}: \u00e4\u00f6\u00fc \u20ac\n  if (value === ${index}) throw new Error("${letter}${index} refuses " + value);\n  return value * ${index} + 1;\n}\n`,
    ).join("");
  // The second file ends where a page ends, and the third begins with a byte order mark.
  const wholePages = functions("w", 200);
  const rest = 4096 - (Buffer.byteLength(wholePages) % 4096);
  using dir = tempDir("aot-test-run-in-parts-what-code-sees", {
    ...files,
    // A CommonJS file that a test file requires has the test file for its parent, in a realm of its own too.
    "helper.cjs": `const base = path => String(path).split(/[\\\\/]/).pop();\nmodule.exports = base(module.id) + " " + base(module.parent && module.parent.filename);\n`,
    "h.test.ts": `${passing("h")}test("parent", () => {\n  console.log("helper.cjs ran with " + require("./helper.cjs"));\n});\n`,
    // A large file reads as a small one: values, positions of errors, the texts of functions.
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
    // A shell script that a test file imports is its path.
    "script.sh": "echo script\n",
    "j.test.ts": `${passing("j")}// @ts-ignore\nimport spelled from "./script.sh";
const base = (path: unknown) => String(path).split(/[\\\\/]/).pop();
test("script", async () => {
  const name = "./script";
  console.log("script.sh ran with", base(spelled), base((await import(name + ".sh")).default), base((await import("./script.sh")).default));
});\n`,
    // A mock that comes before an ES module is loaded stands for the whole module.
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
  expect(Buffer.byteLength(await Bun.file(String(dir) + "/whole-pages.ts").text()) % 4096).toBe(0);
  const plain = await runTests(String(dir), "--isolate");
  expect(plain.stdout).toContain("helper.cjs ran with helper.cjs h.test.ts");
  expect(plain.stdout).toContain("script.sh ran with script.sh script.sh script.sh");
  expect(plain.stdout).toContain("the mock ran with fake given undefined undefined false");
  expect(plain.stdout).toContain("a module that was loaded ran with fake 2 given,kept");
  const compiled = await runTests(String(dir), "--aot", "--isolate");
  const seen = compiled.stdout.join("\n");
  expect(seen).toContain("l ran with 400 22 l399 refuses 399 large.ts:");
  expect(seen).toContain("w ran with 200 22 w199 refuses 199 whole-pages.ts:");
  expect(seen).toContain("m ran with 200 22 m199 refuses 199 marked.ts:");
  // Of the large files plain Bun prints other columns and other texts.
  const withoutLargeFiles = (ran: typeof plain) => ({
    ...ran,
    stdout: ran.stdout.filter(line => !/^[lwm] ran with /.test(line)),
  });
  expect(withoutLargeFiles(compiled)).toEqual(withoutLargeFiles(plain));
}, 240_000);

test("what is the host's stays when a Bun.ModuleGraph that used it is disposed", async () => {
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
  const plain = await runTests(String(dir), "--isolate");
  expect(plain.stdout).toContain("the graphs ran with host true true global true true graph true false");
  expect(await runTests(String(dir), "--aot", "--isolate")).toEqual(plain);
}, 120_000);
