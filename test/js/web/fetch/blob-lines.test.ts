import { expect, test } from "bun:test";
import { tempDir } from "harness";

test("Blob.prototype.lines() - basic functionality", async () => {
  const blob = new Blob(["line1\nline2\nline3"]);
  const lines = blob.lines();

  expect(lines).toBeInstanceOf(ReadableStream);

  const reader = lines.getReader();
  const results: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value);
  }

  expect(results).toEqual(["line1", "line2", "line3"]);
});

test("Blob.prototype.lines() - empty blob", async () => {
  const blob = new Blob([""]);
  const lines = blob.lines();
  const reader = lines.getReader();
  const { done } = await reader.read();
  expect(done).toBe(true);
});

test("Blob.prototype.lines() - single line no newline", async () => {
  const blob = new Blob(["single line"]);
  const lines = blob.lines();
  const reader = lines.getReader();

  const { value: line1, done: done1 } = await reader.read();
  expect(line1).toBe("single line");
  expect(done1).toBe(false);

  const { done: done2 } = await reader.read();
  expect(done2).toBe(true);
});

test("Blob.prototype.lines() - CRLF line endings", async () => {
  const blob = new Blob(["line1\r\nline2\r\nline3"]);
  const lines = blob.lines();
  const reader = lines.getReader();
  const results: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value);
  }

  // On Windows, \r should be stripped, on other platforms it should be kept
  if (process.platform === "win32") {
    expect(results).toEqual(["line1", "line2", "line3"]);
  } else {
    expect(results).toEqual(["line1\r", "line2\r", "line3"]);
  }
});

test("Blob.prototype.lines() - mixed line endings", async () => {
  const blob = new Blob(["line1\nline2\r\nline3\n"]);
  const lines = blob.lines();
  const reader = lines.getReader();
  const results: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value);
  }

  if (process.platform === "win32") {
    expect(results).toEqual(["line1", "line2", "line3"]);
  } else {
    expect(results).toEqual(["line1", "line2\r", "line3"]);
  }
});

test("Blob.prototype.lines() - trailing newline", async () => {
  const blob = new Blob(["line1\nline2\n"]);
  const lines = blob.lines();
  const reader = lines.getReader();
  const results: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value);
  }

  expect(results).toEqual(["line1", "line2"]);
});

test("Blob.prototype.lines() - multiple newlines", async () => {
  const blob = new Blob(["line1\n\n\nline2"]);
  const lines = blob.lines();
  const reader = lines.getReader();
  const results: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value);
  }

  expect(results).toEqual(["line1", "", "", "line2"]);
});

test("Blob.prototype.lines() - large blob", async () => {
  const lines_array = Array.from({ length: 1000 }, (_, i) => `line ${i}`);
  const blob = new Blob([lines_array.join("\n")]);
  const lines = blob.lines();
  const reader = lines.getReader();
  const results: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value);
  }

  expect(results).toEqual(lines_array);
});

test("Blob.prototype.lines() - UTF-8 content", async () => {
  const blob = new Blob(["Hello 世界\n你好 world\nこんにちは"]);
  const lines = blob.lines();
  const reader = lines.getReader();
  const results: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value);
  }

  expect(results).toEqual(["Hello 世界", "你好 world", "こんにちは"]);
});

test("Blob.prototype.lines() - chunked data", async () => {
  const blob = new Blob(["chunk1\n", "chunk2\nchunk3"]);
  const lines = blob.lines();
  const reader = lines.getReader();
  const results: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value);
  }

  expect(results).toEqual(["chunk1", "chunk2", "chunk3"]);
});

test("Blob.prototype.lines() - for await iteration", async () => {
  const blob = new Blob(["line1\nline2\nline3"]);
  const lines = blob.lines();
  const results: string[] = [];

  for await (const line of lines) {
    results.push(line);
  }

  expect(results).toEqual(["line1", "line2", "line3"]);
});

test("Blob.prototype.lines() - file blob", async () => {
  using dir = tempDir("blob-lines-test", {
    "test.txt": "file line 1\nfile line 2\nfile line 3",
  });

  const file = Bun.file(String(dir) + "/test.txt");
  const lines = file.lines();
  const reader = lines.getReader();
  const results: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value);
  }

  expect(results).toEqual(["file line 1", "file line 2", "file line 3"]);
});
