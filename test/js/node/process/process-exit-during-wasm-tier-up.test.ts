// On Windows, ExitProcess terminates every other thread and waits for them to
// finish. JSC's Wasm compiler threads run Thread::barrierInstructionCache() on
// every thread that executes Wasm when they install compiled code. On arm64 that
// is SuspendThread() + ResumeThread() of the target (x64 needs no barrier). A
// compiler thread killed by ExitProcess between those two calls left the exiting
// thread suspended inside NtTerminateProcess forever: the process printed its
// output and never exited.
//
// The fixture queues thousands of background Wasm compiles and exits while they
// are still running, through process.exit() or process.abort(). Both now go
// through Bun__exitProcess, the one ExitProcess behind WTF's thread-suspend lock.
// Without it about half of these processes never exit on Windows arm64. The test
// cannot fail elsewhere; it runs on every Windows lane so both paths are still
// exercised there.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const functionCount = 1000;
const passes = 20;
// Function i returns its argument plus i; the fixture sums every call.
const expectedSum =
  passes * ((functionCount * (functionCount - 1)) / 2) + functionCount * ((passes * (passes - 1)) / 2);

// A file, not `-e`: one-shot invocations compile Wasm synchronously, and the
// race needs the compiles to finish on the compiler threads.
const fixture = (exit: string) => `
  // A module with many tiny functions: (func (param i32) (result i32) local.get 0 i32.const k i32.add).
  function uleb(v, out) {
    do {
      let b = v & 0x7f;
      v >>>= 7;
      if (v) b |= 0x80;
      out.push(b);
    } while (v);
  }
  function sleb(v, out) {
    for (;;) {
      const b = v & 0x7f;
      v >>= 7;
      if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) {
        out.push(b);
        return;
      }
      out.push(b | 0x80);
    }
  }
  function section(id, content, out) {
    out.push(id);
    uleb(content.length, out);
    for (const b of content) out.push(b);
  }
  const n = ${functionCount};
  const out = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  section(1, [0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f], out);
  const funcs = [];
  uleb(n, funcs);
  for (let i = 0; i < n; i++) funcs.push(0x00);
  section(3, funcs, out);
  const exports = [];
  uleb(n, exports);
  for (let i = 0; i < n; i++) {
    const name = Array.from(new TextEncoder().encode("f" + i));
    uleb(name.length, exports);
    exports.push(...name, 0x00);
    uleb(i, exports);
  }
  section(7, exports, out);
  const code = [];
  uleb(n, code);
  for (let i = 0; i < n; i++) {
    const body = [0x00, 0x20, 0x00, 0x41];
    sleb(i, body);
    body.push(0x6a, 0x0b);
    uleb(body.length, code);
    code.push(...body);
  }
  section(10, code, out);

  const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(out)));
  const fns = Object.values(instance.exports);
  // Call every function past the BBQ tier-up threshold. Each compile finishes on
  // a compiler thread, which then suspends and resumes this thread. Exit while
  // the queue is still full.
  let acc = 0;
  for (let pass = 0; pass < ${passes}; pass++) {
    for (let i = 0; i < fns.length; i++) acc += fns[i](pass);
  }
  console.log(acc);
  ${exit};
`;

async function exitsWhileCompiling(exit: string, exitCode: number) {
  using dir = tempDir("exit-during-wasm-tier-up", { "fixture.mjs": fixture(exit) });
  const procs = Array.from({ length: 8 }, () =>
    Bun.spawn({
      cmd: [bunExe(), "fixture.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    }),
  );

  // The failure this test detects is a process that never exits, so the wait
  // for `exited` needs a bound. A process stuck in termination cannot be killed
  // and its pipes never close: on timeout, report it and leave it alone.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">(resolve => {
    timer = setTimeout(() => resolve("timeout"), 20_000);
  });
  try {
    const results = await Promise.all(
      procs.map(async proc => {
        // Drain both pipes while the child runs so a large stderr cannot block it.
        const stdout = proc.stdout.text();
        const stderr = proc.stderr.text();
        const exited = await Promise.race([proc.exited, timeout]);
        if (exited === "timeout") {
          try {
            proc.kill();
          } catch {}
          return "did not exit";
        }
        return { exitCode: exited, stdout: await stdout, stderr: await stderr };
      }),
    );
    expect(results).toEqual(procs.map(() => ({ exitCode, stdout: `${expectedSum}\n`, stderr: "" })));
  } finally {
    clearTimeout(timer);
  }
}

test.skipIf(!isWindows)("process.exit() while Wasm compiler threads are installing code", async () => {
  await exitsWhileCompiling("process.exit(0)", 0);
});

test.skipIf(!isWindows)("process.abort() while Wasm compiler threads are installing code", async () => {
  await exitsWhileCompiling("process.abort()", 134);
});
