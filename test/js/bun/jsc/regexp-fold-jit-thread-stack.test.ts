import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, preadExact, tempDir } from "harness";
import { closeSync, copyFileSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";

// Windows commits a stack page by page, through the guard pages below what is committed. The code that
// the RegExp JIT makes moves the stack pointer by its whole frame at once. On the thread that runs
// JavaScript that is safe: JavaScriptCore commits that stack down to its limit first. The DFG also runs a
// match on a JIT thread, to fold it when the pattern and the string are constants. There, a frame larger
// than what the thread had committed was written below the guard pages, and the process ended with an
// access violation (exit code 0xC0000005) and no message.
//
// A thread starts with the stack commit that the PE header of the executable states.

/** Returns SizeOfStackCommit from the optional header of a PE32+ file. With `commit`, sets it first. */
function stackCommit(path: string, commit?: number): number {
  const fd = openSync(path, commit === undefined ? "r" : "r+");
  try {
    const dos = preadExact(fd, 0, 64);
    if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error("not PE (no MZ)");
    const pe = dos.readUInt32LE(60);
    if (preadExact(fd, pe, 4).readUInt32LE(0) !== 0x00004550) throw new Error("not PE (no PE\\0\\0)");
    const optionalHeader = pe + 4 + 20;
    if (preadExact(fd, optionalHeader, 2).readUInt16LE(0) !== 0x20b) throw new Error("not PE32+");
    if (commit !== undefined) {
      const field = Buffer.alloc(8);
      field.writeBigUInt64LE(BigInt(commit));
      writeSync(fd, field, 0, 8, optionalHeader + 80);
    }
    return Number(preadExact(fd, optionalHeader + 80, 8).readBigUInt64LE(0));
  } finally {
    closeSync(fd);
  }
}

// The frame of the match is 16 bytes for each "a?".
const terms = (count: number, last: string) => `/^${Buffer.alloc(count * 2, "a?").toString()}${last}$/`;

// The event loop calls each function until the DFG has compiled it, so nothing inlines the function. The
// script then goes on to the next function: the JIT thread has folded the match, or has given the fold up.
const task = (name: string, match: string, next: string) => `
  let ${name}Calls = 0;
  let ${name}Matches = 0;
  function ${name}() {
    ${name}Calls++;
    if (${match}) ${name}Matches++;
    if (numberOfDFGCompiles(${name}) === 0) return setImmediate(${name});
    console.log("${name}: " + (${name}Matches === ${name}Calls ? "every call matched" : ${name}Matches + " of " + ${name}Calls + " calls matched"));
    ${next}
  }
`;

// A file, not -e: a one-shot run compiles on the thread that runs JavaScript.
async function run(exe: string, cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd: [exe, "fold.js"], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim().split("\n"), stderr, exitCode };
}

test.concurrent.skipIf(!isWindows)(
  "a match that the DFG folds on a JIT thread stays within the stack commit of bun.exe",
  async () => {
    // A frame of 2.24 MB. A thread of bun.exe starts with less than that.
    const count = 140000;
    expect(stackCommit(bunExe())).toBeLessThan(count * 16);

    using dir = tempDir("regexp-fold-jit-thread-stack", {
      "fold.js": `
        const { numberOfDFGCompiles } = require("bun:jsc");
        ${task("test", `${terms(count, "b")}.test("aaab")`, "")}
        test();
      `,
    });

    // A call takes about a millisecond with this pattern. The DFG compiles the function after 30 calls and not 1000.
    const result = await run(bunExe(), String(dir), {
      ...bunEnv,
      BUN_JSC_thresholdForJITAfterWarmUp: "10",
      BUN_JSC_thresholdForOptimizeAfterWarmUp: "20",
    });

    expect(result).toEqual({ stdout: ["test: every call matched"], stderr: "", exitCode: 0 });
  },
);

test.concurrent.skipIf(!isWindows)(
  "a match that the DFG folds on a JIT thread stays within one page of stack commit",
  async () => {
    // test() and exec(): a frame of 128 KB.
    const large = terms(8000, "b");
    // group(): a frame of 14 KB, and each turn of the group takes a ParenContext of that size from the stack.
    const group = `/^(?:${Buffer.alloc(600 * 4, "(a)?").toString()}b)+$/`;
    const turns = JSON.stringify(Buffer.alloc(24 * 2, "ab").toString());
    // interpreted(): a frame of 128 KB, and a RegExp that has bytecode. Its JIT code found no room at the bottom
    // of the stack, so the interpreter made that match. A JIT thread whose JIT code fails runs the interpreter too.
    const largeWithBytecode = terms(8000, "c");

    using dir = tempDir("regexp-fold-jit-thread-stack", {
      "fold.js": `
        const { numberOfDFGCompiles } = require("bun:jsc");
        function matchAtTheBottomOfTheStack() {
          try {
            return matchAtTheBottomOfTheStack();
          } catch {
            return ${largeWithBytecode}.test("aaac");
          }
        }
        ${task("test", `${large}.test("aaab")`, "exec();")}
        ${task("exec", `${large}.exec("aaab") !== null`, "group();")}
        ${task(
          "group",
          `${group}.test(${turns})`,
          `if (!${largeWithBytecode}.test("aaac") || !matchAtTheBottomOfTheStack()) throw new Error("no match");
           interpreted();`,
        )}
        ${task("interpreted", `${largeWithBytecode}.test("aaac")`, "")}
        test();
      `,
    });
    // A copy, not a link: the edit of the header must not reach the bun.exe under test.
    const exe = join(String(dir), "bun-with-one-page-of-stack-commit.exe");
    copyFileSync(bunExe(), exe);
    expect(stackCommit(exe, 0x1000)).toBe(0x1000);

    expect(await run(exe, String(dir))).toEqual({
      stdout: [
        "test: every call matched",
        "exec: every call matched",
        "group: every call matched",
        "interpreted: every call matched",
      ],
      stderr: "",
      exitCode: 0,
    });
  },
);
