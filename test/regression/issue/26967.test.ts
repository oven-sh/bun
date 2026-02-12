import { expect, test } from "bun:test";

test("Bun.file() returns BunFile with correct constructor.name", () => {
  const file = Bun.file("file.txt");
  expect(file.constructor.name).toBe("BunFile");
});

test("Bun.file() returns BunFile instance that is instanceof Blob", () => {
  const file = Bun.file("file.txt");
  expect(file).toBeInstanceOf(Blob);
});

test("Bun.file() instance has BunFile-specific methods", () => {
  const file = Bun.file("file.txt");
  expect(typeof file.exists).toBe("function");
  expect(typeof file.write).toBe("function");
  expect(typeof file.unlink).toBe("function");
  expect(typeof file.delete).toBe("function");
  expect(typeof file.stat).toBe("function");
  expect(typeof file.writer).toBe("function");
  expect("name" in file).toBe(true);
  expect("lastModified" in file).toBe(true);
});

test("Bun.file() instance has Blob standard methods", () => {
  const file = Bun.file("file.txt");
  expect(typeof file.text).toBe("function");
  expect(typeof file.arrayBuffer).toBe("function");
  expect(typeof file.json).toBe("function");
  expect(typeof file.slice).toBe("function");
  expect(typeof file.stream).toBe("function");
  expect(typeof file.formData).toBe("function");
  expect(typeof file.bytes).toBe("function");
});

test("Blob.prototype does not have BunFile-specific methods", () => {
  expect("exists" in Blob.prototype).toBe(false);
  expect("write" in Blob.prototype).toBe(false);
  expect("unlink" in Blob.prototype).toBe(false);
  expect("delete" in Blob.prototype).toBe(false);
  expect("stat" in Blob.prototype).toBe(false);
  expect("writer" in Blob.prototype).toBe(false);
  expect("name" in Blob.prototype).toBe(false);
  expect("lastModified" in Blob.prototype).toBe(false);
});

test("new Blob() does not have BunFile-specific methods", () => {
  const blob = new Blob(["hello"]);
  expect("exists" in blob).toBe(false);
  expect("write" in blob).toBe(false);
  expect("unlink" in blob).toBe(false);
  expect("delete" in blob).toBe(false);
  expect("stat" in blob).toBe(false);
  expect("writer" in blob).toBe(false);
  expect("name" in blob).toBe(false);
  expect("lastModified" in blob).toBe(false);
});

test("new Blob() has standard Blob methods", () => {
  const blob = new Blob(["hello"]);
  expect(blob.constructor.name).toBe("Blob");
  expect(typeof blob.text).toBe("function");
  expect(typeof blob.arrayBuffer).toBe("function");
  expect(typeof blob.slice).toBe("function");
  expect(typeof blob.stream).toBe("function");
});

test("File has proper prototype chain (not sharing Blob.prototype)", () => {
  expect(File.prototype).not.toBe(Blob.prototype);
  expect(Object.getPrototypeOf(File.prototype)).toBe(Blob.prototype);
});

test("new File() has name and lastModified", () => {
  const file = new File(["x"], "test.txt");
  expect(file.name).toBe("test.txt");
  expect(typeof file.lastModified).toBe("number");
  expect(file.constructor.name).toBe("File");
  expect(file).toBeInstanceOf(File);
  expect(file).toBeInstanceOf(Blob);
});

test("BunFile prototype chain is correct", () => {
  const file = Bun.file("file.txt");
  const proto = Object.getPrototypeOf(file);

  // BunFile prototype -> Blob.prototype -> Object.prototype
  expect(proto).not.toBe(Blob.prototype);
  expect(Object.getPrototypeOf(proto)).toBe(Blob.prototype);

  // Symbol.toStringTag
  expect(Object.prototype.toString.call(file)).toBe("[object BunFile]");
});

test("BunFile constructor throws when called directly", () => {
  const file = Bun.file("file.txt");
  expect(() => new (file.constructor as any)()).toThrow("BunFile is not constructable");
});
