import { dlopen, ptr } from "bun:ffi";
import { describe, expect, onTestFinished, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { exec } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { devNull } from "node:os";
import { join } from "node:path";

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

test.concurrent("reading a file stdin to the end leaves fd 0 open", async () => {
  // Bun destroys stdin after 'end'. That must not close the process's fd 0, or
  // the next open() reuses it and children no longer inherit the real stdin.
  const script = `
    const fs = require("fs");
    process.stdin.on("data", () => {});
    process.stdin.on("close", () => {
      setTimeout(() => {
        fs.fstatSync(0);
        const fd = fs.openSync(process.execPath, "r");
        console.log(fd === 0 ? "fd 0 reused" : "fd 0 kept");
      }, 10);
    });
  `;
  const result = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    stdin: Bun.file(import.meta.path),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([result.stdout.text(), result.stderr.text(), result.exited]);
  expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "fd 0 kept", stderr: "" });
  expect(exitCode).toBe(0);
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
type StdioResult = { stdout: string; exitCode: number; stderr?: string };
async function stdioResult(proc: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<StdioResult> {
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

test.concurrent.skipIf(!isWindows)("a loop that never sleeps gets its stdin with one processor to run on", async () => {
  // A thread reads an inherited pipe for the event loop, and here the two have to share.
  using dir = tempDir("stdin-one-processor", {
    "poll.js": `
      const deadline = Date.now() + 10_000;
      (function poll() {
        const chunk = process.stdin.read(3);
        if (chunk !== null || Date.now() > deadline) {
          console.log(String(chunk));
          process.exit(0);
        }
        setImmediate(poll);
      })();`,
  });
  const proc = Bun.spawn({
    cmd: ["cmd", "/d", "/c", "start", "", "/b", "/wait", "/affinity", "1", bunExe(), "poll.js"],
    cwd: String(dir),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({ stdout: "abc\n", exitCode: 0 });
});

// Waiting for input takes none of it: whoever was handed a chunk can read the next one in a call of their own, or
// leave it to a child.
describe.concurrent("the chunk after the one that was delivered is for whoever reads first", () => {
  const readSync = `(b => b.toString("utf8", 0, require("fs").readSync(0, b)))(Buffer.alloc(64))`;
  const takers = {
    "fs.readSync(0)": readSync,
    "a child that inherits stdin": `require("child_process")
      .spawnSync(process.execPath, ["-e", ${JSON.stringify(`process.stdout.write(${readSync})`)}], {
        stdio: ["inherit", "pipe", "inherit"],
      })
      .stdout.toString()`,
  };
  const readers = {
    "a 'data' listener": (take: string) => `
      let chunks = 0;
      process.stdin.on("data", chunk => {
        console.log("delivered " + chunk);
        if (++chunks === 1) console.log("taken " + ${take});
      });`,
    "a 'data' listener that pauses meanwhile": (take: string) => `
      let chunks = 0;
      process.stdin.on("data", chunk => {
        console.log("delivered " + chunk);
        if (++chunks > 1) return;
        process.stdin.pause();
        console.log("taken " + ${take});
        process.stdin.resume();
      });`,
    "Bun.stdin.stream()": (take: string) => `
      let chunks = 0;
      for await (const chunk of Bun.stdin.stream()) {
        console.log("delivered " + Buffer.from(chunk));
        if (++chunks === 1) console.log("taken " + ${take});
      }`,
  };

  describe.each(Object.keys(readers))("%s", reader => {
    test.each(Object.keys(takers))("%s", async taker => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", readers[reader](takers[taker])],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
        env: bunEnv,
      });
      const stdout = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let output = "";
      // Each chunk is answered with a line, and is written once the one before it was.
      for (let lines = 1; lines <= 3; lines++) {
        proc.stdin.write(["one", "two", "three"][lines - 1]);
        proc.stdin.flush();
        while (output.split("\n").length <= lines) {
          const { value, done } = await stdout.read();
          if (done) break;
          output += decoder.decode(value, { stream: true });
        }
      }
      proc.stdin.end();

      expect(output).toBe("delivered one\ntaken two\ndelivered three\n");
      expect(await proc.exited).toBe(0);
    });
  });
});

test.skipIf(!isWindows)("a socket as stdin ends when its peer is done sending", async () => {
  const ws2_32 = dlopen("ws2_32.dll", {
    WSASocketW: { args: ["i32", "i32", "i32", "ptr", "u32", "u32"], returns: "u64" },
    connect: { args: ["u64", "ptr", "i32"], returns: "i32" },
    closesocket: { args: ["u64"], returns: "i32" },
  });
  const kernel32 = dlopen("kernel32.dll", {
    SetHandleInformation: { args: ["u64", "u32", "u32"], returns: "i32" },
    CreateProcessW: { args: ["ptr", "ptr", "ptr", "ptr", "i32", "u32", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
    TerminateProcess: { args: ["u64", "u32"], returns: "i32" },
    CloseHandle: { args: ["u64"], returns: "i32" },
  });
  const wide = (text: string) => Buffer.from(text + "\0", "utf16le");

  let received = "";
  const closed = Promise.withResolvers<void>();
  using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.write("hello");
        socket.shutdown();
      },
      data(_, chunk) {
        received += chunk;
      },
      close() {
        closed.resolve();
      },
    },
  });

  // Without WSA_FLAG_OVERLAPPED, as a standard handle has to be for most programs.
  const socket = ws2_32.symbols.WSASocketW(2 /* AF_INET */, 1 /* SOCK_STREAM */, 6 /* IPPROTO_TCP */, null, 0, 0);
  const address = Buffer.alloc(16);
  address.writeUInt16LE(2 /* AF_INET */, 0);
  address.writeUInt16BE(server.port, 2);
  address.set([127, 0, 0, 1], 4);
  expect(ws2_32.symbols.connect(socket, ptr(address), address.length)).toBe(0);
  expect(kernel32.symbols.SetHandleInformation(socket, 1 /* HANDLE_FLAG_INHERIT */, 1)).not.toBe(0);

  // The socket is also the only way for the child to tell.
  const script = `let all = ''; process.stdin.on('data', chunk => (all += chunk)).on('end', () => require('fs').writeSync(0, 'end after ' + all));`;
  const commandLine = wide(`"${bunExe()}" -e "${script}"`);
  const environment = wide(
    Object.entries(bunEnv)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}=${value}\0`)
      .join(""),
  );
  const startupInfo = Buffer.alloc(104);
  startupInfo.writeUInt32LE(startupInfo.length, 0);
  startupInfo.writeUInt32LE(0x100 /* STARTF_USESTDHANDLES */, 60);
  startupInfo.writeBigUInt64LE(socket, 80);
  const processInformation = Buffer.alloc(24);
  expect(
    kernel32.symbols.CreateProcessW(
      null,
      ptr(commandLine),
      null,
      null,
      1,
      0x400 /* CREATE_UNICODE_ENVIRONMENT */,
      ptr(environment),
      null,
      ptr(startupInfo),
      ptr(processInformation),
    ),
  ).not.toBe(0);
  onTestFinished(() => {
    kernel32.symbols.TerminateProcess(processInformation.readBigUInt64LE(0), 1);
    kernel32.symbols.CloseHandle(processInformation.readBigUInt64LE(0));
    kernel32.symbols.CloseHandle(processInformation.readBigUInt64LE(8));
  });
  ws2_32.symbols.closesocket(socket);

  await closed.promise;
  expect(received).toBe("end after hello");
});

// In that mode a read that finds nothing is an error, and the empty message is gone once something has asked for data.
test.concurrent.skipIf(!isWindows)("an empty message is nothing to a stdin in the mode PIPE_NOWAIT", async () => {
  const fixture = join(import.meta.dir, "..", "net", "windows-foreign-pipe-fixture.js");
  const child = `
    process.stdin
      .on("data", chunk => console.log(String(chunk)))
      .on("end", () => console.log("end"))
      .on("error", error => console.log(error.code));
  `;
  const script = `
    const { createServer, openClient, setNoWait } = require(${JSON.stringify(fixture)});
    const server = createServer({ messages: true });
    const { fd, handle } = openClient(server.name, "r+");
    setNoWait(handle);
    const child = Bun.spawn({
      cmd: [process.execPath, "-e", ${JSON.stringify(child)}],
      stdin: fd,
      stdout: "pipe",
      stderr: "inherit",
    });
    require("node:fs").closeSync(fd);

    let output = "";
    const reader = child.stdout.getReader();
    async function until(text) {
      while (!output.includes(text)) {
        const { value, done } = await reader.read();
        if (done) break;
        output += Buffer.from(value);
      }
    }

    server.write("one");
    await until("one");
    server.write("");
    server.flush();
    server.write("two");
    await until("two");
    server.close();
    await until("end");
    process.stdout.write(output);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("one\ntwo\nend\n");
  expect(exitCode).toBe(0);
});

describe.concurrent("a directory as stdin is an 'error', as in Node.js", () => {
  test.each([
    ["on('data')", `process.stdin.on("data", () => seen.push("data"));`],
    ["on('readable')", `process.stdin.on("readable", () => seen.push("readable"));`],
    ["resume()", `process.stdin.resume();`],
    ["read()", `process.stdin.read();`],
  ])("%s", async (_, start) => {
    using dir = tempDir("process-stdin-directory", {});
    const fd = openSync(String(dir), "r");
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const seen = [];
            process.stdin.on("error", error => seen.push([error.code, error.syscall]));
            process.stdin.on("end", () => seen.push("end"));
            process.stdin.on("close", () => seen.push("close"));
            process.on("exit", () => console.log(JSON.stringify([...seen, process.stdin.destroyed, process.stdin.errored?.code])));
            ${start}
            seen.push("returned");
            process.stdin.resume();
          `,
        ],
        env: bunEnv,
        stdio: [fd, "pipe", "inherit"],
      });
      expect(await proc.stdout.json()).toEqual(["returned", ["EISDIR", "read"], "close", true, "EISDIR"]);
      expect(await proc.exited).toBe(0);
    } finally {
      closeSync(fd);
    }
  });
});

test.concurrent("a stdin that is not open for reading is an 'error', as in Node.js", async () => {
  const fd = openSync(devNull, "w");
  try {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `process.stdin.on("error", error => console.log(error.code)).resume();`],
      env: bunEnv,
      stdio: [fd, "pipe", "inherit"],
    });
    expect(await proc.stdout.text()).toBe("EBADF\n");
    expect(await proc.exited).toBe(0);
  } finally {
    closeSync(fd);
  }
});

test.concurrent("process.stdin can be read once a lock on Bun.stdin.stream() is released", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const seen = [];
        const reader = Bun.stdin.stream().getReader();
        process.stdin.on("error", error => seen.push("error " + error.code));
        try { process.stdin.resume(); seen.push("returned"); } catch (error) { seen.push("threw " + error.code); }
        reader.releaseLock();
        let text = "";
        process.stdin.on("data", chunk => (text += chunk));
        process.stdin.on("end", () => seen.push("end"));
        process.on("exit", () => console.log(JSON.stringify([...seen, text])));
      `,
    ],
    env: bunEnv,
    stdin: new Blob(["hello world"]),
    stdout: "pipe",
    stderr: "inherit",
  });
  expect(await proc.stdout.json()).toEqual(["threw ERR_INVALID_STATE", "end", "hello world"]);
  expect(await proc.exited).toBe(0);
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

// unref() drops stdin's hold on the event loop and ref() takes it back: after
// the pair the child has nothing else pending and must still receive every
// later byte up to EOF.
test.concurrent("stdin.ref() after unref() keeps the process alive until EOF", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let total = 0;
      process.stdin.on("data", chunk => {
        if (total === 0) {
          process.stdin.unref();
          process.stdin.ref();
          process.stdout.write("ready\\n");
        }
        total += chunk.length;
      });
      process.stdin.on("end", () => {
        process.stdout.write("TOTAL " + total + "\\n");
      });
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  proc.stdin.write("x");
  while (!stdout.includes("ready\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value);
  }
  // The child is idle again with only stdin to wait for; these bytes must still reach it.
  const rest = Buffer.alloc(64 * 1024, "y");
  proc.stdin.write(rest);
  await proc.stdin.end();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value);
  }
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`ready\nTOTAL ${1 + rest.length}\n`);
  expect(exitCode).toBe(0);
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
  for (let r; !(r = await reader.read()).done;) {
    stdout += decoder.decode(r.value, { stream: true });
    if (stdout.includes("GOT1")) break;
  }
  proc.stdin.write("two");
  await proc.stdin.end();
  for (let r; !(r = await reader.read()).done;) stdout += decoder.decode(r.value, { stream: true });

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

// The native FileReader source over a pollable pipe used to drain the fd to
// EAGAIN regardless of JS demand, so an idle consumer still ingested the whole
// pipe into an internal buffer. The kernel pipe buffer filling up is the
// backpressure signal; these tests feed far more than that and check the
// child's resident set does not grow to match.
describe("pipe backpressure", () => {
  const feedMB = 40;
  // With no backpressure the child buffers the whole feed (Vec growth roughly
  // doubles that in RSS). With backpressure only the highwater mark plus the
  // kernel pipe buffer are resident in the child.
  const maxDeltaMB = isASAN || isDebug ? 24 : 16;

  async function run(consumer: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", consumer],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    // The child exits under backpressure having accepted only a few KB, so
    // the queued writes here fail with EPIPE; that is the expected outcome.
    const chunk = Buffer.alloc(1024 * 1024, 0x78);
    const ignoreEpipe = (e: any) => {
      if (e?.code !== "EPIPE") throw e;
    };
    for (let i = 0; i < feedMB; i++) {
      const r = proc.stdin.write(chunk);
      if (r && typeof (r as any).then === "function") (r as Promise<number>).catch(ignoreEpipe);
    }
    Promise.resolve(proc.stdin.flush()).catch(ignoreEpipe);
    Promise.resolve(proc.stdin.end()).catch(ignoreEpipe);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(exitCode).toBe(0);
    return result;
  }

  test.concurrent("Bun.stdin.stream(): a single read does not ingest the whole pipe", async () => {
    const { first, deltaMB } = await run(`
      const rss = process.memoryUsage.rss;
      const rd = Bun.stdin.stream().getReader();
      const c = await rd.read();
      const base = rss();
      // Give the event loop time to (incorrectly) drain the pipe. The loop is
      // native (no JS on the no-pending path), so debug/ASAN overhead is small.
      await new Promise(r => setTimeout(r, 1500));
      const deltaMB = Math.round((rss() - base) / 1048576);
      process.stdout.write(JSON.stringify({ first: c.value?.length ?? 0, deltaMB }));
      process.exit(0);
    `);
    expect(first).toBeGreaterThan(0);
    expect(deltaMB).toBeLessThan(maxDeltaMB);
  });

  test.concurrent("process.stdin.pause() stops the fd from being read", async () => {
    const { bytesAfter, deltaMB } = await run(`
      const rss = process.memoryUsage.rss;
      let bytes = 0, pausedAt = 0;
      process.stdin.on("data", chunk => {
        bytes += chunk.length;
        if (!pausedAt && bytes >= 1 << 20) {
          pausedAt = bytes;
          process.stdin.pause();
          const base = rss();
          setTimeout(() => {
            const deltaMB = Math.round((rss() - base) / 1048576);
            process.stdout.write(JSON.stringify({ bytesAtPause: pausedAt, bytesAfter: bytes, deltaMB }));
            process.exit(0);
          }, 1500);
        }
      });
    `);
    expect(bytesAfter).toBeLessThan(feedMB * 1024 * 1024);
    expect(deltaMB).toBeLessThan(maxDeltaMB);
  });

  // Stopped at the backstop, the reader's one-shot poll is left unarmed until
  // the next read, so it can observe nothing (not even the writer going away)
  // and must not keep the event loop alive on its own. Node behaves the same:
  // readStop() at the highWaterMark leaves the handle inactive.
  test.concurrent("a reader stopped at the highwater backstop does not keep the process alive", async () => {
    const { first } = await run(`
      const rd = Bun.stdin.stream().getReader();
      const c = await rd.read();
      process.stdout.write(JSON.stringify({ first: (c.value?.length ?? 0) > 0 }));
      // No further read and no exit(): once the backstop engages nothing is pending.
    `);
    expect(first).toBe(true);
  });

  // The same over an anonymous pipe (the blocking-pipe read path; Bun.spawn
  // stdio above is a socketpair). The writer keeps the pipe full until the
  // reader is gone, so EOF can never be what lets the reader exit.
  test.concurrent("over a shell pipe, a reader stopped at the backstop does not keep the process alive", async () => {
    using dir = tempDir("stdin-backstop-pipe", {
      "writer.js": `
        const chunk = Buffer.alloc(65536, 0x78);
        process.stdout.on("error", () => process.exit(0));
        (function pump() {
          while (process.stdout.write(chunk)) {}
          process.stdout.once("drain", pump);
        })();
      `,
      "reader.js": `
        const reader = Bun.stdin.stream().getReader();
        const { value } = await reader.read();
        process.on("exit", () => console.log("EXIT"));
        console.log("FIRST " + (value.byteLength > 0));
      `,
    });
    const { promise, resolve } = Promise.withResolvers<{ err: Error | null; stdout: string; stderr: string }>();
    exec(
      `"${bunExe()}" writer.js | "${bunExe()}" reader.js`,
      { cwd: String(dir), env: bunEnv },
      (err, stdout, stderr) => resolve({ err, stdout, stderr }),
    );
    expect(await promise).toEqual({ err: null, stdout: "FIRST true\nEXIT\n", stderr: "" });
  });

  // Stopping unregisters a fired one-shot poll without a syscall, which leaves
  // its disarmed registration in the kernel. Cancelling the stream must still
  // take it out: fd 0 stays open, and the next poll on it would hit EEXIST.
  test.concurrent("a reader cancelled at the highwater backstop frees fd 0 for the next reader", async () => {
    const { second } = await run(`
      const { getEventLoopStats } = require("bun:internal-for-testing");
      // Not top-level await: an unsettled entry-module promise would keep the process alive by itself.
      (async () => {
        const reader = Bun.stdin.stream().getReader();
        await reader.read();
        // The parent keeps the pipe full, so the reader soon stops and lets go of the loop.
        while (getEventLoopStats().loopActive) await new Promise(resolve => setImmediate(resolve));
        await reader.cancel();
        const next = await Bun.file(0).stream().getReader().read();
        process.stdout.write(JSON.stringify({ second: (next.value?.length ?? 0) > 0 }));
        process.exit(0);
      })();
    `);
    expect(second).toBe(true);
  });

  test.concurrent("reading resumes after the highwater backstop", async () => {
    // Stop reading long enough for the backstop to engage, then drain to EOF
    // and make sure every byte written by the parent is delivered.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const rd = Bun.stdin.stream().getReader();
        await rd.read().then(c => { globalThis.total = c.value?.length ?? 0; });
        await new Promise(r => setTimeout(r, 200));
        while (true) {
          const { value, done } = await rd.read();
          if (value) total += value.length;
          if (done) break;
        }
        process.stdout.write(String(total));
        `,
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const chunk = Buffer.alloc(64 * 1024, 0x79);
    const n = 64;
    for (let i = 0; i < n; i++) proc.stdin.write(chunk);
    await proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(String(n * chunk.length));
    expect(exitCode).toBe(0);
  });
});

test("process.stdin over an anonymous pipe delivers each byte exactly once", async () => {
  const total = 10 * 1024 * 1024;
  using dir = tempDir("stdin-pipe-exactly-once", {
    "writer.js": `const chunk = Buffer.alloc(65536); let left = ${total}; (function pump() { while (left > 0) { left -= chunk.length; if (!process.stdout.write(chunk)) return process.stdout.once("drain", pump); } })();`,
    "reader.js": `const h = new Bun.CryptoHasher("sha1"); let n = 0; process.stdin.on("data", d => { n += d.length; h.update(d); }); process.stdin.on("close", () => process.stdout.write(n + " " + h.digest("hex")));`,
  });
  const { promise, resolve } = Promise.withResolvers<{ err: Error | null; stdout: string; stderr: string }>();
  exec(`"${bunExe()}" writer.js | "${bunExe()}" reader.js`, { cwd: String(dir), env: bunEnv }, (err, stdout, stderr) =>
    resolve({ err, stdout, stderr }),
  );
  const { err, stdout, stderr } = await promise;
  expect(stderr).toBe("");
  const expected = new Bun.CryptoHasher("sha1").update(Buffer.alloc(total)).digest("hex");
  expect(stdout).toBe(`${total} ${expected}`);
  expect(err).toBeNull();
});
