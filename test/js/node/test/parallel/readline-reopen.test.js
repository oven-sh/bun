//#FILE: test-readline-reopen.js
//#SHA1: 39894fe94eb8e03222c86db2daa35a7b449447eb
//-----------------
"use strict";

// Regression test for https://github.com/nodejs/node/issues/13557
// Tests that multiple subsequent readline instances can re-use an input stream.

const readline = require("readline");
const { PassThrough } = require("stream");

test("multiple readline instances can re-use an input stream", async () => {
  const input = new PassThrough();
  const output = new PassThrough();

  const rl1 = readline.createInterface({
    input,
    output,
    terminal: true,
  });

  const rl1LinePromise = new Promise(resolve => {
    rl1.once("line", line => {
      expect(line).toBe("foo");
      resolve();
    });
  });

  // Write a line plus the first byte of a UTF-8 multibyte character to make sure
  // that it doesn't get lost when closing the readline instance.
  input.write(
    Buffer.concat([
      Buffer.from("foo\n"),
      Buffer.from([0xe2]), // Exactly one third of a ☃ snowman.
    ]),
  );

  await rl1LinePromise;
  rl1.close();

  const rl2 = readline.createInterface({
    input,
    output,
    terminal: true,
  });

  const rl2LinePromise = new Promise(resolve => {
    rl2.once("line", line => {
      expect(line).toBe("☃bar");
      resolve();
    });
  });

  input.write(Buffer.from([0x98, 0x83])); // The rest of the ☃ snowman.
  input.write("bar\n");

  await rl2LinePromise;
  rl2.close();
});

//<#END_FILE: test-readline-reopen.js
