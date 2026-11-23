import { expect, test } from "bun:test";
import { Console } from "node:console";
import { Writable } from "node:stream";

test("the table of a Console made by the program takes cells that are objects", () => {
  let text = "";
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      text += chunk;
      done();
    },
  });
  new Console({ stdout, stderr: stdout }).table([
    { deep: { x: 1, y: 2, z: 3 }, shallow: { p: 1 }, bytes: Buffer.from("ab") },
  ]);
  expect(text).toContain("[Object]");
  expect(text).toContain("{ p: 1 }");
  expect(text).toContain("<Buffer 61 62>");
});
