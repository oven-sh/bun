import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("pipe does the right thing", async () => {
  // Note: Bun.spawnSync uses memfd_create on Linux for pipe, which means we see
  // it as a file instead of a tty
  const result = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(typeof process.stdin.ref)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });

  expect((await new Response(result.stdout).text()).trim()).toBe("function");
  expect(await result.exited).toBe(0);
});

test.concurrent("file does the right thing", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(typeof process.stdin.ref)"],
    stdin: Bun.file(import.meta.path),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(await result.stdout.text()).toMatchInlineSnapshot(`
    "undefined
    "
  `);
  expect(await result.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(await result.exited).toBe(0);
});

test.concurrent("stdin with 'readable' event handler should receive data when paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const handleReadable = () => {
        let chunk;
        while ((chunk = process.stdin.read())) {
          console.log("got chunk", JSON.stringify(chunk));
        }
      };
      
      process.stdin.on("readable", handleReadable);
      process.stdin.pause();
      
      setTimeout(() => {
        process.exit(1);
      }, 1000);
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("abc\n");
  proc.stdin.write("def\n");
  proc.stdin.end();

  await proc.exited;

  expect(await proc.stdout.text()).toMatchInlineSnapshot(`
    "got chunk {"type":"Buffer","data":[97,98,99,10,100,101,102,10]}
    "
  `);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(proc.exitCode).toBe(1);
});

test.concurrent("stdin with 'data' event handler should NOT receive data when paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const handleData = chunk => {
        console.log("got chunk");
      };
      
      process.stdin.on("data", handleData);
      process.stdin.pause();
      
      setTimeout(() => {
        process.exit(1);
      }, 1000);
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("abc\n");
  proc.stdin.write("def\n");
  proc.stdin.end();

  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

  expect(stdout).toMatchInlineSnapshot(`""`);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
  // Reusing the already-consumed stdout stream now rejects (the stream is disturbed).
  await expect(proc.stdout.text()).rejects.toThrow("ReadableStream has already been used");
  expect(exitCode).toBe(1);
});

// Drains the child; its stderr joins the comparison only when it failed, so a
// crash shows up in the diff without asserting stderr empty on success (debug
// builds write benign noise there).
async function stdioResult(proc: Bun.Subprocess<"pipe", "pipe", "pipe">) {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, exitCode, stderr: exitCode === 0 ? undefined : stderr };
}

test.concurrent("paused mode read(n) returns the buffered remainder at EOF", async () => {
  // 8 bytes pulled 3 at a time: the final read(3) must return the 2 byte tail
  // once EOF is reached, and 'end' must mark readableEnded.
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const chunks = [];
      process.stdin.on("readable", () => {
        let chunk;
        while ((chunk = process.stdin.read(3)) !== null) chunks.push(chunk.toString());
      });
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ chunks, readableEnded: process.stdin.readableEnded }));
      });`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout: JSON.stringify({ chunks: ["abc", "def", "gh"], readableEnded: true }) + "\n",
    exitCode: 0,
  });
});

test.concurrent("explicit read(n) with no 'readable' listener still pulls from stdin", async () => {
  // read() must start the underlying stdin reader even when no 'readable'
  // listener or resume() ever ran.
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const chunks = [];
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ chunks, readableEnded: process.stdin.readableEnded }));
      });
      let spins = 0;
      function poll() {
        let chunk;
        while ((chunk = process.stdin.read(3)) !== null) chunks.push(chunk.toString());
        if (process.stdin.readableEnded) return;
        // Bounded so a regression fails with output instead of spinning forever.
        if (++spins > 20000) {
          console.log(JSON.stringify({ chunks, readableEnded: false }));
          process.exit(1);
        }
        setImmediate(poll);
      }
      poll();`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout: JSON.stringify({ chunks: ["abc", "def", "gh"], readableEnded: true }) + "\n",
    exitCode: 0,
  });
});

test.concurrent("a read() that throws does not keep the process alive", async () => {
  // stdin stays open for the child's whole lifetime: it only exits if the
  // failed read did not start (and ref) the native stdin reader.
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let code = "";
      try {
        process.stdin.read(2 ** 31);
      } catch (err) {
        code = err.code;
      }
      process.on("exit", () => console.log(code));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const result = await stdioResult(proc);
  proc.stdin.end();
  expect(result).toEqual({ stdout: "ERR_OUT_OF_RANGE\n", exitCode: 0 });
});

test.concurrent("touching stdin again after 'end' does not keep the process alive", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.stdin.on("data", () => {});
      process.stdin.on("end", () => {
        console.log("END");
        process.stdin.resume();
        process.stdin.ref();
        process.stdin.on("readable", () => {});
      });
      process.on("exit", () => console.log("EXIT"));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({ stdout: "END\nEXIT\n", exitCode: 0 });
});

test.concurrent("'end' is not emitted when the buffer is never drained, and the process still exits", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.stdin.on("readable", () => {});
      process.stdin.on("end", () => console.log("END"));
      process.on("exit", () => console.log("EXIT " + process.stdin.readableLength));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({ stdout: "EXIT 8\n", exitCode: 0 });
});

test.concurrent("stdin should allow process to exit when paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        process.stdin.on("data", () => {});
        process.stdin.pause();
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  await proc.exited;
  expect(await proc.stdout.text()).toMatchInlineSnapshot(`""`);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(proc.exitCode).toBe(0);
});

test.concurrent("stdin should not allow process to exit when not paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.stdin.on("data", () => {});
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  await Bun.sleep(1000);
  expect(proc.exitCode).toBe(null);
  proc.kill();
  await proc.exited;
  expect(await proc.stdout.text()).toMatchInlineSnapshot(`""`);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
});

test.concurrent("a throw from a 'data' listener is an uncaughtException, and stdin keeps reading", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const seen = [];
      process.on("uncaughtException", (e, origin) => seen.push("uncaughtException:" + e.message + ":" + origin));
      process.stdin.on("error", e => seen.push("stream-error:" + e.message));
      let n = 0;
      process.stdin.on("data", d => {
        seen.push("data:" + d.toString());
        if (++n === 1) { console.log("GOT1"); throw new Error("handler-throw"); }
      });
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ seen, destroyed: process.stdin.destroyed }));
      });`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("one");
  await proc.stdin.flush();
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  for (let r; !(r = await reader.read()).done; ) {
    stdout += decoder.decode(r.value, { stream: true });
    if (stdout.includes("GOT1")) break;
  }
  proc.stdin.write("two");
  await proc.stdin.end();
  for (let r; !(r = await reader.read()).done; ) stdout += decoder.decode(r.value, { stream: true });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode, ...(exitCode === 0 ? {} : { stderr }) }).toEqual({
    stdout:
      "GOT1\n" +
      JSON.stringify({
        seen: ["data:one", "uncaughtException:handler-throw:uncaughtException", "data:two"],
        destroyed: false,
      }) +
      "\n",
    exitCode: 0,
  });
});

test.concurrent("a throw from a 'readable' listener is an uncaughtException, including the EOF emission", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const seen = [];
      process.on("uncaughtException", e => seen.push("uncaughtException:" + e.message));
      process.stdin.on("error", e => seen.push("stream-error:" + e.message));
      let n = 0;
      process.stdin.on("readable", () => {
        n++;
        let chunk;
        while ((chunk = process.stdin.read()) !== null) seen.push("readable:" + chunk.toString());
        throw new Error("readable-throw-" + n);
      });
      process.stdin.on("end", () => seen.push("end"));
      process.on("exit", () => console.log(JSON.stringify(seen)));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("hello");
  await proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout:
      JSON.stringify([
        "readable:hello",
        "uncaughtException:readable-throw-1",
        "end",
        "uncaughtException:readable-throw-2",
      ]) + "\n",
    exitCode: 0,
  });
});

test.concurrent("pause() and resume() churn while data is in flight never destroys stdin", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let total = 0;
      process.stdin.on("data", d => { total += d.length; });
      process.stdin.on("error", err => { console.log("ERROR " + (err?.code || err?.message)); process.exit(1); });
      process.stdin.on("end", () => { console.log("TOTAL " + total); });
      const churn = setInterval(() => { process.stdin.pause(); process.stdin.resume(); }, 5);
      churn.unref();
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  for (let i = 0; i < 20; i++) {
    proc.stdin.write("x".repeat(1024));
    await Bun.sleep(10);
  }
  await proc.stdin.end();
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe(`TOTAL ${20 * 1024}`);
  expect(exitCode).toBe(0);
});
