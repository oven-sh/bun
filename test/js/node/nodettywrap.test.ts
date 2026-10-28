import { expect, test } from "bun:test";
import { isatty } from "node:tty";

test("process.binding('tty_wrap')", () => {
  const tty_wrap: any = process.binding("tty_wrap");

  expect(tty_wrap).toBeDefined();
  expect(tty_wrap).toHaveProperty("TTY");
  expect(tty_wrap).toHaveProperty("isTTY");

  const tty = tty_wrap.TTY;

  expect(tty).toHaveProperty("prototype");

  const tty_prototype = tty.prototype;

  expect(tty_prototype).toHaveProperty("getWindowSize");
  expect(tty_prototype).toHaveProperty("setRawMode");

  const tty_isTTY = tty_wrap.isTTY;

  expect(tty_isTTY(0)).toBe(isatty(0));
  expect(tty_isTTY(1)).toBe(isatty(1));
  expect(tty_isTTY(2)).toBe(isatty(2));

  expect(tty_isTTY(9999999)).toBe(false);

  expect(() => tty()).toThrow(TypeError);

  if (isatty(0)) {
    expect(() => new tty(0)).not.toThrow();

    const array = [-1, -1];

    expect(() => tty_prototype.getWindowSize.call(array, 0)).toThrow(TypeError);
    const ttywrapper = new tty(0);

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
    expect(() => new tty(0)).toThrow();
    console.warn("warn: Skipping tty tests because stdin is not a tty");
  }
});

// https://github.com/nodejs/node/blob/v26.12.1/src/tty_wrap.cc#L75-L77
test("process.binding('tty_wrap') has libuv's tty modes", () => {
  const tty_wrap: any = process.binding("tty_wrap");
  const constant = (value: number) => ({ value, writable: false, enumerable: true, configurable: false });

  expect(Object.getOwnPropertyNames(tty_wrap)).toEqual([
    "isTTY",
    "UV_TTY_MODE_NORMAL",
    "UV_TTY_MODE_IO",
    "UV_TTY_MODE_RAW_VT",
    "TTY",
  ]);
  expect({
    UV_TTY_MODE_NORMAL: Object.getOwnPropertyDescriptor(tty_wrap, "UV_TTY_MODE_NORMAL"),
    UV_TTY_MODE_IO: Object.getOwnPropertyDescriptor(tty_wrap, "UV_TTY_MODE_IO"),
    UV_TTY_MODE_RAW_VT: Object.getOwnPropertyDescriptor(tty_wrap, "UV_TTY_MODE_RAW_VT"),
  }).toEqual({
    UV_TTY_MODE_NORMAL: constant(0),
    UV_TTY_MODE_IO: constant(2),
    UV_TTY_MODE_RAW_VT: constant(3),
  });
});
