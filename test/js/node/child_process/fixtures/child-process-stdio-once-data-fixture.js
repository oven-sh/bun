// Prints what a consumer that takes one event at a time gets from a child's stdio stream: one JSON object, with an entry
// for each `<stream>:<form>[:<variant>]` argument. Node prints the same object for `stdout` and `stderr`, but for `first`.
//
// usage: <runtime> child-process-stdio-once-data-fixture.js <empty scratch dir> <stream>:<form>[:<variant>]...
//
// stream:
//   stdout, stderr   of a node:child_process child
//   web              Readable.fromWeb() over the stdout of Bun.spawn()
//   stdin            Readable.fromWeb(Bun.stdin.stream()) in a second process of this file, behind a shell pipe: a
//                    blocking pipe, which holds 64 KiB. Only the loops below, with parts that fit it.
//   reader           the reader of the web stream itself: see `late`
//
// The child writes its output in parts, and each part when the consumer asks for it. The consumer asks from inside a
// listener and blocks there until the part is in the pipe, so what the next read finds does not depend on timing.
//
// form: a loop of `await once(stream, "data")`, and what it does between two `once()` calls
//   job       nothing: the stream has no 'data' listener for the length of one promise job
//   tick      it awaits a promise that a nextTick settles
//   pause     pause(), the same await, resume()
//   text      as pause, on a stream with setEncoding("utf8") and a tail of 3-byte characters: the stream counts
//             characters, so one read of 64 KiB does not fill its highWaterMark
//   beside    as tick, beside a 'data' listener that stays, as exec() and execFile() have one
//   race      nothing, and each once("data") races a new once("end"): 'end' has no listener either for that job
// The child writes a head when the first read waits, and a tail of 96 KiB and the EOF while the listeners of the last
// byte of the head run. The tail does not fit one read of 64 KiB. The head is 4 bytes: the read that takes it finds
// the pipe empty after it. With the variant `full` the head is 132 KiB, which is more than half of the buffer that Bun
// reads a pipe into (`PIPE_READ_BUFFER_SIZE`): that read ends with no sign that the pipe is empty. For `stdin` a full
// head is 64 KiB, all that one read of a blocking pipe takes. `first` is the length of the first chunk: Bun hands over
// the head in one chunk, Node in chunks of 64 KiB. `pushedInsideRead` counts the chunks that the stream pushed while
// its `_read()` was on the stack, after its first read.
// or
//   readable  a 'readable' listener that takes all that is buffered with read(n), so read() returns null only at the
//             end. The head is 64 KiB, which fills the buffer of the stream, and the child holds the pipe open until
//             the listener has every byte: nothing but a 'readable' event tells it of the tail.
//   later     as readable, with a head of 132 KiB and a tail of 4 KiB, and the listener takes the head from a
//             setImmediate callback: the stream has stopped its reader by then, and the tail is in the pipe.
//   order     a 'data' listener that pauses the stream at the head. 64 KiB fill its buffer, more bytes come while it
//             is paused, a setImmediate callback resumes it, and the last bytes come while the listener of the first
//             chunk after that runs.
//   throw     a 'data' listener that throws at the head: `uncaught` is what an 'uncaughtException' listener got. With
//             the variant `second` it throws at the second chunk, which is in the pipe when it returns from the first.
// or, on Linux, a consumer of a child that is gone: it waits until the child is a zombie, so the last bytes, the EOF
// and the child's exit are all due when the event loop goes on. `atExit` is what it has when the exit is reported:
// at 'exit', or for `web` and `reader` when `exited` is settled.
//   exit      a 'data' listener that stays. With the variant `full`, `after` has the lengths of the chunks after the
//             head.
//   late      as exit, but the stream is paused and has stopped its reader at a full buffer when the child writes its
//             last bytes and goes. It is resumed after that. For `reader`: it reads the head and then nothing while
//             two parts of 64 KiB come, so its source has stopped too, and then it reads to the end.
//   iterate   `for await`: `closedInLoop` says that the child's 'close' came before the loop was done
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const KiB = 1024;

const sleeper = new Int32Array(new SharedArrayBuffer(4));
// Blocks the event loop, so that nothing is read or delivered until `file` exists.
function waitFor(file) {
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${file}`);
    Atomics.wait(sleeper, 0, 0, 1);
  }
}

// With this set a thread of Bun waits for the children. It reaps a child while the event loop is blocked, and then
// reports the exit to the loop.
const reapedByThread = process.env.BUN_FEATURE_FLAG_FORCE_WAITER_THREAD === "1";

// Blocks the event loop until the child has exited: until it is a zombie, or until that thread has reaped it.
function waitForExit(pid) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    let stat;
    try {
      stat = fs.readFileSync(`/proc/${pid}/stat`, "latin1");
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ESRCH") return;
      throw error;
    }
    // "<pid> (<name>) <state> ...": Z is a zombie.
    if (!reapedByThread && stat[stat.lastIndexOf(")") + 2] === "Z") return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for the exit of ${pid}`);
    Atomics.wait(sleeper, 0, 0, 1);
  }
}

function partsOf(which, form, variant) {
  if (which === "stdin") {
    const head = Buffer.alloc(variant === "full" ? 64 * KiB : 4, "h");
    if (form === "text") return [head, Buffer.from(Buffer.alloc(20_000 * 3, "€").toString())];
    return [head, Buffer.alloc(60_000, "t")];
  }
  if (which === "reader") {
    return [
      Buffer.alloc(4, "h"),
      Buffer.alloc(64 * KiB, "a"),
      Buffer.alloc(64 * KiB, "b"),
      Buffer.alloc(32 * KiB, "t"),
    ];
  }
  if (form === "readable") return [Buffer.alloc(64 * KiB, "h"), Buffer.alloc(96 * KiB, "t")];
  if (form === "later") return [Buffer.alloc(132 * KiB, "h"), Buffer.alloc(4 * KiB, "t")];
  if (form === "late") return [Buffer.alloc(4, "h"), Buffer.alloc(64 * KiB, "f"), Buffer.alloc(32 * KiB, "t")];
  if (form === "order") {
    return [Buffer.alloc(4, "h"), Buffer.alloc(64 * KiB, "a"), Buffer.alloc(1000, "b"), Buffer.alloc(1000, "c")];
  }
  const head = Buffer.alloc(variant === "full" ? 132 * KiB : 4, "h");
  if (form === "text") return [head, Buffer.from(Buffer.alloc(32 * KiB * 3, "€").toString())];
  if (variant === "second") return [head, Buffer.alloc(1000, "m"), Buffer.alloc(96 * KiB, "t")];
  return [head, Buffer.alloc(96 * KiB, "t")];
}

// `behindPipe`: this process is the second one of a `stdin` consumer. The first one started the producer.
async function consume(consumer, dir, behindPipe) {
  const [which, form, variant] = consumer.split(":");
  const fd = which === "stderr" ? 2 : 1;
  const parts = partsOf(which, form, variant);
  const last = parts.length - 1;
  let child, proc, stream, closed, consumed;
  if (behindPipe) {
    stream = Readable.fromWeb(Bun.stdin.stream());
    closed = once(stream, "close").then(() => []);
  } else {
    parts.forEach((part, i) => fs.writeFileSync(path.join(dir, `part${i}.bin`), part));
    // A shell script, so that the child starts in a few milliseconds. `$0` is the scratch directory and fd 3 the pipe.
    // dd makes one write() of each part: a socket holds fewer bytes when they come in small writes.
    // wait_for gives up when this process is gone, so that a run that fails leaves no process behind.
    const producer = `
      cd "$0"
      exec 3>&${fd} ${fd}>/dev/null
      wait_for() { until [ -e "$1" ]; do kill -0 ${process.pid} 2>/dev/null || exit 1; sleep 0.01; done; }
      ${parts
        .map((part, i) => {
          const write = `wait_for part${i}.go; dd if=part${i}.bin bs=${part.length} count=1 2>/dev/null >&3`;
          if (i < last) return `${write}; : > part${i}.done`;
          if (form === "readable" || form === "later") return `${write}; : > part${i}.done; wait_for close.go`;
          return `${write}; exec 3>&-; : > part${i}.done`;
        })
        .join("\n      ")}
    `;
    const stdio = ["ignore", "ignore", "ignore"];
    stdio[fd] = "pipe";
    if (which === "stdin") {
      // `$0` is this Bun, `$1` the producer, `$2` its scratch directory, `$3` this file and `$4` the consumer.
      const pipeline = Bun.spawn({
        cmd: [
          "sh",
          "-c",
          `sh -c "$1" "$2" | "$0" "$3" --behind-pipe "$2" "$4"`,
          process.execPath,
          producer,
          dir,
          __filename,
          consumer,
        ],
        stdio: ["ignore", "pipe", "inherit"],
      });
      const [result, exitCode] = await Promise.all([new Response(pipeline.stdout).json(), pipeline.exited]);
      return { exitCode, ...result };
    }
    if (which === "web" || which === "reader") {
      proc = Bun.spawn({ cmd: ["sh", "-c", producer, dir], stdio });
      if (which === "web") {
        stream = Readable.fromWeb(proc.stdout);
        closed = Promise.all([proc.exited, once(stream, "close")]);
      } else {
        closed = proc.exited.then(exitCode => [exitCode]);
      }
    } else {
      child = spawn("sh", ["-c", producer, dir], { stdio });
      stream = child.stdio[fd];
      closed = once(child, "close");
    }
  }
  const pid = (proc ?? child)?.pid;
  // Calls `listener` when the exit of the child is reported.
  const onExit = listener => (proc ? proc.exited.then(listener) : child.on("exit", listener));

  // Returns when part `i` is in the pipe. After the last part so is the EOF, but for 'readable' and 'later'.
  function write(i) {
    fs.writeFileSync(path.join(dir, `part${i}.go`), "");
    waitFor(path.join(dir, `part${i}.done`));
  }

  const chunks = [];
  const extra = {};
  let sawEnd = false;
  if (which === "reader") {
    const reader = proc.stdout.getReader();
    onExit(() => {
      extra.atExit = Buffer.concat(chunks).length;
    });
    // A turn of the event loop: the poll callback of the pipe has read what was in it.
    const turn = () => new Promise(resolve => setImmediate(resolve));
    // The first read waits when the head comes.
    setImmediate(write, 0);
    consumed = (async () => {
      chunks.push(Buffer.from((await reader.read()).value));
      for (const i of [1, 2]) {
        write(i);
        await turn();
        await turn();
      }
      write(3);
      waitForExit(pid);
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
      sawEnd = true;
    })();
  } else if (form === "exit" || form === "late") {
    // 'resume' comes when the first read has found the pipe empty and waits.
    stream.once("resume", () => write(0));
    stream.on("data", chunk => {
      chunks.push(chunk);
      if (chunks.length > 1) return;
      if (form === "exit") {
        write(1);
        waitForExit(pid);
        return;
      }
      stream.pause();
      write(1);
      // The paused stream reads until its buffer is full and then stops its reader: nothing waits for the pipe when
      // the last part comes.
      setImmediate(function whenStopped() {
        if (stream.readableLength < parts[1].length) return void setImmediate(whenStopped);
        write(2);
        waitForExit(pid);
        stream.resume();
      });
    });
    stream.on("end", () => {
      sawEnd = true;
    });
    onExit(() => {
      extra.atExit = Buffer.concat(chunks).length;
    });
  } else if (form === "iterate") {
    // The stream's first read was issued in a nextTick: it has found the pipe empty and waits.
    setImmediate(write, 0);
    let closed = false;
    child.on("close", () => {
      closed = true;
    });
    consumed = (async () => {
      for await (const chunk of stream) {
        if (chunks.length === 0) {
          write(1);
          waitForExit(pid);
        }
        chunks.push(chunk);
      }
      sawEnd = true;
      extra.closedInLoop = closed;
    })();
  } else if (form === "readable" || form === "later") {
    // The stream's first read was issued in a nextTick: it has found the pipe empty and waits.
    setImmediate(write, 0);
    let length = 0;
    const take = () => {
      // At the end. A ChildProcess resumes its streams when the child exits, `web` has nothing like it: this read()
      // brings 'end'.
      if (stream.readableLength === 0) return void stream.read();
      const chunk = stream.read(stream.readableLength);
      chunks.push(chunk);
      length += chunk.length;
      if (length === parts[0].length + parts[1].length) fs.writeFileSync(path.join(dir, "close.go"), "");
    };
    let asked = false;
    stream.on("readable", () => {
      if (!asked) {
        asked = true;
        write(1);
        if (form === "later") return void setImmediate(take);
      }
      take();
    });
    stream.on("end", () => {
      sawEnd = true;
    });
  } else if (form === "order") {
    stream.once("resume", () => write(0));
    stream.on("data", chunk => {
      chunks.push(chunk);
      if (chunks.length === 1) {
        stream.pause();
        write(1);
        setImmediate(() => {
          write(2);
          setImmediate(() => stream.resume());
        });
      } else if (chunks.length === 2) {
        write(3);
      }
    });
    stream.on("end", () => {
      sawEnd = true;
    });
  } else if (form === "throw") {
    process.once("uncaughtException", error => {
      extra.uncaught = error.message;
    });
    const throwAt = variant === "second" ? 2 : 1;
    stream.once("resume", () => write(0));
    stream.on("data", chunk => {
      chunks.push(chunk);
      if (chunks.length > throwAt) return;
      write(chunks.length);
      if (chunks.length === throwAt) throw new Error("thrown by the 'data' listener");
    });
    stream.on("end", () => {
      sawEnd = true;
    });
  } else {
    let reads = 0;
    let depth = 0;
    extra.pushedInsideRead = 0;
    const read = stream._read;
    stream._read = function (size) {
      reads++;
      depth++;
      try {
        return read.call(this, size);
      } finally {
        depth--;
      }
    };
    const push = stream.push;
    stream.push = function (chunk, encoding) {
      if (chunk !== null && depth > 0 && reads > 1) extra.pushedInsideRead++;
      return push.call(this, chunk, encoding);
    };
    if (form === "text") stream.setEncoding("utf8");
    if (form === "beside") stream.on("data", () => {});
    // 'resume' comes when the first read has found the pipe empty and waits.
    stream.once("resume", () => write(0));
    // Asks for the tail with the chunk that ends the head, before the loop below continues. Bun gets the head in one
    // chunk. Node gets a head of 132 KiB in three. The head has one byte for each character.
    let left = parts[0].length;
    stream.on("data", function head(chunk) {
      left -= chunk.length;
      if (left > 0) return;
      stream.off("data", head);
      write(1);
    });
    const end = () =>
      once(stream, "end").then(() => {
        sawEnd = true;
        return null;
      });
    const ended = end();
    (async () => {
      for (;;) {
        const next = await Promise.race([once(stream, "data"), form === "race" ? end() : ended]);
        if (next === null) break;
        chunks.push(Buffer.from(next[0]));
        extra.first ??= chunks[0].length;
        if (form === "pause" || form === "text") stream.pause();
        if (form !== "job" && form !== "race") await new Promise(resolve => process.nextTick(resolve));
        if (form === "pause" || form === "text") stream.resume();
      }
    })();
  }

  const [[exitCode]] = await Promise.all([closed, consumed]);
  const out = Buffer.concat(chunks);
  if (form === "exit" && variant === "full") extra.after = chunks.slice(1).map(chunk => chunk.length);
  return { exitCode, sawEnd, length: out.length, intact: out.equals(Buffer.concat(parts)), ...extra };
}

// A consumer that never gets its bytes waits for ever, and the test that ran this has timed out by then.
setTimeout(() => {
  console.error("child-process-stdio-once-data-fixture: no result after 30 s");
  process.exit(1);
}, 30_000).unref();

(async () => {
  const [root, ...consumers] = process.argv.slice(2);
  if (root === "--behind-pipe")
    return void console.log(JSON.stringify(await consume(consumers[1], consumers[0], true)));
  const results = Object.fromEntries(consumers.map(consumer => [consumer]));
  const behindPipes = [];
  for (const consumer of consumers) {
    const dir = path.join(root, consumer.replaceAll(":", "-"));
    fs.mkdirSync(dir);
    const result = consume(consumer, dir, false).then(result => {
      results[consumer] = result;
    });
    // Each `stdin` consumer is a process of its own: they run side by side.
    if (consumer.startsWith("stdin:")) behindPipes.push(result);
    else await result;
  }
  await Promise.all(behindPipes);
  console.log(JSON.stringify(results));
})();
