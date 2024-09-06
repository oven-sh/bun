import { expect, test } from "bun:test";
test("new snapshot", () => {
  expect({ b: 2 }).toMatchSnapshot();
});
