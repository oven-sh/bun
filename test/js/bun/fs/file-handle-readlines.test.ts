import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { open, rm } from "node:fs/promises";

describe("FileHandle.readLines()", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = tempDirWithFiles("readlines", {
      "test.txt": "line1\nline2\nline3",
      "empty-lines.txt": "1\n\n2\n",
      "no-newline.txt": "line1\nline2",
      "empty.txt": "",
      "with-encoding.txt": "line1\nline2",
    });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("reads lines from a file", async () => {
    const filePath = `${tempDir}/test.txt`;
    const file = await open(filePath, "r");

    try {
      const lines = [];
      for await (const line of file.readLines()) {
        lines.push(line);
      }

      expect(lines).toEqual(["line1", "line2", "line3"]);
    } finally {
      await file.close();
    }
  });

  test("handles empty lines", async () => {
    const filePath = `${tempDir}/empty-lines.txt`;
    const file = await open(filePath, "r");

    try {
      const lines = [];
      for await (const line of file.readLines()) {
        lines.push(line);
      }

      expect(lines).toEqual(["1", "", "2"]);
    } finally {
      await file.close();
    }
  });

  test("handles files with no trailing newline", async () => {
    const filePath = `${tempDir}/no-newline.txt`;
    const file = await open(filePath, "r");

    try {
      const lines = [];
      for await (const line of file.readLines()) {
        lines.push(line);
      }

      expect(lines).toEqual(["line1", "line2"]);
    } finally {
      await file.close();
    }
  });

  test("handles empty file", async () => {
    const filePath = `${tempDir}/empty.txt`;
    const file = await open(filePath, "r");

    try {
      const lines = [];
      for await (const line of file.readLines()) {
        lines.push(line);
      }

      expect(lines).toEqual([]);
    } finally {
      await file.close();
    }
  });

  test("accepts options for createReadStream", async () => {
    const filePath = `${tempDir}/with-encoding.txt`;
    const file = await open(filePath, "r");

    try {
      const lines = [];
      for await (const line of file.readLines({ encoding: "utf8" })) {
        lines.push(line);
      }

      expect(lines).toEqual(["line1", "line2"]);
    } finally {
      await file.close();
    }
  });
});
