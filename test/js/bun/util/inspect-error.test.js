import { test, expect } from "bun:test";

test("error.cause", () => {
  const err = new Error("error 1");
  const err2 = new Error("error 2", { cause: err });
  expect(
    Bun.inspect(err2)
      .replaceAll(import.meta.dir, "[dir]")
      .replaceAll("\\", "/"),
  ).toMatchSnapshot();
});

test("Error", () => {
  const err = new Error("my message");
  expect(
    Bun.inspect(err)
      .replaceAll(import.meta.dir, "[dir]")
      .replaceAll("\\", "/"),
  ).toMatchSnapshot();
});

test("BuildMessage", async () => {
  try {
    await import("./inspect-error-fixture-bad.js");
    expect.unreachable();
  } catch (e) {
    expect(
      Bun.inspect(e)
        .replaceAll(import.meta.dir, "[dir]")
        .replaceAll("\\", "/"),
    ).toMatchSnapshot();
  }
});
