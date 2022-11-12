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
  it("should allow us to write to it", (done) => {
    const stdin = _stdinInit({ require: _require });
    const stdout = _stdoutInit({ require: _require });
    const stderr = _stderrInit({ require: _require });

    process.stdin = stdin;
    process.stdout = stdout;
    process.stderr = stderr;

    // process.stdout.pipe(process.stdin);
    process.stdin.on("data", (data) => {
      expect(data).toBe("hello");
      done();
    });
    process.stdout.write("hello");
  });
});
