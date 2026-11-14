// @ts-nocheck
import { expect, test } from "vitest";

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

// Line endings are normalized to "\n" after printing, so a "\r" just before a newline the printer added is lost.
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

// pretty-format does not notice that these hold themselves, so a snapshot of one alone is a RangeError. The arguments
// of a custom matcher are printed 10 levels deep at most.
const element = (type, props) => ({ $$typeof: Symbol.for("react.transitional.element"), type, props });
const json = members => ({ $$typeof: Symbol.for("react.test.json"), type: "a", props: {}, children: null, ...members });
const tied = (value, tie) => (tie(value), value);
const cycles = {
  "an element in its props": tied(element("a", {}), it => (it.props.it = it)),
  "an element among its children": tied(element("a", {}), it => (it.props.children = [it])),
  "a test renderer's object in its props": tied(json(), it => (it.props.it = it)),
  "a test renderer's object among its children": tied(json(), it => (it.children = [it])),
  "a DOM element in an attribute": tied(new HTMLDivElement([], []), it => (it.attributes = [{ name: "it", value: it }])),
  "a DOM element among its children": tied(new HTMLDivElement([], []), it => (it.childNodes = [it])),
  "a DOM element in an element in an attribute": tied(
    new HTMLDivElement([], []),
    it => (it.attributes = [{ name: "it", value: element("a", { it }) }]),
  ),
  "an Immutable.List among its values": tied(
    { "@@__IMMUTABLE_ITERABLE__@@": true, "@@__IMMUTABLE_LIST__@@": true },
    it => (it.values = () => [it].values()),
  ),
  "an asymmetric matcher in its sample": tied(
    { $$typeof: Symbol.for("jest.asymmetricMatcher"), toString: () => "ObjectContaining" },
    it => (it.sample = { it }),
  ),
};
for (const [name, value] of Object.entries(cycles)) {
  test("a custom matcher of what holds itself: " + name, () => {
    expect.extend({
      toBeFoo() {
        return { pass: true, message: () => "" };
      },
    });
    expect(expect.toBeFoo(value)).toMatchSnapshot();
  });
}
