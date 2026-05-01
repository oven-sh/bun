import { getExpectValue } from "./shared";

test("test1", () => {
  const expect = getExpectValue();
  expect.toMatchSnapshot();
});
