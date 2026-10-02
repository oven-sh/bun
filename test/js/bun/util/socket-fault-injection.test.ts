import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const skip = !fault.available();

describe.skipIf(skip)("socketFaultInjection control surface", () => {
  afterEach(() => fault.clear());

  test("available() reflects build flag", () => {
    expect(fault.available()).toBe(true);
  });

  test("set() validates syscall", () => {
    expect(() => fault.set({ syscall: "bogus" as any, action: "errno", errno: "ECONNRESET" })).toThrow(
      /rule\.syscall must be one of/,
    );
  });

  test("set() validates action", () => {
    expect(() => fault.set({ syscall: "recv", action: "bogus" as any })).toThrow(/rule\.action must be one of/);
  });

  // Only recv/send/writev have a byte count to clamp; arming "short" on any other
  // syscall used to succeed silently and never fire. ssl_loop_buffer and
  // vm_create are allocations, so they have no byte count either.
  test("set() rejects 'short' for syscalls that cannot clamp a byte count", () => {
    for (const syscall of ["sendmsg", "recvmsg", "connect", "accept", "ssl_loop_buffer", "vm_create"] as const) {
      expect(() => fault.set({ syscall, action: "short", bytes: 1 })).toThrow(/only supported for syscall/);
    }
    expect(fault.set({ syscall: "recv", action: "short", bytes: 1 })).toBe(true);
    expect(fault.set({ syscall: "send", action: "short", bytes: 1 })).toBe(true);
    expect(fault.set({ syscall: "writev", action: "short", bytes: 1 })).toBe(true);
  });

  // A zero return only means something for the data syscalls (EOF on the read
  // side, backpressure on the write side); connect's wrapper returns errno.
  test("set() rejects 'zero' for syscalls with no zero-return semantics", () => {
    for (const syscall of ["connect", "accept", "ssl_loop_buffer", "vm_create"] as const) {
      expect(() => fault.set({ syscall, action: "zero" })).toThrow(/only supported for syscall/);
    }
    for (const syscall of ["recv", "send", "writev", "sendmsg", "recvmsg"] as const) {
      expect(fault.set({ syscall, action: "zero" })).toBe(true);
    }
  });

  test("set() accepts ssl_loop_buffer with action 'errno'", () => {
    expect(fault.set({ syscall: "ssl_loop_buffer", action: "errno", errno: "ENOMEM" })).toBe(true);
  });

  // ssl_loop_buffer's hook is an allocation, so it checks with fd = -1; a rule
  // pinned to a descriptor would arm and then silently never fire.
  test("set() rejects 'fd' for ssl_loop_buffer, which has no descriptor", () => {
    expect(() => fault.set({ syscall: "ssl_loop_buffer", action: "errno", errno: "ENOMEM", fd: 3 })).toThrow(
      /rule\.fd is not supported for syscall "ssl_loop_buffer"/,
    );
    // -1 is the default "any" sentinel and stays accepted.
    expect(fault.set({ syscall: "ssl_loop_buffer", action: "errno", errno: "ENOMEM", fd: -1 })).toBe(true);
    // Descriptor-pinned rules still work for the real syscalls.
    expect(fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET", fd: 3 })).toBe(true);
  });

  // vm_create's hook is the creation of a JSC::VM, so it checks with fd = -1 too.
  test("set() accepts vm_create and rejects 'fd' for it", () => {
    expect(() => fault.set({ syscall: "vm_create", action: "errno", errno: "ENOMEM", fd: 3 })).toThrow(
      /rule\.fd is not supported for syscall "vm_create"/,
    );
    // "none", because an armed rule ends this process when it next creates a VM.
    expect(fault.set({ syscall: "vm_create", action: "none" })).toBe(true);
  });

  test("set() rejects unknown errno name", () => {
    expect(() => fault.set({ syscall: "recv", action: "errno", errno: "ENOSUCHERR" as any })).toThrow(
      /unknown errno name/,
    );
  });

  test("set() accepts numeric errno", () => {
    expect(fault.set({ syscall: "recv", action: "errno", errno: 104 })).toBe(true);
  });

  test("set() requires errno when action is 'errno'", () => {
    expect(() => fault.set({ syscall: "recv", action: "errno" } as any)).toThrow(/rule\.errno is required/);
  });

  test("set() accepts every documented errno name", () => {
    for (const name of [
      "ECONNRESET",
      "EPIPE",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "EAGAIN",
      "EWOULDBLOCK",
      "EINTR",
      "ENOBUFS",
      "ENOMEM",
      "EBADF",
      "EINVAL",
      "ENETUNREACH",
      "EHOSTUNREACH",
    ] as const) {
      expect(fault.set({ syscall: "recv", action: "errno", errno: name })).toBe(true);
    }
  });

  test("set() requires an object", () => {
    expect(() => (fault.set as any)(null)).toThrow();
    expect(() => (fault.set as any)("recv")).toThrow();
  });

  test("clear() is idempotent", () => {
    fault.clear();
    fault.clear();
  });

  test("rules can target each hooked syscall", () => {
    for (const sc of ["recv", "send", "writev", "sendmsg", "recvmsg", "connect", "accept"] as const) {
      expect(fault.set({ syscall: sc, action: "none" })).toBe(true);
    }
  });

  // These have enum slots but no bsd.c hooks; arming them used to "succeed"
  // and then never fire.
  test("set() rejects syscalls that have no fault hook", () => {
    for (const sc of ["socket", "close", "shutdown"]) {
      expect(() => fault.set({ syscall: sc as any, action: "none" })).toThrow(/rule\.syscall must be one of/);
    }
  });

  // bytes: 0 (the old default) clamps the real syscall to length 0, which
  // reads back as EOF/backpressure — i.e. action "zero", not a short read.
  test("set() requires bytes > 0 when action is 'short'", () => {
    expect(() => fault.set({ syscall: "recv", action: "short" } as any)).toThrow(/rule\.bytes must be > 0/);
    expect(() => fault.set({ syscall: "send", action: "short", bytes: 0 })).toThrow(/rule\.bytes must be > 0/);
  });
});

// JSC::VM::tryCreate returns null only when the VM constructor cannot allocate one of its BigInt constants, so the
// "vm_create" rule is the only way to that null from a test.
test.skipIf(skip)(
  "vm_create: a bytecode build that cannot create its VM is a panic with a message",
  async () => {
    using dir = tempDir("fault-injection-vm-create", {
      "index.js": `console.log("hello");`,
      "build-fixture.ts": `
        import { socketFaultInjection as fault } from "bun:internal-for-testing";

        fault.set({ syscall: "vm_create", action: "errno", errno: "ENOMEM" });
        console.log("ARMED");
        const build = await Bun.build({
          entrypoints: ["./index.js"],
          outdir: "./out",
          target: "bun",
          format: "cjs",
          bytecode: true,
        });
        console.log("BUILT " + build.outputs.map(output => output.kind).join(","));
      `,
    });
    // The flag keeps a debug build from symbolizing the trace.
    const cmd = [bunExe(), "build-fixture.ts", "--debug-crash-handler-use-trace-string"];
    await using proc = Bun.spawn({
      // This crash is deliberate: it must leave no core file for the CI lane that collects them.
      cmd: isWindows ? cmd : ["/bin/sh", "-c", `ulimit -c 0 && exec "$@"`, "--", ...cmd],
      // For the same reason it must not be uploaded as a crash report.
      env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const panicked = /panic.*: Failed to allocate JavaScriptCore Virtual Machine/.test(stderr);
    expect({
      markers: stdout.split(/\r?\n/).filter(line => line === "ARMED" || line.startsWith("BUILT")),
      panicked,
      // Only filled when the assertion is about to fail, so that the diff shows why.
      stderr: panicked ? "" : stderr.slice(-2000),
    }).toEqual({ markers: ["ARMED"], panicked: true, stderr: "" });
    expect(exitCode).not.toBe(0);
  },
  // The child is a debug or ASAN build that writes a crash report: 2 to 9 s, and 34 s once, right after a link.
  60_000,
);

test.skipIf(fault.available())("set() throws helpfully when compiled out", () => {
  expect(() => fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET" })).toThrow(
    /not compiled into this build/,
  );
});

test.skipIf(fault.available())("clear() throws helpfully when compiled out", () => {
  expect(() => fault.clear()).toThrow(/not compiled into this build/);
});
