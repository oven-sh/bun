import assert from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import test from "node:test";
import { isStringOneByteRepresentation } from "node:v8";
import { printed } from "./texts.mjs";

// One byte per character where the text allows it. The writers then get the
// bytes 0xFF and 0xFE of a frame as the characters of a string.
const texts = printed.map(text =>
  /^[\x00-\xff]*$/.test(text) ? Buffer.from(text, "latin1").toString("latin1") : text,
);

// Every test here passes. Node.js decides whether the file itself failed when the
// process exits. It can then have results unread behind text that followed a result
// (runner.js#L582 against #L356, v26.3.0), so a failure there fails the file as well.
test("console.log", () => {
  assert.ok(isStringOneByteRepresentation(texts[9]));
  for (const text of texts) console.log(text);
});
test("process.stdout.write", () => {
  for (const text of texts) process.stdout.write(text + "\n");
});
test("fs.writeSync", () => {
  for (const text of texts) fs.writeSync(1, text + "\n");
});
test("a child process", async () => {
  // One write. Node.js takes text that follows a result in one read for a result, and the
  // size it then reads from the line that starts with U+FFFD is below zero (runner.js#L462).
  const script = "import('./texts.mjs').then(({ printed }) => console.log(printed.join('\\n')))";
  const [code] = await once(spawn(process.execPath, ["-e", script], { stdio: "inherit" }), "exit");
  assert.strictEqual(code, 0);
});
test("an open line", () => {
  process.stdout.write("open: " + texts[0]);
});
test("passes", () => {});
