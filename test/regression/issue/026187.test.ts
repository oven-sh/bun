// https://github.com/oven-sh/bun/issues/26187
// Panic "integer does not fit in destination type" when reading files on Windows x86_64
// The fix adds bounds checking on buffer counts before passing to libuv functions

import { expect, test } from "bun:test";
import { closeSync, openSync, readFileSync, readvSync, writeFileSync, writevSync } from "fs";
import { tempDir } from "harness";

test("readFileSync should not panic", () => {
  using dir = tempDir("issue-26187", {
    "test.txt": "Hello, World!",
  });

  const content = readFileSync(`${dir}/test.txt`, "utf8");
  expect(content).toBe("Hello, World!");
});

test("writeFileSync should not panic", () => {
  using dir = tempDir("issue-26187", {});

  writeFileSync(`${dir}/output.txt`, "Test content");
  const content = readFileSync(`${dir}/output.txt`, "utf8");
  expect(content).toBe("Test content");
});

test("fs.readvSync with multiple buffers should not panic", () => {
  using dir = tempDir("issue-26187", {
    "multi.txt": "AAAAABBBBB",
  });

  const fd = openSync(`${dir}/multi.txt`, "r");
  try {
    const buf1 = Buffer.alloc(5);
    const buf2 = Buffer.alloc(5);
    const bytesRead = readvSync(fd, [buf1, buf2], 0);
    expect(bytesRead).toBe(10);
    expect(buf1.toString()).toBe("AAAAA");
    expect(buf2.toString()).toBe("BBBBB");
  } finally {
    closeSync(fd);
  }
});

test("fs.writevSync with multiple buffers should not panic", () => {
  using dir = tempDir("issue-26187", {});

  const fd = openSync(`${dir}/writev.txt`, "w");
  try {
    const buf1 = Buffer.from("Hello");
    const buf2 = Buffer.from("World");
    const bytesWritten = writevSync(fd, [buf1, buf2]);
    expect(bytesWritten).toBe(10);
  } finally {
    closeSync(fd);
  }

  const content = readFileSync(`${dir}/writev.txt`, "utf8");
  expect(content).toBe("HelloWorld");
});
