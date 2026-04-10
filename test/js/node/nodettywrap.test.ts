import { expect, test } from "bun:test";
import { isatty } from "node:tty";

test("process.binding('tty_wrap')", () => {
  // @ts-expect-error
  const tty_wrap = process.binding("tty_wrap");

  expect(tty_wrap).toBeDefined();
  expect(tty_wrap).toHaveProperty("TTY");
  expect(tty_wrap).toHaveProperty("isTTY");

  const tty = tty_wrap.TTY;

  expect(tty).toHaveProperty("prototype");

  const tty_prototype = tty.prototype;

  expect(tty_prototype).toHaveProperty("getWindowSize");
  expect(tty_prototype).toHaveProperty("setRawMode");
  // Stream-handle surface (Node's LibuvStreamWrap interface). Exercising these
  // proves the Zig handle compiles and is wired on every platform — the PTY
  // tests can't run on Windows.
  for (const m of ["readStart", "readStop", "ref", "unref", "close"]) {
    expect(typeof tty_prototype[m]).toBe("function");
  }

  const tty_isTTY = tty_wrap.isTTY;

  expect(tty_isTTY(0)).toBe(isatty(0));
  expect(tty_isTTY(1)).toBe(isatty(1));
  expect(tty_isTTY(2)).toBe(isatty(2));

  expect(tty_isTTY(9999999)).toBe(false);

  expect(() => tty()).toThrow(TypeError);

  // Find a tty fd to construct a real handle; CI on each platform runs at
  // least one job with a tty attached to one of these.
  const ttyFd = [0, 1, 2].find(fd => isatty(fd));

  if (ttyFd !== undefined) {
    expect(() => new tty(ttyFd)).not.toThrow();

    const handle = new tty(ttyFd);
    // Exercise the readStart/readStop native paths — return 0 on success.
    expect(handle.readStart()).toBe(0);
    expect(handle.readStop()).toBe(0);
    handle.unref();
    handle.ref();
    expect(() => handle.close()).not.toThrow();

    const array = [-1, -1];

    expect(() => tty_prototype.getWindowSize.call(array, 0)).toThrow(TypeError);
    const ttywrapper = new tty(ttyFd);

    expect(ttywrapper.getWindowSize(array)).toBeBoolean();

    if (ttywrapper.getWindowSize(array)) {
      expect(array[0]).toBeNumber();
      expect(array[0]).toBeGreaterThanOrEqual(0);
      expect(array[1]).toBeNumber();
      expect(array[1]).toBeGreaterThanOrEqual(0);
    } else {
      expect(array[0]).toBe(-1);
      expect(array[1]).toBe(-1);
    }
  } else {
    // Node's TTY binding accepts non-tty fds (uv_tty_init reports via ctx
    // out-param, not throw). The handle just won't deliver tty-specific data.
    expect(() => new tty(0)).not.toThrow();
    console.warn("warn: Skipping tty handle tests because no fd in [0,1,2] is a tty");
  }
});
