import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, preadExact, tempDir } from "harness";
import { closeSync, copyFileSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";

// Windows commits a stack page by page, through the guard page below what is committed. The code that
// the RegExp JIT makes moves the stack pointer by its whole frame at once. On the thread that runs
// JavaScript that is safe: JavaScriptCore commits that stack first. The DFG also runs a match on a JIT
// thread, to fold it when the pattern and the string are constants. There, a frame larger than what the
// thread had committed was written below the guard page, and the process ended with an access violation
// (exit code 0xC0000005) and no message.
//
// A thread starts with the stack commit that the PE header of the executable states. With 2 MB there,
// every frame under 2 MB fits. The copy of bun.exe that this test runs starts its threads with one page,
// whatever the header of bun.exe says.

/** Sets SizeOfStackCommit in the optional header of a PE32+ file, and returns what the header then holds. */
function setStackCommit(path: string, commit: number): number {
  const fd = openSync(path, "r+");
  try {
    const dos = preadExact(fd, 0, 64);
    if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error("not PE (no MZ)");
    const pe = dos.readUInt32LE(60);
    if (preadExact(fd, pe, 4).readUInt32LE(0) !== 0x00004550) throw new Error("not PE (no PE\\0\\0)");
    const optionalHeader = pe + 4 + 20;
    if (preadExact(fd, optionalHeader, 2).readUInt16LE(0) !== 0x20b) throw new Error("not PE32+");
    const field = Buffer.alloc(8);
    field.writeBigUInt64LE(BigInt(commit));
    writeSync(fd, field, 0, 8, optionalHeader + 80);
    return Number(preadExact(fd, optionalHeader + 80, 8).readBigUInt64LE(0));
  } finally {
    closeSync(fd);
  }
}

// The frame of the match is 16 bytes for each "a?": 128 KB.
const pattern = `/^${Buffer.alloc(8000 * 2, "a?").toString()}b$/`;

// The event loop calls each function, so nothing inlines it and the DFG compiles it by itself. The script
// goes on to the next function when that code is in place: the JIT thread has then folded the match, or
// has given the fold up.
const task = (name: string, match: string, next: string) => `
  let ${name}Calls = 0;
  let ${name}Matches = 0;
  function ${name}() {
    ${name}Calls++;
    if (${match}) ${name}Matches++;
    if (numberOfDFGCompiles(${name}) === 0 && ${name}Calls < 100000) return setImmediate(${name});
    const compiled = numberOfDFGCompiles(${name}) > 0 ? "compiled by the DFG" : "not compiled by the DFG";
    const matched = ${name}Matches === ${name}Calls ? "every call matched" : ${name}Matches + " of " + ${name}Calls + " calls matched";
    console.log("${name}: " + compiled + ", " + matched);
    ${next}
  }
`;
const script = `
  const { numberOfDFGCompiles } = require("bun:jsc");
  ${task("test", `${pattern}.test("aaab")`, "exec();")}
  ${task("exec", `${pattern}.exec("aaab") !== null`, "")}
  test();
`;

test.skipIf(!isWindows)(
  "a match that the DFG folds on a JIT thread stays within the stack that the thread has committed",
  async () => {
    using dir = tempDir("regexp-fold-jit-thread-stack", { "fold.js": script });
    // A copy, not a link: the edit of the header must not reach the bun.exe under test.
    const exe = join(String(dir), "bun-with-one-page-of-stack-commit.exe");
    copyFileSync(bunExe(), exe);
    expect(setStackCommit(exe, 0x1000)).toBe(0x1000);

    // A file, not -e: a one-shot run compiles on the thread that runs JavaScript.
    await using proc = Bun.spawn({
      cmd: [exe, "fold.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
      stdout: ["test: compiled by the DFG, every call matched", "exec: compiled by the DFG, every call matched"],
      stderr: "",
      exitCode: 0,
    });
  },
);
