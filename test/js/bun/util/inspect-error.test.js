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

function ansiRegex({ onlyFirst = false } = {}) {
  const pattern = [
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))",
  ].join("|");

  return new RegExp(pattern, onlyFirst ? undefined : "g");
}
const stripANSIColors = str => str.replace(ansiRegex(), "");

test("Error inside minified file (no color) ", () => {
  try {
    require("./inspect-error-fixture.min.js");
    expect.unreachable();
  } catch (e) {
    expect(
      Bun.inspect(e)
        .replaceAll(import.meta.dir, "[dir]")
        .replaceAll("\\", "/")
        .trim(),
    ).toMatchSnapshot();
  }
});

test("Error inside minified file (color) ", () => {
  try {
    require("./inspect-error-fixture.min.js");
    expect.unreachable();
  } catch (e) {
    expect(
      // TODO: remove this workaround once snapshots work better
      stripANSIColors(
        Bun.inspect(e, { colors: true })
          .replaceAll(import.meta.dir, "[dir]")
          .replaceAll("\\", "/")
          .trim(),
      ).trim(),
    ).toMatchSnapshot();
  }
});
