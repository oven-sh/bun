import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunExe } from "harness";

describe("spawnSync with ReadableStream stdin", () => {
  test("spawnSync should throw", () => {
    const stream = new ReadableStream({
      async start(controller) {
        await 42;
        controller.enqueue("test data");
        controller.close();
      },
    });

    expect(() =>
      spawnSync({
        cmd: [bunExe()],
        stdin: stream,
        stdout: "pipe",
      }),
    ).toThrowErrorMatchingInlineSnapshot(`"'stdin' ReadableStream cannot be used in sync mode"`);
  });
});
