// https://github.com/oven-sh/bun/issues/44982
//
// On Linux, JSC suspends the JS thread with a signal (SIGPWR) when the collector thread
// needs its stack for the conservative scan. A Go c-shared library loaded into the process
// adds SA_ONSTACK to every installed signal handler, and Bun's crash handler gives the main
// thread an alternate signal stack, so the suspend handler then runs on that stack. Up to
// 1.4.3 the handler backed off whenever its own stack pointer was outside the thread's
// stack, so every suspend attempt failed and the process hung once an idle collection
// finished while the JS thread was parked in epoll without heap access.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl } from "harness";

const libc = isMusl ? (process.arch === "arm64" ? "libc.musl-aarch64.so.1" : "libc.musl-x86_64.so.1") : "libc.so.6";

test.skipIf(!isLinux)(
  "an idle collection finishes while the JS thread is parked, with SA_ONSTACK on the suspend signal",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // What the Go runtime does in runtime.setsigstack: add SA_ONSTACK to the handler it finds.
        import { dlopen, ptr, FFIType } from "bun:ffi";
        const SIGPWR = 30;
        const SA_ONSTACK = 0x08000000;
        const { symbols } = dlopen(${JSON.stringify(libc)}, {
          sigaction: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        });
        // struct sigaction on 64-bit Linux (glibc and musl): handler (8), sa_mask (128), sa_flags (4 at 136), restorer (8).
        const act = new Uint8Array(152);
        if (symbols.sigaction(SIGPWR, null, ptr(act)) !== 0) throw new Error("sigaction read failed");
        const view = new DataView(act.buffer);
        if (view.getBigUint64(0, true) === 0n) throw new Error("no SIGPWR handler installed");
        view.setUint32(136, view.getUint32(136, true) | SA_ONSTACK, true);
        if (symbols.sigaction(SIGPWR, ptr(act), null) !== 0) throw new Error("sigaction write failed");

        // Enough live objects that marking does not finish in the pause that starts the collection, so the
        // collector thread still owns it when this thread parks and has to suspend this thread for its stack.
        const keep = [];
        for (let i = 0; i < 30_000; i++) keep.push({ i, s: "x" + i, tags: ["a" + i, "b" + i] });
        // The GC timer (every 250 ms) requests the idle collection after 1 s of quiet, so by about
        // 1.3 s, and the collector runs it while this thread waits for the timer. BUN_JSC_logGC
        // prints the collection to stderr; the parent checks that one happened between the marks.
        console.error("MARK");
        setTimeout(() => {
          console.error("DONE");
          console.log("done", keep.length);
        }, 2500);
        `,
      ],
      env: {
        ...bunEnv,
        BUN_IDLE_GC_SECONDS: "1",
        BUN_GC_TIMER_INTERVAL: "250",
        BUN_GC_TIMER_DISABLE: undefined,
        BUN_JSC_logGC: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([
      proc.exited,
      new Promise<"hung">(resolve => {
        timer = setTimeout(() => resolve("hung"), 20_000);
      }),
    ]);
    clearTimeout(timer);
    if (exited === "hung") {
      proc.kill();
      throw new Error("the process hung: the collector could not suspend the JS thread");
    }
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
    const idleWindow = stderr.slice(stderr.indexOf("MARK"), stderr.indexOf("DONE"));
    expect(idleWindow).toContain("=> FullCollection");
    expect(stdout).toBe("done 30000\n");
    expect(exited).toBe(0);
  },
);
