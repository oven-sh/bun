import { ucontextLayout } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { isLinux } from "harness";

// Bun reports `process.platform === "android"` (not "linux") on bionic; the
// Zig-side `Environment.isLinux` still sees it as `.linux` + `.android` ABI.
const isAndroid = process.platform === "android";

// `bun.sys.ucontext_t` is the type the crash handler's SA_SIGINFO third
// parameter is declared as. On Linux x86_64 it must match the host libc's
// `ucontext_t` so that reading `uc_mcontext.gregs[REG_RIP]` / `fpregs_mem`
// from a saved signal context lands on the right bytes.
//
// Zig's `std.c.ucontext_t` hardcodes the glibc/musl layout (128-byte
// sigmask). bionic x86_64 puts only a single `c_ulong` there, so
// `__fpregs_mem` is 120 bytes earlier. `bun.sys.ucontext_t` overrides the
// layout on x86_64 Android and aliases `std.posix.ucontext_t` everywhere
// else — this test pins the alias to the glibc/musl offsets on CI and, when
// run on an x86_64 Android device, to the bionic offsets.
test.skipIf(!((isLinux || isAndroid) && process.arch === "x64"))(
  "bun.sys.ucontext_t matches host libc on Linux x86_64",
  () => {
    const layout = ucontextLayout();
    expect(layout).toBeDefined();

    // `uc_mcontext` sits at the same offset on glibc, musl, and bionic: it is
    // preceded only by `{uc_flags, uc_link, uc_stack}` whose sizes are fixed by
    // the kernel ABI.
    const expected = layout!.android
      ? // bionic libc/include/sys/ucontext.h, __x86_64__: uc_sigmask is a bare
        // `union { sigset_t; sigset64_t; }` == one `unsigned long`.
        { sizeof: 816, mcontext: 40, sigmask: 296, fpregs_mem: 304, android: true }
      : // glibc/musl: `sigmask` is `[1024 / @bitSizeOf(c_ulong)]c_ulong`
        // (128 bytes), pushing `fpregs_mem` out to 424.
        { sizeof: 936, mcontext: 40, sigmask: 296, fpregs_mem: 424, android: false };

    expect(layout).toEqual(expected);
  },
);
