import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, fstatSync, readFileSync, writeSync } from "node:fs";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";

const [role, kind, fdArg, action] = process.argv.slice(2);
const fd = Number(fdArg);
const payload = Buffer.alloc(role === "timing" ? 0 : kind === "socket" && action !== "destroy" ? 1024 * 1024 : 7, "x");
const tail = Buffer.from("tail");

if (role === "timing") {
  const output = fd === 1 ? process.stdout : process.stderr;
  assert.equal(fstatSync(fd).isSocket(), true);
  setImmediate(() => assert.throws(() => writeSync(fd, "immediate"), { code: "EPIPE" }));
  const context = new AsyncLocalStorage();
  context.run("stdio", () => {
    output.end("before", () => {
      assert.equal(context.getStore(), "stdio");
      fstatSync(fd);
      assert.throws(() => writeSync(fd, "late"), { code: "EPIPE" });
      writeSync(fd === 1 ? 2 : 1, "ok\n");
    });
  });
  const write = () => writeSync(fd, "x");
  write();
  process.nextTick(write);
  queueMicrotask(write);
} else if (role === "child") {
  const output = fd === 1 ? process.stdout : process.stderr;
  output.on("error", () => {});
  const parentAck = once(process, "message");
  const written = new Promise((resolve, reject) => {
    const accepted = output.write(payload, err => (err ? reject(err) : resolve()));
    process.send({ event: "started", backpressure: !accepted });
  });
  if (action === "destroy") {
    await written;
    const closed = once(output, "close");
    output.destroy();
    await closed;
  } else if (action === "end") {
    const finished = once(output, "finish");
    output.end(tail);
    await finished;
  } else {
    const source = spawn(process.execPath, ["-e", "process.stdout.write('tail')"], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const sourceExit = once(source, "exit");
    try {
      await new Promise((resolve, reject) => pipeline(source.stdout, output, err => (err ? reject(err) : resolve())));
      assert.deepEqual(await sourceExit, [0, null]);
    } finally {
      if (source.exitCode === null) source.kill();
    }
  }
  await written;
  // Node's dummyDestroy resets the stream after finish. Probe the native write
  // state on the next turn, independently of Writable's in-progress end guard.
  await new Promise(resolve => setImmediate(resolve));
  const stat = fstatSync(fd);
  assert.equal(kind === "socket" ? stat.isSocket() : stat.isFIFO(), true);
  let rawError = null;
  try {
    writeSync(fd, "raw");
  } catch (err) {
    rawError = err.code;
  }
  const writeError = await new Promise(resolve => output.write("late", err => resolve(err?.code ?? null)));
  let vectorErrors;
  if (action !== "destroy") {
    output.cork();
    const writes = ["v1", "v2"].map(
      chunk => new Promise(resolve => output.write(chunk, err => resolve(err?.code ?? null))),
    );
    output.uncork();
    vectorErrors = await Promise.all(writes);
  }
  fstatSync(fd);
  process.send({ event: "checked", rawError, writeError, vectorErrors });
  await parentAck;
  process.disconnect();
} else {
  let pipeFds;
  let library;
  let child;
  let deadline;
  let acknowledged = false;
  try {
    if (kind === "pipe") {
      const { dlopen, ptr } = await import("bun:ffi");
      library = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
        pipe: { args: ["ptr"], returns: "int" },
      });
      pipeFds = new Int32Array([-1, -1]);
      assert.equal(library.symbols.pipe(ptr(pipeFds)), 0);
    }
    const stdio = ["ignore", "pipe", "pipe", "ipc"];
    if (pipeFds) stdio[fd] = pipeFds[1];
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), "child", kind, String(fd), action], { stdio });
    if (pipeFds) {
      closeSync(pipeFds[1]);
      pipeFds[1] = -1;
    }
    const failures = Promise.withResolvers();
    deadline = setTimeout(() => failures.reject(new Error("stdio did not complete while the child was alive")), 5000);
    const started = Promise.withResolvers();
    const checked = Promise.withResolvers();
    const ended = Promise.withResolvers();
    const exited = Promise.withResolvers();
    child.on("error", failures.reject);
    child.on("message", message => {
      if (message.event === "started") started.resolve(message);
      if (message.event === "checked") checked.resolve(message);
    });
    child.on("exit", (code, signal) => {
      if (!acknowledged) failures.reject(new Error(`child exited before acknowledgement: ${code}, ${signal}`));
      exited.resolve({ code, signal });
    });
    const chunks = [];
    const report = [];
    const dataStream = child.stdio[fd];
    const reportStream = child.stdio[fd === 1 ? 2 : 1];
    reportStream.on("data", chunk => report.push(chunk));
    reportStream.on("error", failures.reject);
    if (dataStream) {
      dataStream.pause();
      dataStream.on("data", chunk => chunks.push(chunk));
      dataStream.on("end", ended.resolve);
      dataStream.on("error", failures.reject);
    }
    const run = async () => {
      const initial = await started.promise;
      if (kind === "socket" && action !== "destroy") assert.equal(initial.backpressure, true);
      dataStream?.resume();
      const result = await checked.promise;
      assert.equal(result.rawError, kind === "socket" && action !== "destroy" ? "EPIPE" : null);
      assert.equal(result.writeError, action === "destroy" ? null : "EPIPE");
      if (action !== "destroy") assert.deepEqual(result.vectorErrors, ["EPIPE", "EPIPE"]);
      if (kind === "socket" && action !== "destroy") await ended.promise;
      assert.equal(child.exitCode, null);
      acknowledged = true;
      child.send("peer-observed");
      const exit = await exited.promise;
      if (dataStream) await ended.promise;
      const actual = pipeFds ? readFileSync(pipeFds[0]) : Buffer.concat(chunks);
      const expected = Buffer.concat([
        payload,
        ...(action === "destroy" ? [] : [tail]),
        ...(kind === "pipe" || action === "destroy" ? [Buffer.from("raw")] : []),
        ...(action === "destroy" ? [Buffer.from("late")] : []),
      ]);
      assert.deepEqual(actual, expected);
      assert.equal(Buffer.concat(report).toString(), "");
      assert.deepEqual(exit, { code: 0, signal: null });
    };
    await Promise.race([run(), failures.promise]);
    console.log("ok");
  } finally {
    clearTimeout(deadline);
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    if (pipeFds) for (const descriptor of pipeFds) if (descriptor >= 0) closeSync(descriptor);
    library?.close();
  }
}
