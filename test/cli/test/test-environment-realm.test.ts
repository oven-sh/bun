import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// With --isolate, `bun test` loads happy-dom once, into a global that outlives the test files.
// The package then checks a value of a test file with `instanceof` against a class of that global.

// Checks as happy-dom does, and loads in a debug build without the seconds that happy-dom takes.
const fakeHappyDOM = `
  const { ReadableStream } = require("stream/web");
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
    isStream = value => value instanceof ReadableStream;
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

test.concurrent.each([[], ["--isolate"], ["--isolate=modules"]])(
  "happy-dom takes a ReadableStream and a Date of the test file: %s",
  async (...args) => {
    using dir = tempDir("test-environment-realm", {
      "node_modules/happy-dom/package.json": JSON.stringify({ name: "happy-dom", main: "index.js" }),
      "node_modules/happy-dom/index.js": fakeHappyDOM,
      "bunfig.toml": `[test]\nenvironment = "happy-dom"\n`,
      "1.test.js": testFile,
      "2.test.js": testFile,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      cwd: String(dir),
      env: { ...bunEnv, NODE_PATH: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const expected = [
      "body hi [object ReadableStream]",
      "streams true,true,true false,false,false,false false,false,false",
      "dates true,true false,false,false,false false,false",
      "own 0 0",
    ];
    // slice(1) drops the "bun test v1.2.3" banner.
    expect(stdout.split("\n").slice(1).filter(Boolean)).toEqual([...expected, ...expected]);
    expect(stderr.match(/^ *\d+ (?:pass|fail)$/gm)?.map(line => line.trim())).toEqual(["8 pass", "0 fail"]);
    expect(exitCode).toBe(0);
  },
);
