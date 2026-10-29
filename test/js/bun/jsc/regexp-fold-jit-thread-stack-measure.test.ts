// TEMPORARY. Not a test: measurements on the Windows test machines for this pull request. It fails on purpose,
// so that its output reaches the failure report of the build. It is removed before the pull request is ready.
//
// For a match of /^(a?){N}b$/ against a constant string, which the DFG folds on a JIT thread: is the match folded,
// is it left in the code, or does the process die? By the size of the frame (16 bytes for each term), by the stack
// commit in the PE header of the executable, and by whether the function is the first one that the JIT thread
// optimizes or comes after another one.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, preadExact, tempDir } from "harness";
import { closeSync, copyFileSync, openSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

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

const operations = {
  test: (re: string) => `${re}.test("aaab")`,
  exec: (re: string) => `${re}.exec("aaab") !== null`,
  match: (re: string) => `"aaab".match(${re}) !== null`,
  search: (re: string) => `"aaab".search(${re}) === 0`,
  replace: (re: string) => `"aaab".replace(${re}, "x") === "x"`,
};
type Operation = keyof typeof operations;

// probe() is called by the event loop, so the DFG compiles it by itself. With `later`, warm() is compiled first.
const probeScript = (terms: number, operation: Operation, later: boolean) => `
  const { numberOfDFGCompiles } = require("bun:jsc");
  let calls = 0;
  let matches = 0;
  function probe() {
    calls++;
    if (${operations[operation](`/^${Buffer.alloc(terms * 2, "a?").toString()}b$/`)}) matches++;
    if (numberOfDFGCompiles(probe) === 0 && calls < 200000) return setImmediate(probe);
    console.log(JSON.stringify({ compiled: numberOfDFGCompiles(probe) > 0, matched: matches === calls }));
  }
  let warmCalls = 0;
  let sum = 0;
  function warm() {
    warmCalls++;
    for (let i = 0; i < 64; i++) sum = (sum + i * warmCalls) | 0;
    if (numberOfDFGCompiles(warm) === 0 && warmCalls < 200000) return setImmediate(warm);
    probe();
  }
  ${later ? "warm" : "probe"}();
`;

// What the DFG left in the code of probe(): F the match is folded, K it is kept (not folded), X the process died
// (with its exit code), ? anything else.
const matchNode =
  /\b(RegExpTest|RegExpTestInline|RegExpExec|RegExpExecNonGlobalOrSticky|RegExpSearch|RegExpMatchFast|RegExpMatchFastGlobal|StringReplace|StringReplaceRegExp|StringReplaceString)\(/;
async function outcome(exe: string, cwd: string, file: string, oneThread: boolean): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [exe, file],
    env: {
      ...bunEnv,
      BUN_JSC_dumpDFGDisassembly: "1",
      ...(oneThread ? { BUN_JSC_minNumberOfWorklistThreads: "1", BUN_JSC_maxNumberOfWorklistThreads: "1" } : {}),
    },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) return `X${exitCode}`;
  if (stdout.trim() !== '{"compiled":true,"matched":true}') return `?(${stdout.trim().slice(0, 60)})`;
  const start = stderr.indexOf("Generated DFG JIT code for probe#");
  if (start < 0) return "?(no code of probe)";
  const end = stderr.indexOf("\nGenerated ", start + 1);
  const code = stderr.slice(start, end < 0 ? undefined : end);
  return matchNode.test(code) ? "K" : "F";
}

/** "F5" when all five runs folded, "F3K2" when three folded and two did not, and so on. */
function tally(outcomes: string[]): string {
  const counts = new Map<string, number>();
  for (const o of outcomes) counts.set(o, (counts.get(o) ?? 0) + 1);
  return [...counts].map(([o, n]) => `${o}${o.length > 1 ? "x" : ""}${n}`).join("");
}

async function inBatches<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < jobs.length; i += size)
    results.push(...(await Promise.all(jobs.slice(i, i + size).map(job => job()))));
  return results;
}

function report(name: string, value: unknown) {
  const text = JSON.stringify({ [name]: value });
  for (let i = 0; i < text.length; i += 900) console.log(`MEASURE ${process.arch} ${text.slice(i, i + 900)}`);
}

test.skipIf(!isWindows)(
  "MEASURE folds of a match on a JIT thread, by frame size and stack commit",
  async () => {
    using dir = tempDir("regexp-fold-measure", {});
    const cwd = String(dir);
    const executables: Record<string, string> = {};
    for (const [name, commit] of [
      ["onePage", 0x1000],
      ["2MB", 0x200000],
    ] as const) {
      executables[name] = join(cwd, `bun-${name}.exe`);
      copyFileSync(bunExe(), executables[name]);
      if (isWindows) setStackCommit(executables[name], commit);
    }
    const runs = 5;
    const terms = [25, 50, 100, 150, 200, 250, 300, 375, 450, 540, 640, 800, 1000, 1250, 1500, 2000, 3000, 8000];

    // The folds of test(), one JIT thread. Columns: the number of terms.
    for (const header of ["onePage", "2MB"]) {
      for (const later of [false, true]) {
        const jobs = terms.flatMap(n => {
          const file = `test-${n}-${later ? "later" : "first"}.js`;
          writeFileSync(join(cwd, file), probeScript(n, "test", later));
          return Array.from({ length: runs }, () => () => outcome(executables[header], cwd, file, true));
        });
        const outcomes = await inBatches(jobs, 4);
        report(
          `test() ${header} ${later ? "later" : "first"} plan`,
          terms.map((n, i) => `${n}:${tally(outcomes.slice(i * runs, (i + 1) * runs))}`).join(" "),
        );
      }
    }

    // The same with the number of JIT threads that bun starts by default.
    for (const header of ["onePage", "2MB"]) {
      const some = [100, 375, 1000, 2000, 8000];
      const jobs = some.flatMap(n =>
        Array.from({ length: runs }, () => () => outcome(executables[header], cwd, `test-${n}-first.js`, false)),
      );
      const outcomes = await inBatches(jobs, 4);
      report(
        `test() ${header} default threads`,
        some.map((n, i) => `${n}:${tally(outcomes.slice(i * runs, (i + 1) * runs))}`).join(" "),
      );
    }

    // Each entry point of the fold, with a frame of 128 KB and of 1.6 KB.
    for (const header of ["onePage", "2MB"]) {
      const cells: string[] = [];
      for (const operation of Object.keys(operations) as Operation[]) {
        for (const n of [100, 8000]) {
          const file = `${operation}-${n}.js`;
          writeFileSync(join(cwd, file), probeScript(n, operation, false));
          const outcomes = await inBatches(
            Array.from({ length: runs }, () => () => outcome(executables[header], cwd, file, true)),
            4,
          );
          cells.push(`${operation}/${n}:${tally(outcomes)}`);
        }
      }
      report(`operations ${header}`, cells.join(" "));
    }

    expect("done").toBe("measurements only: see the MEASURE lines");
  },
  600 * 1000,
);
