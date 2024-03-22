import { ArrayBufferSink, readableStreamToText, spawn, spawnSync, write } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { closeSync, fstatSync, openSync } from "fs";
import { gcTick as _gcTick, bunEnv, bunExe, isLinux, isMacOS, isPosix, isWindows, withoutAggressiveGC } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "path";
let tmp;

beforeAll(() => {
  tmp = path.join(tmpdir(), "bun-spawn-" + Date.now().toString(32)) + path.sep;
  rmSync(tmp, { force: true, recursive: true });
  mkdirSync(tmp, { recursive: true });
});

function createHugeString() {
  const buf = Buffer.allocUnsafe("hello".length * 100 * 500 + "hey".length);
  buf.fill("hello");
  buf.write("hey", buf.length - "hey".length);
  return buf.toString();
}

for (let [gcTick, label] of [
  [_gcTick, "gcTick"],
  // [() => {}, "no gc tick"],
] as const) {
  Bun.gc(true);
  describe(label, () => {
    describe("spawnSync", () => {
      const hugeString = "hello".repeat(50000).slice();

      it("as an array", () => {
        const { stdout } = spawnSync(["node", "-e", "console.log('hi')"]);
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
        const text = stdout!.toString();
        if (text !== hugeString) {
          expect(text).toHaveLength(hugeString.length);
          expect(text).toBe(hugeString);
        }
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

      it("throws errors for invalid arguments", async () => {
        expect(() => {
          spawnSync({
            cmd: ["node", "-e", "console.log('hi')"],
            cwd: "./this-should-not-exist",
          });
        }).toThrow("No such file or directory");
      });
    });

    describe("spawn", () => {
      const hugeString = createHugeString();

      it("as an array", async () => {
        gcTick();
        await (async () => {
          const { stdout } = spawn(["node", "-e", "console.log('hello')"], {
            stdout: "pipe",
            stderr: "ignore",
            stdin: "ignore",
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
          cwd: tmp,
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
        rmSync(tmp + "out.123.txt", { force: true });
        gcTick();
        const { exited } = spawn({
          cmd: ["cat"],
          stdin: new TextEncoder().encode(hugeString),
          stdout: Bun.file(tmp + "out.123.txt"),
        });
        gcTick();
        await exited;
        expect(require("fs").readFileSync(tmp + "out.123.txt", "utf8") == hugeString).toBeTrue();
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

      it("check exit code from onExit", async () => {
        const count = isWindows ? 100 : 1000;

        for (let i = 0; i < count; i++) {
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
      }, 60_000_0);

      // FIXME: fix the assertion failure
      it.skip("Uint8Array works as stdout", () => {
        gcTick();
        const stdout_buffer = new Uint8Array(11);
        const { stdout } = spawnSync(["node", "-e", "console.log('hello world')"], {
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
        const { stdout } = spawnSync(["node", "-e", "console.log('hello world')"], {
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
        const { stdout } = spawnSync(["node", "-e", "console.log('hello world')"], {
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
        const { stdout } = spawnSync(["node", "-e", "console.log('hello world')"], {
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
        rmSync(tmp + "out.123.txt", { force: true });
        gcTick();
        const { exited } = spawn({
          cmd: ["cat"],
          stdin: new Blob([new TextEncoder().encode(hugeString)]),
          stdout: Bun.file(tmp + "out.123.txt"),
        });

        await exited;
        expect((await Bun.file(tmp + "out.123.txt").text()) == hugeString).toBeTrue();
      });

      it("Bun.file() works as stdout", async () => {
        rmSync(tmp + "out.123.txt", { force: true });
        gcTick();
        const { exited } = spawn({
          cmd: ["node", "-e", "console.log('hello')"],
          stdout: Bun.file(tmp + "out.123.txt"),
        });

        await exited;
        gcTick();
        expect(await Bun.file(tmp + "out.123.txt").text()).toBe("hello\n");
      });

      it("Bun.file() works as stdin", async () => {
        await write(Bun.file(tmp + "out.456.txt"), "hello there!");
        gcTick();
        const { stdout } = spawn({
          cmd: ["cat"],
          stdout: "pipe",
          stdin: Bun.file(tmp + "out.456.txt"),
        });
        gcTick();
        expect(await readableStreamToText(stdout!)).toBe("hello there!");
      });

      it("Bun.file() works as stdin and stdout", async () => {
        writeFileSync(tmp + "out.456.txt", "hello!");
        gcTick();
        writeFileSync(tmp + "out.123.txt", "wrong!");
        gcTick();

        const { exited } = spawn({
          cmd: ["cat"],
          stdout: Bun.file(tmp + "out.123.txt"),
          stdin: Bun.file(tmp + "out.456.txt"),
        });
        gcTick();
        await exited;
        expect(await Bun.file(tmp + "out.456.txt").text()).toBe("hello!");
        gcTick();
        expect(await Bun.file(tmp + "out.123.txt").text()).toBe("hello!");
      });

      it("stdout can be read", async () => {
        await Bun.write(tmp + "out.txt", hugeString);
        gcTick();
        const promises = new Array(10);
        const statusCodes = new Array(10);
        for (let i = 0; i < promises.length; i++) {
          const { stdout, exited } = spawn({
            cmd: ["cat", tmp + "out.txt"],
            stdout: "pipe",
            stdin: "ignore",
            stderr: "inherit",
          });

          gcTick();

          promises[i] = readableStreamToText(stdout!);
          statusCodes[i] = exited;
          gcTick();
        }

        const outputs = await Promise.all(promises);
        const statuses = await Promise.all(statusCodes);

        withoutAggressiveGC(() => {
          for (let i = 0; i < outputs.length; i++) {
            const output = outputs[i];
            const status = statuses[i];
            expect(status).toBe(0);
            if (output !== hugeString) {
              expect(output.length).toBe(hugeString.length);
            }
            expect(output).toBe(hugeString);
          }
        });
      });

      it("kill(SIGKILL) works", async () => {
        const process = spawn({
          cmd: ["sleep", "1000"],
          stdout: "pipe",
        });
        gcTick();
        const prom = process.exited;
        process.kill("SIGKILL");
        await prom;
      });

      it("kill() works", async () => {
        const process = spawn({
          cmd: ["sleep", "1000"],
          stdout: "pipe",
        });
        gcTick();
        const prom = process.exited;
        process.kill();
        await prom;
      });

      it("stdin can be read and stdout can be written", async () => {
        const proc = spawn({
          cmd: ["node", "-e", "process.stdin.setRawMode?.(true); process.stdin.pipe(process.stdout)"],
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
            cmd: ["cat"],
            stdout: "pipe",
            stdin: new Blob([hugeString + "\n"]),
            stderr: "inherit",
            lazy: true,
          });
        }

        function helloWorld() {
          return spawn({
            cmd: ["node", "-e", "console.log('hello')"],
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
                var { resolve, promise } = Promise.withResolvers();

                (async function () {
                  var reader = process.stdout?.getReader();

                  var done = false,
                    value;
                  while (!done && resolve) {
                    ({ value, done } = await reader!.read());

                    if (value) {
                      any = true;
                      sink.write(value);
                    }
                  }

                  resolve && resolve();
                  resolve = undefined;
                })();
                await promise;
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

      it("throws errors for invalid arguments", async () => {
        expect(() => {
          spawnSync({
            cmd: ["node", "-e", "console.log('hi')"],
            cwd: "./this-should-not-exist",
          });
        }).toThrow("No such file or directory");
      });
    });
  });
}

// This is a test which should only be used when pidfd and EVTFILT_PROC is NOT available
if (!process.env.BUN_FEATURE_FLAG_FORCE_WAITER_THREAD && isPosix && !isMacOS) {
  it("with BUN_FEATURE_FLAG_FORCE_WAITER_THREAD", async () => {
    const result = spawnSync({
      cmd: [bunExe(), "test", path.resolve(import.meta.path)],
      env: {
        ...bunEnv,
        // Both flags are necessary to force this condition
        "BUN_FEATURE_FLAG_FORCE_WAITER_THREAD": "1",
        "BUN_GARBAGE_COLLECTOR_LEVEL": "1",
      },
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
    });
    expect(result.exitCode).toBe(0);
  }, 128_000);
}

describe("spawn unref and kill should not hang", () => {
  it("kill and await exited", async () => {
    const promises = new Array(10);
    for (let i = 0; i < promises.length; i++) {
      const proc = spawn({
        cmd: ["sleep", "0.001"],
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      proc.kill();
      promises[i] = proc.exited;
    }

    await Promise.all(promises);

    expect().pass();
  });
  it("unref", async () => {
    for (let i = 0; i < 10; i++) {
      const proc = spawn({
        cmd: ["sleep", "0.001"],
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      // TODO: on Windows
      if (!isWindows) proc.unref();
      await proc.exited;
    }

    expect().pass();
  });
  it("kill and unref", async () => {
    for (let i = 0; i < (isWindows ? 10 : 100); i++) {
      const proc = spawn({
        cmd: ["sleep", "0.001"],
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });

      proc.kill();
      if (!isWindows) proc.unref();

      await proc.exited;
      console.count("Finished");
    }

    expect().pass();
  });
  it("unref and kill", async () => {
    for (let i = 0; i < (isWindows ? 10 : 100); i++) {
      const proc = spawn({
        cmd: ["sleep", "0.001"],
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      // TODO: on Windows
      if (!isWindows) proc.unref();
      proc.kill();
      await proc.exited;
    }

    expect().pass();
  });

  // process.unref() on Windows does not work ye :(
  it("should not hang after unref", async () => {
    const proc = spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "does-not-hang.js")],
    });

    await proc.exited;
    expect().pass();
  });
});

async function runTest(sleep: string, order = ["sleep", "kill", "unref", "exited"]) {
  console.log("running", order.join(","), "x 100");
  for (let i = 0; i < (isWindows ? 10 : 100); i++) {
    const proc = spawn({
      cmd: ["sleep", sleep],
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    for (let action of order) {
      switch (action) {
        case "sleep": {
          await Bun.sleep(1);
          break;
        }

        case "kill": {
          proc.kill();
          break;
        }

        case "unref": {
          proc.unref();
          break;
        }

        case "exited": {
          expect(await proc.exited).toBeNumber();
          break;
        }

        default: {
          throw new Error("unknown action");
        }
      }
    }
  }
  expect().pass();
}

describe("should not hang", () => {
  for (let sleep of ["0", "0.1"]) {
    it(
      "sleep " + sleep,
      () => {
        const runs = [];
        for (let order of [
          ["sleep", "kill", "unref", "exited"],
          ["sleep", "unref", "kill", "exited"],
          ["kill", "sleep", "unref", "exited"],
          ["kill", "unref", "sleep", "exited"],
          ["unref", "sleep", "kill", "exited"],
          ["unref", "kill", "sleep", "exited"],
          ["exited", "sleep", "kill", "unref"],
          ["exited", "sleep", "unref", "kill"],
          ["exited", "kill", "sleep", "unref"],
          ["exited", "kill", "unref", "sleep"],
          ["exited", "unref", "sleep", "kill"],
          ["exited", "unref", "kill", "sleep"],
          ["unref", "exited"],
          ["exited", "unref"],
          ["kill", "exited"],
          ["exited"],
        ]) {
          runs.push(
            runTest(sleep, order).catch(err => {
              console.error("For order", JSON.stringify(order, null, 2));
              throw err;
            }),
          );
        }

        return Promise.all(runs);
      },
      128_000,
    );
  }
});

it("#3480", async () => {
  try {
    var server = Bun.serve({
      port: 0,
      fetch: (req, res) => {
        Bun.spawnSync(["node", "-e", "console.log('1')"], {});
        return new Response("Hello world!");
      },
    });

    const response = await fetch("http://" + server.hostname + ":" + server.port);
    expect(await response.text()).toBe("Hello world!");
    expect(response.ok);
  } finally {
    server!.stop(true);
  }
});

describe("close handling", () => {
  var testNumber = 0;
  for (let stdin_ of [() => openSync(import.meta.path, "r"), "ignore", Bun.stdin, undefined as any] as const) {
    const stdinFn = typeof stdin_ === "function" ? stdin_ : () => stdin_;
    for (let stdout of [1, "ignore", Bun.stdout, undefined as any] as const) {
      for (let stderr of [2, "ignore", Bun.stderr, undefined as any] as const) {
        const thisTest = testNumber++;
        it(`#${thisTest} [ ${typeof stdin_ === "function" ? "fd" : stdin_}, ${stdout}, ${stderr} ]`, async () => {
          const stdin = stdinFn();

          function getExitPromise() {
            const { exited: proc1Exited } = spawn({
              cmd: ["node", "-e", "console.log('" + "Executing test " + thisTest + "')"],
              stdin,
              stdout,
              stderr,
            });

            const { exited: proc2Exited } = spawn({
              cmd: ["node", "-e", "console.log('" + "Executing test " + thisTest + "')"],
              stdin,
              stdout,
              stderr,
            });

            return Promise.all([proc1Exited, proc2Exited]);
          }

          // We do this to try to force the GC to finalize the Subprocess objects.
          await (async function () {
            let exitPromise = getExitPromise();

            if (typeof stdin === "number") {
              expect(() => fstatSync(stdin)).not.toThrow();
            }

            if (typeof stdout === "number") {
              expect(() => fstatSync(stdout)).not.toThrow();
            }

            if (typeof stderr === "number") {
              expect(() => fstatSync(stderr)).not.toThrow();
            }

            await exitPromise;
          })();
          Bun.gc(false);
          await Bun.sleep(0);

          if (typeof stdin === "number") {
            expect(() => fstatSync(stdin)).not.toThrow();
          }

          if (typeof stdout === "number") {
            expect(() => fstatSync(stdout)).not.toThrow();
          }

          if (typeof stderr === "number") {
            expect(() => fstatSync(stderr)).not.toThrow();
          }

          if (typeof stdin === "number") {
            closeSync(stdin);
          }
        });
      }
    }
  }
});
