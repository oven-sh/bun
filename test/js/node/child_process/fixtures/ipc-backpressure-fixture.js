// Regression test for https://github.com/oven-sh/bun/issues/30569
// The child floods the parent with advanced-serialized messages. Each
// message carries a 64 KiB buffer, so the kernel's send buffer fills
// quickly and `process.send()` should return `false` within a handful of
// iterations (Node's threshold is 128 KiB of userspace-queued bytes).
// When that happens the drain callback is what lets the child exit —
// otherwise the channel would stay ref'd.

const { fork } = require("child_process");

if (process.argv[2] === "child") {
  if (process.channel) process.channel.ref();

  let pending = 0;
  let falseCount = 0;
  let maxCount = 0;
  const drain = () => {
    if (--pending === 0) {
      console.log(`drained maxCount=${maxCount} falseReturns=${falseCount}`);
      if (process.channel) process.channel.unref();
    }
  };

  const filler = Buffer.alloc(64 * 1024, 1);

  let count = 0;
  let ok;
  // Hard upper bound guards against the broken behaviour: if backpressure
  // never triggers, we bail out so the test fails instead of hanging.
  const LIMIT = 10_000;
  do {
    pending++;
    ok = process.send({ count: ++count, filler }, drain);
    if (!ok) falseCount++;
    maxCount = count;
  } while (ok && count < LIMIT);

  if (ok) {
    console.log(`NEVER_BACKPRESSURED count=${count}`);
    if (process.channel) process.channel.unref();
  } else {
    console.log(`firstFalseAt=${count}`);
  }
  return;
}

const child = fork(__filename, ["child"], {
  serialization: "advanced",
  // Inherit stdout so the child's console.log reaches the parent harness.
  stdio: ["pipe", "inherit", "inherit", "ipc"],
});

let received = 0;
child.on("message", () => {
  received++;
});

// 'close' fires after all stdio + the IPC channel have drained, so every
// queued 'message' has been emitted by then. 'exit' fires as soon as the
// child process terminates — in-flight kernel-buffered messages may still
// be unread, making `received` an undercount if we read it there.
child.on("close", (code, signal) => {
  console.log(`parent received=${received} exit=${code} signal=${signal}`);
});
