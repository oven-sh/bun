import { describe, it, expect } from "bun:test";
import nodeStream from "node:stream";
import nodeFs from "node:fs";

const {
  stdin: _stdinInit,
  stdout: _stdoutInit,
  stderr: _stderrInit,
} = import.meta.require("../../src/bun.js/process-stdio-polyfill.js");

function _require(mod) {
  if (mod === "node:stream") return nodeStream;
  if (mod === "node:fs") return nodeFs;
  throw new Error(`Unknown module: ${mod}`);
}

describe("process.stdout", () => {
  it("should allow us to write to it", () => {
    const stdout = _stdoutInit({ require: _require });

    process.stdout = stdout;

    process.stdout.write("hello");
  });
});

describe("process.stdout", () => {
  it("should allow us to write to it", (done) => {
    const stdin = _stdinInit({ require: _require });

    process.stdin = stdin;

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (data) => {
      console.log("received data:", data);
      expect(data).toEqual("hello");
      done();
    });

    process.stdin.write("hello");
  });
});
