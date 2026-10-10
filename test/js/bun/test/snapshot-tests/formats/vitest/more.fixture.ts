// @ts-nocheck
import { expect, test } from "vitest";

// Small things that the other fixtures do not have.
class Text {
  nodeType = 3;
  constructor(data) {
    this.data = data;
  }
}
class Comment {
  nodeType = 8;
  constructor(data) {
    this.data = data;
  }
}
class HTMLDivElement {
  nodeType = 1;
  tagName = "DIV";
  constructor(attributes, childNodes) {
    this.attributes = attributes;
    this.childNodes = childNodes;
  }
}

// The line breaks of all that is printed are made "\n" at the end, so a "\r" before one that the printer adds is lost.
test.each(["a\r", "a\r\n", "a\n\r", "\ra", "a\rb", "a\r\rb", "\r", "\r\n\r\n"])("carriage returns: %j", text => {
  expect(new Text(text)).toMatchSnapshot("text");
  expect(new Comment(text)).toMatchSnapshot("comment");
  expect(new HTMLDivElement([{ name: "a", value: text }], [new Text(text), new Comment(text), text])).toMatchSnapshot(
    "element",
  );
  expect({ node: new Text(text), after: 1 }).toMatchSnapshot("text in an object");
  expect([text, { [text]: text }]).toMatchSnapshot("strings");
});

test("any() of a class without a name", () => {
  const Anonymous = (() => class {})();
  expect({ a: new Anonymous(), f() {} }).toMatchSnapshot({ a: expect.any(Anonymous), f: expect.any(Function) });
});

test("closeTo()", () => {
  expect([
    expect.closeTo(-0),
    expect.closeTo(1.5, 1),
    expect.closeTo(Infinity, 0),
    expect.not.closeTo(1e21, 3),
  ]).toMatchSnapshot();
});

test("", () => {
  expect(1).toMatchSnapshot();
  expect(2).toMatchSnapshot("a hint for a test without a name");
});
