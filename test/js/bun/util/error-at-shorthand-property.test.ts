import { expect, test } from "bun:test";

function errorOf(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("nothing was thrown");
}

function positionOf(error: Error) {
  const [, line, column] = /:(\d+):(\d+)\)?$/.exec(error.stack!.split("\n")[1])!;
  return { line: Number(line), column: Number(column) };
}

test("the message of an early read names a shorthand property", () => {
  const error = errorOf(() => {
    // @ts-expect-error
    let late = { late };
  });
  expect(error.message).toBe("Cannot access 'late' before initialization.");
});

test("an error at a shorthand property is reported at its name", () => {
  // prettier-ignore
  const written = errorOf(() => {
    // @ts-expect-error
    return { x: missingName };
  });
  // prettier-ignore
  const shorthand = errorOf(() => {
    // @ts-expect-error
    return { missingName };
  });
  expect(positionOf(shorthand)).toEqual({
    line: positionOf(written).line + 5,
    column: positionOf(written).column - "x: ".length,
  });
});
