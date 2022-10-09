import { test, expect, it, describe } from "bun:test";
import { readableStreamToText, spawn } from "bun";

describe("spawn", () => {
  const hugeString = "hello".repeat(100000).slice();

  it("stdin can write", async () => {
    const { stdin, stdout } = spawn({
      cmd: ["cat"],
      stdin: "pipe",
      stdout: "pipe",
    });
    await stdin.write(hugeString);
    stdin.end();
    return readableStreamToText(stdout).then((text) => {
      expect(text).toBe(hugeString);
    });
  });

  describe("pipe", () => {
    function huge() {
      return spawn({
        cmd: ["echo", hugeString],
        stdout: "pipe",
        stdin: "pipe",
        stderr: "inherit",
      });
    }

    function helloWorld() {
      return spawn({
        cmd: ["echo", "hello"],
        stdout: "pipe",
        stdin: "pipe",
      });
    }

    const fixtures = [
      [helloWorld, "hello"],
      [huge, hugeString],
    ];

    for (const [callback, fixture] of fixtures) {
      describe(fixture.slice(0, 12), () => {
        describe("should should allow reading stdout", () => {
          it("before exit", async () => {
            const process = callback();
            const output = await readableStreamToText(process.stdout);
            const expected = fixture + "\n";
            expect(output.length).toBe(expected.length);
            expect(output).toBe(expected);

            await process.exited;
          });

          it("before exit (chunked)", async () => {
            const process = callback();
            var output = "";
            var reader = process.stdout.getReader();
            var done = false;
            while (!done) {
              var { value, done } = await reader.read();
              if (value) output += new TextDecoder().decode(value);
            }

            const expected = fixture + "\n";
            expect(output.length).toBe(expected.length);
            expect(output).toBe(expected);

            await process.exited;
          });

          it("after exit", async () => {
            const process = callback();
            await process.stdin.end();

            const output = await readableStreamToText(process.stdout);
            const expected = fixture + "\n";

            expect(output.length).toBe(expected.length);
            expect(output).toBe(expected);

            await process.exited;
          });
        });
      });
    }
  });
});
