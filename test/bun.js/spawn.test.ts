import { readableStreamToText, spawn } from "bun";
import { describe, expect, it } from "bun:test";

describe("spawn", () => {
  const hugeString = "hello".repeat(10000).slice();

  it("stdout can be read", async () => {
    await Bun.write("/tmp/out.txt", hugeString);
    const { stdout } = spawn({
      cmd: ["cat", "/tmp/out.txt"],
      stdout: "pipe",
    });

    const text = await readableStreamToText(stdout);
    expect(text).toBe(hugeString);
  });

  it("stdin can be read and stdout can be written", async () => {
    const { stdout, stdin, exited } = spawn({
      cmd: ["bash", import.meta.dir + "/bash-echo.sh"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: "inherit",
    });

    await stdin.write(hugeString);
    await stdin.end();

    const text = await readableStreamToText(stdout);
    expect(text.trim()).toBe(hugeString);
    await exited;
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
