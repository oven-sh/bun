// cursorTo, moveCursor, clearLine and clearScreenDown of tty.WriteStream.prototype hand `this` and their operands to the function of that name that node:readline holds at the moment of the call, as node does.
import { describe, expect, test } from "bun:test";
import readline from "node:readline";
import tty from "node:tty";

const methods = [
  ["cursorTo", [4, 7], "\x1b[8;5H"],
  ["moveCursor", [-2, 3], "\x1b[2D\x1b[3B"],
  ["clearLine", [-1], "\x1b[1K"],
  ["clearScreenDown", [], "\x1b[0J"],
] as const;

function recorder() {
  const written: string[] = [];
  return {
    written,
    write(text: string, callback?: () => void) {
      written.push(text);
      callback?.();
      return true;
    },
  };
}

describe.each(methods)("tty.WriteStream.prototype.%s", (name, operands, sequence) => {
  const method = tty.WriteStream.prototype[name] as (...given: unknown[]) => unknown;

  test("writes its sequence to the stream it is called on", () => {
    const stream = recorder();
    expect(method.call(stream, ...operands)).toBe(true);
    expect(stream.written).toEqual([sequence]);
  });

  test("hands its callback on", () => {
    const stream = recorder();
    let calls = 0;
    expect(method.call(stream, ...operands, () => calls++)).toBe(true);
    expect(stream.written).toEqual([sequence]);
    expect(calls).toBe(1);
  });

  test("calls what the program has laid over the function of node:readline", () => {
    const stream = recorder();
    const kept = readline[name];
    let taken: unknown[] = [];
    (readline as Record<string, unknown>)[name] = (...given: unknown[]) => ((taken = given), "replaced");
    try {
      expect(method.call(stream, ...operands)).toBe("replaced");
    } finally {
      (readline as Record<string, unknown>)[name] = kept;
    }
    expect(taken[0]).toBe(stream);
    expect(taken.slice(1)).toEqual([...operands, undefined]);
    expect(stream.written).toEqual([]);
    expect(method.call(stream, ...operands)).toBe(true);
    expect(stream.written).toEqual([sequence]);
  });
});

test("cursorTo refuses a column that is no number with the error of node:readline", () => {
  expect(() => tty.WriteStream.prototype.cursorTo.call(recorder() as unknown as tty.WriteStream, NaN)).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
  );
});
