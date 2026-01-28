import { getExpectValue } from "./shared";

test("test2", () => {
  const expect = getExpectValue();
  expect.toMatchSnapshot();
});
