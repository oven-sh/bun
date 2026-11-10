import { expect, test } from "bun:test";
import { Console } from "node:console";

function streamThatThrowsOnce(error: Error) {
  const written: string[] = [];
  let asked = 0;
  return {
    written,
    write(text: string) {
      written.push(text);
      return true;
    },
    listenerCount() {
      if (asked++ === 0) throw error;
      return 1;
    },
    once() {},
    removeListener() {},
  };
}

test("a Console writes the line again where memory ran out before write() was called", () => {
  const stream = streamThatThrowsOnce(new RangeError("Out of memory"));
  new Console(stream as unknown as NodeJS.WritableStream).log("hi");
  expect(stream.written).toEqual(["hi\n"]);
});

test("another error ahead of write() is swallowed, and the line with it", () => {
  const stream = streamThatThrowsOnce(new RangeError("Invalid array length"));
  new Console(stream as unknown as NodeJS.WritableStream).log("hi");
  expect(stream.written).toEqual([]);
});
