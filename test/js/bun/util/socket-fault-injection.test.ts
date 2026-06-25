import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { afterEach, describe, expect, test } from "bun:test";

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

  // Only recv/send have a byte count to clamp; arming "short" on any other
  // syscall used to succeed silently and never fire.
  test("set() rejects 'short' for syscalls that cannot clamp a byte count", () => {
    for (const syscall of [
      "writev",
      "sendmsg",
      "recvmsg",
      "connect",
      "accept",
      "socket",
      "close",
      "shutdown",
    ] as const) {
      expect(() => fault.set({ syscall, action: "short", bytes: 1 })).toThrow(/only supported for syscall/);
    }
    expect(fault.set({ syscall: "recv", action: "short", bytes: 1 })).toBe(true);
    expect(fault.set({ syscall: "send", action: "short", bytes: 1 })).toBe(true);
  });

  // A zero return only means something for the data syscalls (EOF on the read
  // side, backpressure on the write side); connect's wrapper returns errno.
  test("set() rejects 'zero' for syscalls with no zero-return semantics", () => {
    for (const syscall of ["connect", "accept", "socket", "close", "shutdown"] as const) {
      expect(() => fault.set({ syscall, action: "zero" })).toThrow(/only supported for syscall/);
    }
    for (const syscall of ["recv", "send", "writev", "sendmsg", "recvmsg"] as const) {
      expect(fault.set({ syscall, action: "zero" })).toBe(true);
    }
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

  test("rules can target each syscall", () => {
    for (const sc of [
      "recv",
      "send",
      "writev",
      "sendmsg",
      "recvmsg",
      "connect",
      "accept",
      "socket",
      "close",
      "shutdown",
    ] as const) {
      expect(fault.set({ syscall: sc, action: "none" })).toBe(true);
    }
  });
});

test.skipIf(fault.available())("set() throws helpfully when compiled out", () => {
  expect(() => fault.set({ syscall: "recv", action: "errno", errno: "ECONNRESET" })).toThrow(
    /not compiled into this build/,
  );
});

test.skipIf(fault.available())("clear() throws helpfully when compiled out", () => {
  expect(() => fault.clear()).toThrow(/not compiled into this build/);
});
