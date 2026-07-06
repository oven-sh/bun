import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";
import { isatty } from "tty";
describe.concurrent("process-stdio", () => {
  test("process.stdin", () => {
    expect(process.stdin).toBeDefined();
    expect(process.stdin.isTTY).toBe(isatty(0) ? true : undefined);
    expect(process.stdin.on("close", function () {})).toBe(process.stdin);
    expect(process.stdin.once("end", function () {})).toBe(process.stdin);
  });

  const files = {
    echo: path.join(import.meta.dir, "process-stdin-echo.js"),
  };

  test("process.stdin - read", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo],
      stdout: "pipe",
      stdin: "pipe",
      stderr: "inherit",
      env: {
        ...bunEnv,
      },
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe(lines.join("\n") + "ENDED");
  });

  test("process.stdin - resume", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo, "resume"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: null,
      env: bunEnv,
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe("RESUMED" + lines.join("\n") + "ENDED");
  });

  test("process.stdin - close(#6713)", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo, "close-event"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe(lines.join("\n") + "ENDED-CLOSE");
  });

  test("process.stdout", () => {
    expect(process.stdout).toBeDefined();
    // isTTY returns true or undefined in Node.js
    expect(process.stdout.isTTY).toBe((isatty(1) || undefined) as any);
  });

  test("process.stderr", () => {
    expect(process.stderr).toBeDefined();
    // isTTY returns true or undefined in Node.js
    expect(process.stderr.isTTY).toBe((isatty(2) || undefined) as any);
  });

  test("process.stdout - write", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });

    expect(stdout?.toString()).toBe(`hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`);
  });

  test("process.stdout - write after end()", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          process.stdout.on("error", e => process.stderr.write("error-event:" + e.code + "\\n"));
          process.stdout.write("kept\\n");
          process.stdout.end();
          const ret = process.stdout.write("dropped\\n", err => {
            process.stderr.write("cb:" + (err && err.code) + "\\n");
          });
          process.stderr.write("ret:" + ret + "\\n");
        `,
      ],
      stdout: "pipe",
      stderr: "pipe",
      stdin: null,
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The chunk written after end() is dropped, and the failure is reported
    // through the write callback and an 'error' event, like node.
    expect(stdout).toBe("kept\n");
    expect(stderr.split("\n").filter(Boolean)).toEqual([
      "ret:false",
      "cb:ERR_STREAM_WRITE_AFTER_END",
      "error-event:ERR_STREAM_WRITE_AFTER_END",
    ]);
    expect(exitCode).toBe(0);
  });

  test("process.stdout - write a lot (string)", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
        TEST_STDIO_STRING: "1",
      },
    });

    expect(stdout?.toString()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });

  test("process.stdout - write a lot (bytes)", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(stdout?.toString()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });

  // `process.stdout` used to write straight to its native sink, leaving
  // `_writableState` untouched: writableLength/writableNeedDrain always read
  // as "nothing buffered" and cork() never held anything back.
  describe("backpressure accounting", () => {
    const N = 4 * 1024 * 1024;

    /** Reads `stream` incrementally, resolving each time `marker` matches. */
    function markerReader(stream: ReadableStream<Uint8Array>) {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      return async function until(marker: RegExp): Promise<RegExpMatchArray> {
        while (true) {
          const matched = buffered.match(marker);
          if (matched) return matched;
          const { done, value } = await reader.read();
          if (value) buffered += decoder.decode(value, { stream: true });
          else if (done) throw new Error(`stream ended before ${marker} matched: ${JSON.stringify(buffered)}`);
        }
      };
    }

    test("writableLength, writableNeedDrain and cork() track the buffered bytes", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const so = process.stdout;
            const facts = { hwm: so.writableHighWaterMark };
            facts.writeRet = so.write(Buffer.alloc(${N}, 0x41), () => {});
            facts.length = so.writableLength;
            facts.needDrain = so.writableNeedDrain;
            so.cork();
            so.write(Buffer.alloc(1000, 0x42), () => {});
            facts.corkedLength = so.writableLength;
            facts.corked = so.writableCorked;
            so.uncork();
            process.stderr.write("@@" + JSON.stringify(facts) + "@@");
          `,
        ],
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      // stdout is deliberately left unread until the facts land on stderr, so the
      // 4 MB write has nowhere to drain to and the sink has to buffer all of it.
      const [, json] = await markerReader(proc.stderr)(/@@(.*)@@/);

      expect(JSON.parse(json)).toEqual({
        hwm: 65536,
        writeRet: false,
        length: N,
        needDrain: true,
        corkedLength: N + 1000,
        corked: 1,
      });

      // Unblock the child so it can flush and exit.
      expect((await proc.stdout.text()).length).toBe(N + 1000);
      expect(await proc.exited).toBe(0);
    });

    test("'drain' resets writableLength and writableNeedDrain", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const so = process.stdout;
            const writeRet = so.write(Buffer.alloc(${N}, 0x41));
            const before = { length: so.writableLength, needDrain: so.writableNeedDrain };
            so.once("drain", () => {
              const after = { length: so.writableLength, needDrain: so.writableNeedDrain };
              process.stderr.write("@@" + JSON.stringify({ writeRet, before, after }) + "@@");
            });
            process.stderr.write("##buffered##");
          `,
        ],
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      const until = markerReader(proc.stderr);
      // Only start draining stdout once the child reports the write is buffered,
      // otherwise it might never backpressure and 'drain' would never fire.
      await until(/##buffered##/);
      const [stdout, [, json]] = await Promise.all([proc.stdout.text(), until(/@@(.*)@@/)]);

      expect(JSON.parse(json)).toEqual({
        writeRet: false,
        before: { length: N, needDrain: true },
        after: { length: 0, needDrain: false },
      });
      expect(stdout.length).toBe(N);
      expect(await proc.exited).toBe(0);
    });
  });

  test("process.stdout - write() decodes the encoding argument", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write("414243", "hex");
         process.stdout.write("ZGVm", "base64");
         process.stdout.write("\\u00e9", "latin1");
         process.stdout.setDefaultEncoding("hex");
         process.stdout.write("21");`,
      ],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
    expect({ stdout: Buffer.from(stdout).toString("latin1"), exitCode }).toEqual({
      stdout: "ABCdef\xe9!",
      exitCode: 0,
    });
  });

  // sonic-boom (pino) treats an own `write` as a tampered stream and drops off
  // its batched fast path, so stdio must inherit write() from the prototype.
  test("process.stdout - write() is inherited, not an own property", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write(JSON.stringify({
           untampered: process.stdout.write === process.stdout.constructor.prototype.write,
           ownWrite: Object.hasOwn(process.stdout, "write"),
         }));`,
      ],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ ...JSON.parse(stdout), exitCode }).toEqual({ untampered: true, ownWrite: false, exitCode: 0 });
  });

  // Write callbacks are deferred, so they interleave with readline's cursor
  // callbacks (which report from process.nextTick) in call order.
  test("process.stdout - write callbacks run in call order with readline cursor callbacks", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const readline = require("node:readline");
         const order = [];
         let pending = 5;
         const done = n => {
           order.push(n);
           if (--pending === 0) require("fs").writeSync(2, order.join(","));
         };
         process.stdout.write("A", () => done("w1"));
         readline.moveCursor(process.stdout, 0, 0, () => done("m0"));
         process.stdout.write("B", () => done("w2"));
         readline.cursorTo(process.stdout, 3, undefined, () => done("c"));
         readline.moveCursor(process.stdout, 1, 0, () => done("m1"));`,
      ],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "w1,m0,w2,c,m1", exitCode: 0 });
  });
});
