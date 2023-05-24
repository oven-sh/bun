import { ArrayBufferSink, readableStreamToText, spawn, spawnSync, write } from "bun";
import { describe, expect, it } from "bun:test";
import { gcTick as _gcTick, bunEnv } from "harness";
import { rmSync, writeFileSync } from "node:fs";

for (let [gcTick, label] of [
  [_gcTick, "gcTick"],
  // [() => {}, "no gc tick"],
] as const) {
  Bun.gc(true);
  describe(label, () => {
    describe("spawnSync", () => {
      const hugeString = "hello".repeat(10000).slice();

      it("as an array", () => {
        const { stdout } = spawnSync(["echo", "hi"]);
        gcTick();
        // stdout is a Buffer
        const text = stdout!.toString();
        expect(text).toBe("hi\n");
        gcTick();
      });

      it("Uint8Array works as stdin", async () => {
        const { stdout, stderr } = spawnSync({
          cmd: ["cat"],
          stdin: new TextEncoder().encode(hugeString),
        });
        gcTick();
        expect(stdout!.toString()).toBe(hugeString);
        expect(stderr!.byteLength).toBe(0);
        gcTick();
      });

      it("check exit code", async () => {
        const { exitCode: exitCode1 } = spawnSync({
          cmd: ["ls"],
        });
        gcTick();
        const { exitCode: exitCode2 } = spawnSync({
          cmd: ["false"],
        });
        gcTick();
        expect(exitCode1).toBe(0);
        expect(exitCode2).toBe(1);
        gcTick();
      });
    });

    describe("spawn", () => {
      const hugeString = "hello".repeat(10000).slice();

      it("as an array", async () => {
        gcTick();
        await (async () => {
          const { stdout } = spawn(["echo", "hello"], {
            stdout: "pipe",
            stderr: null,
            stdin: null,
          });
          gcTick();
          const text = await new Response(stdout).text();
          expect(text).toBe("hello\n");
        })();
        gcTick();
      });

      it("as an array with options object", async () => {
        gcTick();
        const { stdout } = spawn(["printenv", "FOO"], {
          cwd: "/tmp",
          env: {
            ...process.env,
            FOO: "bar",
          },
          stdin: null,
          stdout: "pipe",
          stderr: null,
        });
        gcTick();
        const text = await new Response(stdout).text();
        expect(text).toBe("bar\n");
        gcTick();
      });

      it("Uint8Array works as stdin", async () => {
        rmSync("/tmp/out.123.txt", { force: true });
        gcTick();
        const { exited } = spawn({
          cmd: ["cat"],
          stdin: new TextEncoder().encode(hugeString),
          stdout: Bun.file("/tmp/out.123.txt"),
        });
        gcTick();
        await exited;
        expect(require("fs").readFileSync("/tmp/out.123.txt", "utf8")).toBe(hugeString);
        gcTick();
      });

      it("check exit code", async () => {
        const exitCode1 = await spawn({
          cmd: ["ls"],
        }).exited;
        gcTick();
        const exitCode2 = await spawn({
          cmd: ["false"],
        }).exited;
        gcTick();
        expect(exitCode1).toBe(0);
        expect(exitCode2).toBe(1);
        gcTick();
      });

      it("nothing to stdout and sleeping doesn't keep process open 4ever", async () => {
        const proc = spawn({
          cmd: ["sleep", "0.1"],
        });
        gcTick();
        for await (const _ of proc.stdout) {
          throw new Error("should not happen");
        }
        gcTick();
      });

      it.todo("check exit code from onExit", async () => {
        for (let i = 0; i < 1000; i++) {
          var exitCode1, exitCode2;
          await new Promise<void>(resolve => {
            var counter = 0;
            spawn({
              cmd: ["ls"],
              stdin: "ignore",
              stdout: "ignore",
              stderr: "ignore",
              onExit(subprocess, code) {
                exitCode1 = code;
                counter++;
                if (counter === 2) {
                  resolve();
                }
              },
            });

            spawn({
              cmd: ["false"],
              stdin: "ignore",
              stdout: "ignore",
              stderr: "ignore",
              onExit(subprocess, code) {
                exitCode2 = code;
                counter++;

                if (counter === 2) {
                  resolve();
                }
              },
            });
          });

          expect(exitCode1).toBe(0);
          expect(exitCode2).toBe(1);
        }
      });

      // FIXME: fix the assertion failure
      it.skip("Uint8Array works as stdout", () => {
        gcTick();
        const stdout_buffer = new Uint8Array(11);
        const { stdout } = spawnSync(["echo", "hello world"], {
          stdout: stdout_buffer,
          stderr: null,
          stdin: null,
        });
        gcTick();
        const text = new TextDecoder().decode(stdout);
        const text2 = new TextDecoder().decode(stdout_buffer);
        expect(text).toBe("hello world");
        expect(text2).toBe("hello world");
        gcTick();
      });

      it.skip("Uint8Array works as stdout when is smaller than output", () => {
        gcTick();
        const stdout_buffer = new Uint8Array(5);
        const { stdout } = spawnSync(["echo", "hello world"], {
          stdout: stdout_buffer,
          stderr: null,
          stdin: null,
        });
        gcTick();
        const text = new TextDecoder().decode(stdout);
        const text2 = new TextDecoder().decode(stdout_buffer);
        expect(text).toBe("hello");
        expect(text2).toBe("hello");
        gcTick();
      });

      it.skip("Uint8Array works as stdout when is the exactly size than output", () => {
        gcTick();
        const stdout_buffer = new Uint8Array(12);
        const { stdout } = spawnSync(["echo", "hello world"], {
          stdout: stdout_buffer,
          stderr: null,
          stdin: null,
        });
        gcTick();
        const text = new TextDecoder().decode(stdout);
        const text2 = new TextDecoder().decode(stdout_buffer);
        expect(text).toBe("hello world\n");
        expect(text2).toBe("hello world\n");
        gcTick();
      });

      it.skip("Uint8Array works as stdout when is larger than output", () => {
        gcTick();
        const stdout_buffer = new Uint8Array(15);
        const { stdout } = spawnSync(["echo", "hello world"], {
          stdout: stdout_buffer,
          stderr: null,
          stdin: null,
        });
        gcTick();
        const text = new TextDecoder().decode(stdout);
        const text2 = new TextDecoder().decode(stdout_buffer);
        expect(text).toBe("hello world\n");
        expect(text2).toBe("hello world\n\u0000\u0000\u0000");
        gcTick();
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
        expect(await readableStreamToText(stdout!)).toBe("hello there!");
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

        const text = await readableStreamToText(stdout!);
        gcTick();
        expect(text).toBe(hugeString);
      });

      it("kill(1) works", async () => {
        const process = spawn({
          cmd: ["bash", "-c", "sleep 1000"],
          stdout: "pipe",
        });
        gcTick();
        const prom = process.exited;
        process.kill(1);
        await prom;
      });

      it("kill() works", async () => {
        const process = spawn({
          cmd: ["bash", "-c", "sleep 1000"],
          stdout: "pipe",
        });
        gcTick();
        const prom = process.exited;
        process.kill();
        await prom;
      });

      it("stdin can be read and stdout can be written", async () => {
        const proc = spawn({
          cmd: ["bash", import.meta.dir + "/bash-echo.sh"],
          stdout: "pipe",
          stdin: "pipe",
          lazy: true,
          stderr: "inherit",
        });

        var stdout = proc.stdout;
        var reader = stdout.getReader();
        proc.stdin!.write("hey\n");
        await proc.stdin!.end();
        var text = "";

        reader;
        var done = false,
          value;

        while (!done) {
          ({ value, done } = await reader.read());
          if (value) text += new TextDecoder().decode(value);
          if (done && text.length === 0) {
            reader.releaseLock();
            reader = stdout.getReader();
            done = false;
          }
        }

        expect(text.trim().length).toBe("hey".length);
        expect(text.trim()).toBe("hey");
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
            lazy: true,
          });
        }

        function helloWorld() {
          return spawn({
            cmd: ["echo", "hello"],
            stdout: "pipe",
            stdin: "ignore",
          });
        }

        const fixtures = [
          [helloWorld, "hello"],
          [huge, hugeString],
        ] as const;

        for (const [callback, fixture] of fixtures) {
          describe(fixture.slice(0, 12), () => {
            describe("should should allow reading stdout", () => {
              it("before exit", async () => {
                const process = callback();
                const output = await readableStreamToText(process.stdout);
                await process.exited;
                const expected = fixture + "\n";

                expect(output.length).toBe(expected.length);
                expect(output).toBe(expected);
              });

              it("before exit (chunked)", async () => {
                const process = callback();
                var sink = new ArrayBufferSink();
                var any = false;
                await (async function () {
                  var reader = process.stdout?.getReader();

                  reader?.closed.then(
                    a => {
                      console.log("Closed!");
                    },
                    err => {
                      console.log("Closed!", err);
                    },
                  );
                  var done = false,
                    value;
                  while (!done) {
                    ({ value, done } = await reader!.read());

                    if (value) {
                      any = true;
                      sink.write(value);
                    }
                  }
                })();
                expect(any).toBe(true);

                const expected = fixture + "\n";

                const output = await new Response(sink.end()).text();
                expect(output.length).toBe(expected.length);
                await process.exited;
                expect(output).toBe(expected);
              });

              it("after exit", async () => {
                const process = callback();
                await process.exited;
                const output = await readableStreamToText(process.stdout);
                const expected = fixture + "\n";
                expect(output.length).toBe(expected.length);
                expect(output).toBe(expected);
              });
            });
          });
        }
      });
    });
  });
}
