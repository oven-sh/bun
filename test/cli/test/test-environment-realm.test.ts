import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

// With --isolate, `bun test` loads happy-dom once, into a global that outlives the test files.
// The package then checks a value of a test file with `instanceof` against a class of that global.

const bunfig = `[test]\nenvironment = "happy-dom"\n`;
const modes = [[], ["--isolate"], ["--isolate=modules"]];

async function bunTest(cwd: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd,
    env: { ...bunEnv, NODE_PATH: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    // slice(1) drops the "bun test v1.2.3" banner.
    printed: stdout.split("\n").slice(1).filter(Boolean),
    counts: stderr.match(/^ *\d+ (?:pass|fail)$/gm)?.map(line => line.trim()),
    exitCode,
  };
}

// Checks as happy-dom does, and loads in a debug build without the seconds that happy-dom takes.
// happy-dom has the class by require() in its CommonJS build and by import in its ES module build.
const fakeHappyDOM = `
  const { ReadableStream } = require("stream/web");
  const { isImportedStream } = require("./imports.mjs");
  class Stream extends ReadableStream {}
  class Day extends Date {}
  // As happy-dom's FetchBodyUtility does.
  class Response {
    #body;
    constructor(body) {
      this.#body = body;
    }
    async text() {
      if (!(this.#body instanceof ReadableStream)) return String(this.#body);
      const decoder = new TextDecoder();
      let text = "";
      for await (const chunk of this.#body) text += decoder.decode(chunk, { stream: true });
      return text;
    }
  }
  exports.Window = class Window {
    document = { defaultView: this };
    happyDOM = { async abort() {} };
    close() {}
    Response = Response;
    isStream = value => value instanceof ReadableStream && isImportedStream(value);
    // As happy-dom's \`input.valueAsDate\` setter does.
    isDate = value => value instanceof Date;
    isSubclassInstance = value => value instanceof Stream || value instanceof Day;
  };`;

const testFile = `
  import { test } from "bun:test";
  const show = (is, values) => values.map(is).join();
  const source = {
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hi"));
      controller.close();
    },
  };
  test("a body", async () => {
    const imitation = { [Symbol.toStringTag]: "ReadableStream", getReader() {} };
    console.log("body", await new Response(new ReadableStream(source)).text(), await new Response(imitation).text());
  });
  test("streams", () => {
    const streams = [new ReadableStream(), Bun.file(import.meta.path).stream(), new TransformStream().readable];
    const others = [{ [Symbol.toStringTag]: "ReadableStream" }, new WritableStream(), null, "a"];
    console.log("streams", show(isStream, streams), show(isStream, others), show(isSubclassInstance, streams));
  });
  test("dates", () => {
    const dates = [new Date(0), new (class extends Date {})(0)];
    const others = [{ getTime() {} }, "1970-01-01", 0, null];
    console.log("dates", show(isDate, dates), show(isDate, others), show(isSubclassInstance, dates));
  });
  test("the classes of the test file", () => {
    console.log("own", Object.getOwnPropertySymbols(ReadableStream).length, Object.getOwnPropertySymbols(Date).length);
  });`;

// The repro of https://github.com/oven-sh/bun/issues/49396, and the same for a Request and for `input.valueAsDate`.
const realTestFile = `
  import { test } from "bun:test";
  const source = {
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hi"));
      controller.close();
    },
  };
  test("a Response", async () => {
    const body = new ReadableStream(source);
    const response = new Response(body);
    const clone = new Response(new ReadableStream(source)).clone();
    console.log("response", response.body === body, response.headers.get("content-type"), await response.text(), await clone.text());
  });
  test("a Request", async () => {
    const request = new Request("http://localhost:3000/", { method: "POST", body: new ReadableStream(source) });
    console.log("request", await request.text());
  });
  test("a Date", () => {
    const input = document.createElement("input");
    input.type = "date";
    input.valueAsDate = new Date(Date.UTC(2024, 0, 2));
    console.log("date", input.value);
  });`;

describe.concurrent("happy-dom takes a ReadableStream and a Date of the test file", () => {
  test.each(modes)("a package that checks as happy-dom does: %s", async (...args) => {
    using dir = tempDir("test-environment-realm", {
      "node_modules/happy-dom/package.json": JSON.stringify({ name: "happy-dom", main: "index.js" }),
      "node_modules/happy-dom/index.js": fakeHappyDOM,
      "node_modules/happy-dom/imports.mjs": `
        import { ReadableStream } from "stream/web";
        export const isImportedStream = value => value instanceof ReadableStream;`,
      "bunfig.toml": bunfig,
      "1.test.js": testFile,
      "2.test.js": testFile,
    });
    const expected = [
      "body hi [object ReadableStream]",
      "streams true,true,true false,false,false,false false,false,false",
      "dates true,true false,false,false,false false,false",
      "own 0 0",
    ];
    expect(await bunTest(String(dir), args)).toEqual({
      printed: [...expected, ...expected],
      counts: ["8 pass", "0 fail"],
      exitCode: 0,
    });
  });

  // A debug build takes longer than the default timeout to load the package.
  test.skipIf(isDebug).each(modes)("the package: %s", async (...args) => {
    using dir = tempDir("test-environment-realm", {
      "bunfig.toml": bunfig,
      "1.test.js": realTestFile,
      "2.test.js": realTestFile,
    });
    mkdirSync(join(String(dir), "node_modules"));
    const target = dirname(Bun.resolveSync("happy-dom/package.json", import.meta.dir));
    symlinkSync(target, join(String(dir), "node_modules", "happy-dom"), "junction");
    const expected = ["response true null hi hi", "request hi", "date 2024-01-02"];
    expect(await bunTest(String(dir), args)).toEqual({
      printed: [...expected, ...expected],
      counts: ["6 pass", "0 fail"],
      exitCode: 0,
    });
  });
});
