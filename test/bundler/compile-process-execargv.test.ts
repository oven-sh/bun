import { describe, expect } from "bun:test";
import type { BundlerTestRunOptions } from "./expectBundled";
import { itBundled } from "./expectBundled";

// argv[1] of a standalone executable is the entry point inside the embedded
// filesystem: "/$bunfs/root/out" on posix, "B:\\~BUN\\root\\out" on Windows.
const embeddedEntry = /^(\/\$bunfs|B:[\\/]~BUN)[\\/]root[\\/]out$/;

// A standalone executable owns its whole command line: nothing is parsed as a
// runtime flag, so execArgv is empty and every argument, including ones spelled
// like bun's own flags, reaches the script in order (#21298).
function passedThroughToScript(args: string[]): BundlerTestRunOptions {
  return {
    args,
    stderr: "",
    validate({ stdout }) {
      expect(JSON.parse(stdout)).toEqual({
        execArgv: [],
        argv: ["bun", expect.stringMatching(embeddedEntry), ...args],
      });
    },
  };
}

describe("bundler", () => {
  // One compile, run once per argument set. Each `bun build --compile` copies
  // and rewrites the whole bun binary (~1GB for debug and CI profile builds),
  // which is what this file's time consists of.
  itBundled("compile/ProcessExecArgvEmpty", {
    compile: true,
    backend: "cli",
    files: {
      "/entry.ts": /* js */ `
        console.log(JSON.stringify({ execArgv: process.execArgv, argv: process.argv }));
      `,
    },
    run: [
      passedThroughToScript(["-a", "--b"]),
      passedThroughToScript(["--verbose", "-p", "8080", "--config=test.json", "arg1", "arg2"]),
      passedThroughToScript(["--smol", "--inspect", "--version"]),
    ],
  });
});
