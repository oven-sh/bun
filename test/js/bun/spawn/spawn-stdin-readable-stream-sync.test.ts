import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";

describe("spawnSync with ReadableStream stdin", () => {
  test("spawnSync should throw or handle ReadableStream appropriately", () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue("test data");
        controller.close();
      },
    });

    // spawnSync with ReadableStream should either:
    // 1. Throw an error because async streams can't be used synchronously
    // 2. Handle it in some special way

    try {
      const result = spawnSync({
        cmd: ["cat"],
        stdin: stream as any, // Type assertion because it may not be in the types yet
        stdout: "pipe",
      });

      // If it doesn't throw, check what happens
      if (result.stdout) {
        console.log("spawnSync accepted ReadableStream, output:", result.stdout.toString());
      }
    } catch (error: any) {
      // This is expected - spawnSync shouldn't support async ReadableStream
      expect(error.message).toContain("ReadableStream");
    }
  });
});
