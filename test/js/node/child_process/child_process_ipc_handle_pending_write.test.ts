import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

// send(message, socket) on a net.Socket that still has writes queued. The handle stays with the
// sender until the receiver acks, and keeps sending the chunk it already holds ("in flight"); the
// chunks behind it ("queued") are still in the stream. Each case is one handoff in the sender
// fixture, and its log is what the sender's socket reported, in order. The receiver acks when the
// sender tells it to, so both orders are exact: the ack closes the handle first, or the peer reads
// the chunk in flight first.
//
// Node v26.3.0 prints the same as `expected` for every case but the last two, where it never closes
// the handle.
const sender = join(import.meta.dir, "fixtures", "child-process-sent-socket-sender.js");
const receiver = join(import.meta.dir, "fixtures", "child-process-sent-socket-receiver.js");

const settled = { errorObjects: 1, writableLength: 0, destroyed: true };
const canceled = ["in flight: write ECANCELED", "queued: write ECANCELED"];
const closesFirst = {
  plain: { log: ["send callback", ...canceled, "error: write ECANCELED", "close"], ...settled },
  destroy: { log: ["close", "send callback", ...canceled], ...settled },
  end: { log: ["send callback", ...canceled, "error: write ECANCELED", "close"], ...settled },
};
const flushesFirst = {
  plain: {
    log: ["drain", "in flight: ok", "queued: ERR_SOCKET_CLOSED", "error: ERR_SOCKET_CLOSED", "close"],
    ...settled,
  },
  destroy: { log: ["close", "in flight: ok", "queued: ERR_STREAM_DESTROYED"], ...settled },
  end: { log: ["in flight: ok", "queued: ERR_SOCKET_CLOSED", "error: ERR_SOCKET_CLOSED", "close"], ...settled },
};
const reset = {
  log: [
    "in flight: write EPIPE|ECONNRESET",
    "queued: write EPIPE|ECONNRESET",
    "error: write EPIPE|ECONNRESET",
    "close",
  ],
  ...settled,
};
const open = { errorObjects: 0, writableLength: 0, destroyed: false };

const expected: Record<string, unknown> = {};
// The three kinds of net.Socket handle: accepted by a server, dialed, and received over a channel.
for (const origin of ["accepted", "dialed", "adopted"]) {
  // What the sender does with the socket right after send().
  for (const act of ["plain", "destroy", "end"] as const) {
    expected[`${origin}, ${act}, closes first`] = closesFirst[act];
    expected[`${origin}, ${act}, flushes first`] = flushesFirst[act];
  }
}
Object.assign(expected, {
  "accepted, end first, closes first": closesFirst.end,
  "accepted, end first, flushes first": flushesFirst.end,
  "tcp, flushes first": flushesFirst.plain,
  "nothing queued": { log: [], ...open },
  // Nothing is queued behind the chunk in flight: the socket only lost its handle.
  "one write in flight, flushes first": { log: ["drain", "in flight: ok"], ...open },
  "keepOpen": { log: ["drain", "in flight: ok", "queued: ok"], ...open },
  "tcp, the peer resets before the ack": reset,
  "tcp, the peer ends and then resets before the ack": reset,
  "the peer ends before the ack": { log: [...canceled, "error: write ECANCELED", "close"], ...settled },
  "sent from its own 'connect' listener": {
    log: ["in flight: write ECANCELED", "error: write ECANCELED", "close"],
    ...settled,
  },
  "a sent socket dials again": { newPeerGot: "x" },
  // A handle that was not sent, or whose ack cannot come, closes too. Node leaves these writes pending.
  "send() throws": { threw: true, ranInsideSend: 0, log: [...canceled, "error: write ECANCELED", "close"], ...settled },
  "the receiver dies before the ack": { log: [...canceled, "error: write ECANCELED", "close"], ...settled },
});

function resultsByCase(stdout: string) {
  const lines = stdout.split("\n").filter(line => line.startsWith("{"));
  return Object.fromEntries(lines.map(line => (({ name, ...result }) => [name, result])(JSON.parse(line))));
}

// Unix sockets and descriptor passing.
describe.skipIf(isWindows)("send(message, socket) with writes still queued", () => {
  // 31 handoffs in one tree of processes.
  test("child.send(): the sender's socket settles every write, as in node", async () => {
    using dir = tempDir("ipc-sent-socket", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), sender],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ results: resultsByCase(stdout), stderr }).toEqual({ results: expected, stderr: "" });
    expect(exitCode).toBe(0);
  }, 30_000);

  test("process.send(): the same from a child to its parent", async () => {
    const cases = ["accepted, plain, closes first", "accepted, plain, flushes first"];
    using dir = tempDir("ipc-sent-socket-child", {});
    // The receiver is the parent here. It acks when the sender, its child, prints "ack".
    await using proc = Bun.spawn({
      cmd: [bunExe(), receiver, ...cases],
      env: bunEnv,
      cwd: String(dir),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = proc.stderr.text();
    const decoder = new TextDecoder();
    let stdout = "";
    let told = 0;
    for await (const chunk of proc.stdout) {
      stdout += decoder.decode(chunk, { stream: true });
      const asked = stdout.split("\n").filter(line => line === "ack").length;
      for (; told < asked; told++) proc.stdin.write("x");
      proc.stdin.flush();
    }
    expect({ results: resultsByCase(stdout), stderr: await stderr }).toEqual({
      results: { [cases[0]]: closesFirst.plain, [cases[1]]: flushesFirst.plain },
      stderr: "",
    });
    expect(await proc.exited).toBe(0);
  });
});
