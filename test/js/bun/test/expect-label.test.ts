import { test, expect } from "bun:test";
import stripAnsiColors from "strip-ansi";

test("expect-label", () => {
  let err;
  try {
    expect("a", "lol!").toBe("b");
    expect.unreachable();
  } catch (e) {
    err = e;
  }

  expect(stripAnsiColors(err.message)).toContain("lol!\n\nExpected");
  expect(stripAnsiColors(err.message)).not.toContain("to be");
  expect(stripAnsiColors(err.message)).not.toContain("toBe");
});

test("expect-label toEqual", () => {
  let err;
  try {
    expect("a", "lol!").toEqual("b");
    expect.unreachable();
  } catch (e) {
    err = e;
  }

  expect(stripAnsiColors(err.message)).toContain("lol!\n\nExpected");
});

test("non-strings do not crash", () => {
  try {
    expect("a", undefined).toEqual("b");
  } catch {}
  try {
    // @ts-ignore
    expect("a", Symbol("a")).toEqual("b");
  } catch {}
  try {
    // @ts-ignore
    expect("a", null).toEqual("b");
  } catch {}
});
