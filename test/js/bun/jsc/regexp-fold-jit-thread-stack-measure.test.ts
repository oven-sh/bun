// TEMPORARY. Not a test: measurements on the Windows test machines for this pull request. It fails on purpose,
// so that its output reaches the failure report of the build. It is removed before the pull request is ready.
//
// For a match of a constant RegExp against a constant string, which the DFG folds on a JIT thread: is the match
// folded, is it left in the code, or does the process die? By the pattern, by the stack commit in the PE header of
// the executable, and by whether the function is the first one that the JIT thread optimizes or comes after
// another one.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, preadExact, tempDir } from "harness";
import { closeSync, copyFileSync, openSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

/** Returns SizeOfStackCommit of a PE32+ file. With `commit`, sets it first. */
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
const terms = (n: number) => `/^${Buffer.alloc(n * 2, "a?").toString()}b$/`;
// The frame of the match is 21,744 bytes.
const emoji = `/^\\p{RGI_Emoji}$/v`;
// The frame of the match is 24 bytes for each "(a)?", and 32 more. Each turn of the group takes a ParenContext
// of about that size from the stack.
const group = (n: number) => `/^(?:${Buffer.alloc(n * 4, "(a)?").toString()}b)+$/`;
const turnsOf = (turns: number) => JSON.stringify(Buffer.alloc(turns * 2, "ab").toString());

// probe() is called by the event loop, so the DFG compiles it by itself. With `later`, warm() is compiled first.
// With `bytecode`, the RegExp gets bytecode first: one match runs where the stack has no room for its JIT code.
type Probe = { later?: boolean; bytecode?: boolean; maxCalls?: number };
const probeScript = (match: string, { later = false, bytecode = false, maxCalls = 200000 }: Probe) => `
  const { numberOfDFGCompiles } = require("bun:jsc");
  let calls = 0;
  let matches = 0;
  function probe() {
    calls++;
    if (${match}) matches++;
    if (numberOfDFGCompiles(probe) === 0 && calls < ${maxCalls}) return setImmediate(probe);
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
  ${
    bytecode
      ? `
  function matchAtTheBottomOfTheStack() {
    try {
      return matchAtTheBottomOfTheStack();
    } catch {
      return ${match};
    }
  }
  if (!(${match})) throw new Error("no match");
  if (!matchAtTheBottomOfTheStack()) throw new Error("no match at the bottom of the stack");`
      : ""
  }
  ${later ? "warm" : "probe"}();
`;

// What the DFG left in the code of probe(): F the match is folded, K it is kept (not folded), X the process died
// (with its exit code), ? anything else.
const matchNode =
  /\b(RegExpTest|RegExpTestInline|RegExpExec|RegExpExecNonGlobalOrSticky|RegExpSearch|RegExpMatchFast|RegExpMatchFastGlobal|StringReplace|StringReplaceRegExp|StringReplaceString)\(/;
async function outcome(exe: string, cwd: string, file: string): Promise<string> {
  await using proc = Bun.spawn({
    cmd: [exe, file],
    env: {
      ...bunEnv,
      BUN_JSC_dumpDFGDisassembly: "1",
      BUN_JSC_minNumberOfWorklistThreads: "1",
      BUN_JSC_maxNumberOfWorklistThreads: "1",
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
  "MEASURE folds of a match on a JIT thread, by pattern and stack commit",
  async () => {
    using dir = tempDir("regexp-fold-measure", {});
    const cwd = String(dir);
    const runs = 5;
    let files = 0;

    /** Runs one script `runs` times on `exe`, `batch` at a time. */
    async function cell(exe: string, match: string, probe: Probe = {}, batch = 4): Promise<string> {
      const file = `probe-${files++}.js`;
      writeFileSync(join(cwd, file), probeScript(match, probe));
      return tally(
        await inBatches(
          Array.from({ length: runs }, () => () => outcome(exe, cwd, file)),
          batch,
        ),
      );
    }
    const both = async (exe: string, match: string, probe: Probe = {}) =>
      `first:${await cell(exe, match, { ...probe, later: false })} later:${await cell(exe, match, { ...probe, later: true })}`;

    // The executable as it is built: the stack commit that its header states.
    const asBuilt = join(cwd, "bun-as-built.exe");
    copyFileSync(bunExe(), asBuilt);
    report("stack commit in the header of bun.exe", stackCommit(asBuilt));
    {
      const cells: string[] = [];
      for (const n of [120000, 140000])
        cells.push(`${n}:${await cell(asBuilt, `${terms(n)}.test("aaab")`, { maxCalls: 6000 }, 2)}`);
      report("test() header as built, first plan", cells.join(" "));
    }

    const onePage = join(cwd, "bun-one-page.exe");
    copyFileSync(bunExe(), onePage);
    report("stack commit in the header of the copy", stackCommit(onePage, 0x1000));

    // The frame sizes around the limits, as in the first measurements. Columns: the number of terms.
    for (const later of [false, true]) {
      const cells: string[] = [];
      for (const n of [250, 300, 375, 450, 540, 640, 800, 1000, 1250, 1500, 2000, 3000, 8000])
        cells.push(`${n}:${await cell(onePage, `${terms(n)}.test("aaab")`, { later })}`);
      report(`test() onePage ${later ? "later" : "first"} plan`, cells.join(" "));
    }

    // A pattern that programs use.
    report("emoji onePage", await both(onePage, `${emoji}.test("\\u{1F600}")`));

    // The ParenContexts of a group that repeats: the second place where the JIT code moves the stack pointer.
    {
      const cells: string[] = [];
      for (const [name, match] of [
        ["test/750x8", `${group(750)}.test(${turnsOf(8)})`],
        ["exec/750x8", `${group(750)}.exec(${turnsOf(8)}) !== null`],
        ["test/600x24", `${group(600)}.test(${turnsOf(24)})`],
        ["test/150x64", `${group(150)}.test(${turnsOf(64)})`],
      ] as const)
        cells.push(`${name} ${await both(onePage, match)}`);
      report("group onePage", cells.join(" | "));
    }

    // A RegExp that has bytecode: a JIT thread whose JIT code fails runs the interpreter.
    {
      const cells: string[] = [];
      for (const n of [1000, 8000])
        cells.push(`${n} ${await both(onePage, `${terms(n)}.test("aaab")`, { bytecode: true })}`);
      report("with bytecode onePage", cells.join(" | "));
    }

    expect("done").toBe("measurements only: see the MEASURE lines");
  },
  900 * 1000,
);
