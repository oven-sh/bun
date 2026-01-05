import { afterAll, beforeAll, describe, test } from "bun:test";

let unpredictableVar: string;

beforeAll(() => {
  console.group("<top-level>");
  unpredictableVar = "top level";
});

afterAll(() => {
  console.groupEnd();
  console.info("</top-level>");
});

test("top level test", () => {
  console.info("<top-level-test>", "{ unpredictableVar:", JSON.stringify(unpredictableVar), "}", "</top-level-test>");
});

describe("describe 1", () => {
  beforeAll(() => {
    console.group("<describe-1>");
    unpredictableVar = "describe 1";
  });

  afterAll(() => {
    console.groupEnd();
    console.info("</describe-1>");
  });

  test("describe 1 - test", () => {
    console.info(
      "<describe-1-test>",
      "{ unpredictableVar:",
      JSON.stringify(unpredictableVar),
      "}",
      "</describe-1-test>",
    );
  });
});

describe("describe 2 ", () => {
  beforeAll(() => {
    console.group("<describe-2>");
    unpredictableVar = "describe 2";
  });

  afterAll(() => {
    console.groupEnd();
    console.info("</describe-2>");
  });

  test("describe 2 - test", () => {
    console.info(
      "<describe-2-test>",
      "{ unpredictableVar:",
      JSON.stringify(unpredictableVar),
      "}",
      "</describe-2-test>",
    );
  });
});
