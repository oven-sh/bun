// https://github.com/oven-sh/bun/issues/25309
// toBeFalsy/toBeTruthy expanded DOM implementation internals, producing hundreds of MB of error output and very slow failures.
import { expect, test } from "bun:test";
import { Window } from "happy-dom";

function createLargeElement() {
  const document = new Window().document;
  const root = document.createElement("div");

  for (let index = 0; index < 100; index++) {
    const child = document.createElement("div");
    child.textContent = String(index);
    root.appendChild(child);
  }

  return root;
}

function createElementWithMultibyteCharacterAtTruncationBoundary() {
  const document = new Window().document;
  const root = document.createElement("div");
  root.textContent = Buffer.alloc(9_993, "a").toString() + "\u{1F600}" + "tail";
  return root;
}

test("falsy matcher errors do not print complete large DOM trees", () => {
  let message = "";
  try {
    expect(createLargeElement()).toBeFalsy();
  } catch (error) {
    message = (error as Error).message;
  }

  expect(message).toContain("expect(received).toBeFalsy()");
  expect(message).toContain("<div><div>0</div>");
  expect(message).not.toContain("Symbol(nodeArray)");
  expect(message.length).toBeLessThan(500_000);
});

test("truthy matcher errors do not print complete large DOM trees", () => {
  let message = "";
  try {
    expect(createLargeElement()).not.toBeTruthy();
  } catch (error) {
    message = (error as Error).message;
  }

  expect(message).toContain("expect(received).not.toBeTruthy()");
  expect(message).toContain("<div><div>0</div>");
  expect(message).not.toContain("Symbol(nodeArray)");
  expect(message.length).toBeLessThan(500_000);
});

test("boolean matcher errors keep normal object details", () => {
  let message = "";
  try {
    expect({ a: { b: { c: 1 } }, arr: [1, 2, 3] }).toBeFalsy();
  } catch (error) {
    message = (error as Error).message;
  }

  expect(message).toContain("c: 1");
  expect(message).toContain("arr");
});

test("DOM element truncation does not split UTF-8 characters", () => {
  let message = "";
  try {
    expect(createElementWithMultibyteCharacterAtTruncationBoundary()).toBeFalsy();
  } catch (error) {
    message = (error as Error).message;
  }

  expect(message).toContain("expect(received).toBeFalsy()");
  expect(message).toContain("...");
  expect(message).not.toContain("\uFFFD");
  expect(message.length).toBeLessThan(20_000);
});

test("non-boolean DOM formatting keeps content after the boolean matcher limit", () => {
  const document = new Window().document;
  const actual = document.createElement("div");
  const expected = document.createElement("div");
  actual.textContent = Buffer.alloc(10_100, "a").toString() + "after-limit";

  let message = "";
  try {
    expect(actual).toEqual(expected);
  } catch (error) {
    message = (error as Error).message;
  }

  expect(message).toContain("after-limit");
});
