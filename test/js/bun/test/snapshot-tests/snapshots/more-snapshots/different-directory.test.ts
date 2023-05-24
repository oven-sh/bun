import { it, test, expect, describe } from "bun:test";

test.todo("snapshots in different directory", () => {
  expect("1\b2\n3\r4").toMatchSnapshot();
  expect("\r\n").toMatchSnapshot();
  expect("1\b2\n3\r  r\r\\").toMatchSnapshot();
  expect("1\b2\n3\r4\v5\f6\t7\\").toMatchSnapshot();
  expect("\\\r\\\n\\\t\\\v\\\f\\\b").toMatchSnapshot();
  expect("\r").toMatchSnapshot();
  expect("\n").toMatchSnapshot();
  expect("\\").toMatchSnapshot();
  expect("\v").toMatchSnapshot();
  expect("\f").toMatchSnapshot();
  expect("\t").toMatchSnapshot();
  expect("\b").toMatchSnapshot();
  expect("\b'\b\r\r\n\r\n\n\r\n\n\r\r\r").toMatchSnapshot();
  expect("\n\\\n");

  expect({ a: { b: { c: new Date() } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Date) } } });
});
