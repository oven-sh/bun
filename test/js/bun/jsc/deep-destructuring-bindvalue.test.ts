import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A deeply nested array destructuring pattern used to SIGSEGV in a release
// build: ArrayPatternNode::bindValue recursed through its try/finally wrapper
// into the nested pattern with no isSafeToRecurse() check, so bytecode
// generation ran the native stack past the guard page. Under debug/ASAN the
// fatter frames tripped the parser's own limit first, so the crash was a
// release-only silent exit 139.
//
// The source is fed through (0, eval) so JavaScriptCore compiles it directly;
// bun's own transpiler never sees the deep pattern and cannot mask the bug.

async function run(label: string, source: string) {
  const script = `
    try {
      (0, eval)(${JSON.stringify(source)});
      console.log("ran");
    } catch (e) {
      console.log(e?.constructor?.name ?? "threw");
    }
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { label, stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode };
}

const N = 12000;
const open = Buffer.alloc(N, "[").toString();
const close = Buffer.alloc(N, "]").toString();

test.concurrent("let declaration", async () => {
  expect(await run("let", `let ${open}z${close} = [];`)).toMatchObject({
    stdout: "RangeError",
    exitCode: 0,
    signalCode: null,
  });
});

test.concurrent("for-of binding", async () => {
  expect(await run("for-of", `for (let ${open}z${close} of [[]]){}`)).toMatchObject({
    stdout: "RangeError",
    exitCode: 0,
    signalCode: null,
  });
});

test.concurrent("catch parameter", async () => {
  expect(await run("catch", `try{throw []}catch(${open}z${close}){}`)).toMatchObject({
    stdout: "RangeError",
    exitCode: 0,
    signalCode: null,
  });
});

test.concurrent("function parameter", async () => {
  expect(await run("param", `(function(${open}z${close}){})([]);`)).toMatchObject({
    stdout: "RangeError",
    exitCode: 0,
    signalCode: null,
  });
});

// Sanity: a pattern that is deep but well within any build's limit still
// compiles and runs, and the error it throws comes from evaluating the
// destructuring at runtime, not from the new guard.
test.concurrent("shallow pattern still runs", async () => {
  const n = 64;
  const o = Buffer.alloc(n, "[").toString();
  const c = Buffer.alloc(n, "]").toString();
  expect(await run("shallow", `let ${o}z${c} = [];`)).toMatchObject({
    stdout: "TypeError",
    exitCode: 0,
    signalCode: null,
  });
});
