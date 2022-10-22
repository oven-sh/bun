import { readableStreamToText, spawn, spawnSync, write } from "bun";
import { describe, expect, it } from "bun:test";
import { gcTick as _gcTick } from "gc";
import { rmdirSync, unlinkSync, rmSync, writeFileSync } from "node:fs";

for (let [gcTick, label] of [
  [_gcTick, "gcTick"],
  [() => {}, "no gc tick"],
]) {
  describe(label, () => {
    describe("spawnSync", () => {
      const hugeString = "hello".repeat(10000).slice();

      it("as an array", () => {
        const { stdout } = spawnSync(["echo", "hi"]);

        // stdout is a Buffer
        const text = stdout.toString();
        expect(text).toBe("hi\n");
      });

      it("Uint8Array works as stdin", async () => {
        const { stdout, stderr } = spawnSync({
          cmd: ["cat"],
          stdin: new TextEncoder().encode(hugeString),
        });

        expect(stdout.toString()).toBe(hugeString);
        expect(stderr.byteLength).toBe(0);
      });

      it("check exit code", async () => {
        const { exitCode: exitCode1 } = spawnSync({
          cmd: ["ls"]
        });
        const { exitCode: exitCode2 } = spawnSync({
          cmd: ["false"]
        });
        expect(exitCode1).toBe(0);
        expect(exitCode2).toBe(1);
      });
    });

    describe("spawn", () => {
      const hugeString = "hello".repeat(10000).slice();

      it("as an array", async () => {
        const { stdout, exited } = spawn(["echo", "hello"], {
          stdout: "pipe",
        });
        gcTick();
        expect(await new Response(stdout).text()).toBe("hello\n");
      });

      it("as an array with options object", async () => {
        const { stdout } = spawn(["printenv", "FOO"], {
          cwd: "/tmp",
          env: {
            ...process.env,
            FOO: "bar",
          },
          stdin: null,
          stdout: "pipe",
          stderr: "inherit",
        });

        const text = await new Response(stdout).text();
        expect(text).toBe("bar\n");
      });

      it("Uint8Array works as stdin", async () => {
        rmSync("/tmp/out.123.txt", { force: true });
        gcTick();
        const { exited } = spawn({
          cmd: ["cat"],
          stdin: new TextEncoder().encode(hugeString),
          stdout: Bun.file("/tmp/out.123.txt"),
        });

        await exited;
        expect(await Bun.file("/tmp/out.123.txt").text()).toBe(hugeString);
      });

      it("check exit code", async () => {
        const exitCode1 = await spawn({
          cmd: ["ls"],
        }).exited;
        const exitCode2 = await spawn({
          cmd: ["false"]
        }).exited;
        expect(exitCode1).toBe(0);
        expect(exitCode2).toBe(1);
      });

      it("Blob works as stdin", async () => {
        rmSync("/tmp/out.123.txt", { force: true });
        gcTick();
        const { exited } = spawn({
          cmd: ["cat"],
          stdin: new Blob([new TextEncoder().encode(hugeString)]),
          stdout: Bun.file("/tmp/out.123.txt"),
        });

        await exited;
        expect(await Bun.file("/tmp/out.123.txt").text()).toBe(hugeString);
      });

      it("Bun.file() works as stdout", async () => {
        rmSync("/tmp/out.123.txt", { force: true });
        gcTick();
        const { exited } = spawn({
          cmd: ["echo", "hello"],
          stdout: Bun.file("/tmp/out.123.txt"),
        });

        await exited;
        gcTick();
        expect(await Bun.file("/tmp/out.123.txt").text()).toBe("hello\n");
      });

      it("Bun.file() works as stdin", async () => {
        await write(Bun.file("/tmp/out.456.txt"), "hello there!");
        gcTick();
        const { stdout } = spawn({
          cmd: ["cat"],
          stdout: "pipe",
          stdin: Bun.file("/tmp/out.456.txt"),
        });
        gcTick();
        expect(await readableStreamToText(stdout)).toBe("hello there!");
      });

      it("Bun.file() works as stdin and stdout", async () => {
        writeFileSync("/tmp/out.456.txt", "hello!");
        gcTick();
        writeFileSync("/tmp/out.123.txt", "wrong!");
        gcTick();

        const { exited } = spawn({
          cmd: ["cat"],
          stdout: Bun.file("/tmp/out.123.txt"),
          stdin: Bun.file("/tmp/out.456.txt"),
        });
        gcTick();
        await exited;
        expect(await Bun.file("/tmp/out.456.txt").text()).toBe("hello!");
        gcTick();
        expect(await Bun.file("/tmp/out.123.txt").text()).toBe("hello!");
      });

      it("stdout can be read", async () => {
        await Bun.write("/tmp/out.txt", hugeString);
        gcTick();
        const { stdout } = spawn({
          cmd: ["cat", "/tmp/out.txt"],
          stdout: "pipe",
        });
        gcTick();

        const text = await readableStreamToText(stdout);
        gcTick();
        expect(text).toBe(hugeString);
      });

      it("stdin can be read and stdout can be written", async () => {
        const proc = spawn({
          cmd: ["bash", import.meta.dir + "/bash-echo.sh"],
          stdout: "pipe",
          stdin: "pipe",
          stderr: "inherit",
        });
        proc.stdin.write(hugeString);
        await proc.stdin.end(true);
        var text = "";
        var reader = proc.stdout.getReader();
        var done = false;
        while (!done) {
          var { value, done } = await reader.read();
          if (value) text += new TextDecoder().decode(value);
          if (done && text.length === 0) {
            reader.releaseLock();
            reader = proc.stdout.getReader();
            done = false;
          }
        }

        expect(text.trim().length).toBe(hugeString.length);
        expect(text.trim()).toBe(hugeString);
        gcTick();
        await proc.exited;
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
  });
}
