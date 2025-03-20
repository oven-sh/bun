import { test } from "bun:test";

export function seperateFileTest() {
  test("test in seperate file", () => {
    console.log("test in seperate file");
  });
}
