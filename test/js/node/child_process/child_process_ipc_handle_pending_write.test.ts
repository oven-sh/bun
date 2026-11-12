import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExeAtLeast, tempDir } from "harness";
import { join } from "node:path";

// send(message, socket) on a net.Socket that still has writes queued. The handle stays with the
// sender until the receiver acks, and keeps sending the chunk it already holds ("in flight"); the
// chunks behind it ("queued") are still in the stream. Each case is one handoff in the sender
// fixture, and its log is what the sender's socket reported, in order. The receiver acks when the
// sender tells it to, so both orders are exact: the ack closes the handle first, or the peer reads
// the chunk in flight first.
const sender = join(import.meta.dir, "fixtures", "child-process-sent-socket-sender.js");
const receiver = join(import.meta.dir, "fixtures", "child-process-sent-socket-receiver.js");

const settled = { errorObjects: 1, writableLength: 0, destroyed: true };
const open = { errorObjects: 0, writableLength: 0, destroyed: false };
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

// What the sender does with the socket right after send(), in both orders.
const matrix = (origin: string) =>
  Object.fromEntries(
    (["plain", "destroy", "end"] as const).flatMap(act => [
      [`${origin}, ${act}, closes first`, closesFirst[act]],
      [`${origin}, ${act}, flushes first`, flushesFirst[act]],
    ]),
  );

// One tree of processes for each group. The three kinds of net.Socket handle come first.
const groups: Record<string, Record<string, unknown>> = {
  "a socket that a server accepted": {
    ...matrix("accepted"),
    "accepted, end first, closes first": closesFirst.end,
    "accepted, end first, flushes first": flushesFirst.end,
    "nothing queued": { log: [], ...open },
    // Nothing is queued behind the chunk in flight: the socket only lost its handle.
    "one write in flight, flushes first": { log: ["drain", "in flight: ok"], ...open },
    "keepOpen": { log: ["drain", "in flight: ok", "queued: ok"], ...open },
  },
  "a socket that dialed": {
    ...matrix("dialed"),
    "tcp, flushes first": flushesFirst.plain,
    "sent from its own 'connect' listener": {
      log: ["in flight: write ECANCELED", "error: write ECANCELED", "close"],
      ...settled,
    },
    "a sent socket dials again": { newPeerGot: "x" },
    "a sent socket with a write in flight dials again": {
      log: ["connect", "in flight: write ECANCELED", "error: write ECANCELED", "close"],
      ...settled,
    },
  },
  "a socket that arrived over a channel": matrix("adopted"),
  "what the peer and the receiver do before the ack": {
    "tcp, the peer resets before the ack": reset,
    "tcp, the peer writes, ends and then resets before the ack": reset,
    "the peer ends before the ack": { log: [...canceled, "error: write ECANCELED", "close"], ...settled },
    "sent behind a handle that the receiver has not acked": closesFirst.plain,
    "the receiver gets what the peer wrote before the ack": {
      echoed: "before the ack, after it",
      log: [],
      ...open,
    },
    // The handle was not sent and stays open, so the writes stay where they are.
    "send() throws": { threw: true, log: [], errorObjects: 0, writableLength: 2, destroyed: false },
    "the receiver dies before the ack": { log: [...canceled, "error: write ECANCELED", "close"], ...settled },
  },
};

function resultsByCase(stdout: string) {
  const lines = stdout.split("\n").filter(line => line.startsWith("{"));
  return Object.fromEntries(lines.map(line => (({ name, ...result }) => [name, result])(JSON.parse(line))));
}

async function handoffs(exe: string, cases: string[]) {
  using dir = tempDir("ipc-sent-socket", {});
  await using proc = Bun.spawn({
    cmd: [exe, sender, ...cases],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { results: resultsByCase(stdout), stderr, exitCode };
}

// Unix sockets and descriptor passing. Not concurrent: each test starts a tree of processes.
describe.skipIf(isWindows)("send(message, socket) with writes still queued", () => {
  for (const [group, expected] of Object.entries(groups)) {
    test(`child.send(): ${group}`, async () => {
      expect(await handoffs(bunExe(), Object.keys(expected))).toEqual({ results: expected, stderr: "", exitCode: 0 });
    });
  }

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
    expect({ results: resultsByCase(stdout), stderr: await stderr, exitCode: await proc.exited }).toEqual({
      results: { [cases[0]]: closesFirst.plain, [cases[1]]: flushesFirst.plain },
      stderr: "",
      exitCode: 0,
    });
  });

  const node = nodeExeAtLeast("26.3.0");
  test.skipIf(!node)("node prints the same, with two exceptions", async () => {
    // Node never closes the handle of a receiver that died: that case does not run.
    const { "the receiver dies before the ack": _, ...expected } = Object.assign({}, ...Object.values(groups));
    // Node's handle reads on until the ack, and drops what it reads.
    expected["the receiver gets what the peer wrote before the ack"] = { echoed: "after it", log: [], ...open };
    expect(await handoffs(node!, Object.keys(expected))).toEqual({ results: expected, stderr: "", exitCode: 0 });
  });
});
