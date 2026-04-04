import { expect, test } from "bun:test";

test("FormData.values() returns File objects, not just strings", () => {
  const fd = new FormData();
  const file = new File(["content"], "test.txt", { type: "text/plain" });
  fd.append("textField", "hello");
  fd.append("fileField", file);

  const values = [...fd.values()];
  expect(values).toHaveLength(2);
  expect(values[0]).toBe("hello");
  expect(values[1]).toBeInstanceOf(File);
});

test("FormData.entries() returns File objects in value position", () => {
  const fd = new FormData();
  const file = new File(["content"], "test.txt", { type: "text/plain" });
  fd.append("textField", "hello");
  fd.append("fileField", file);

  const entries = [...fd.entries()];
  expect(entries).toHaveLength(2);
  expect(entries[0]).toEqual(["textField", "hello"]);
  expect(entries[1][0]).toBe("fileField");
  expect(entries[1][1]).toBeInstanceOf(File);
});
