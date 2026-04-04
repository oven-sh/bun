import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26899
// File.prototype should be distinct from Blob.prototype

test("File.prototype !== Blob.prototype", () => {
  expect(File.prototype).not.toBe(Blob.prototype);
});

test("File.prototype inherits from Blob.prototype", () => {
  expect(Object.getPrototypeOf(File.prototype)).toBe(Blob.prototype);
});

test("new File(...).constructor.name === 'File'", () => {
  const file = new File(["hello"], "hello.txt");
  expect(file.constructor.name).toBe("File");
});

test("new File(...).constructor === File", () => {
  const file = new File(["hello"], "hello.txt");
  expect(file.constructor).toBe(File);
});

test("new File(...).constructor !== Blob", () => {
  const file = new File(["hello"], "hello.txt");
  expect(file.constructor).not.toBe(Blob);
});

test("Object.prototype.toString.call(file) === '[object File]'", () => {
  const file = new File(["hello"], "hello.txt");
  expect(Object.prototype.toString.call(file)).toBe("[object File]");
});

test("file instanceof File", () => {
  const file = new File(["hello"], "hello.txt");
  expect(file instanceof File).toBe(true);
});

test("file instanceof Blob", () => {
  const file = new File(["hello"], "hello.txt");
  expect(file instanceof Blob).toBe(true);
});

test("blob is not instanceof File", () => {
  const blob = new Blob(["hello"]);
  expect(blob instanceof File).toBe(false);
});

test("File instances have Blob methods", () => {
  const file = new File(["hello"], "hello.txt");
  expect(typeof file.text).toBe("function");
  expect(typeof file.arrayBuffer).toBe("function");
  expect(typeof file.slice).toBe("function");
  expect(typeof file.stream).toBe("function");
});

test("File name and lastModified work", () => {
  const file = new File(["hello"], "hello.txt", { lastModified: 12345 });
  expect(file.name).toBe("hello.txt");
  expect(file.lastModified).toBe(12345);
});

test("File.prototype has correct Symbol.toStringTag", () => {
  const desc = Object.getOwnPropertyDescriptor(File.prototype, Symbol.toStringTag);
  expect(desc).toBeDefined();
  expect(desc!.value).toBe("File");
});
