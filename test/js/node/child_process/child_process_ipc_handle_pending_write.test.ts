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
// The close of the handle cancels what it still holds, whatever closed it.
const closed = { log: [...canceled, "error: write ECANCELED", "close"], ...settled };

// What the sender does with the socket right after send(), in both orders.
const matrix = (origin: string) =>
  Object.fromEntries(
    (["plain", "destroy", "end"] as const).flatMap(act => [
      [`${origin}, ${act}, closes first`, closesFirst[act]],
      [`${origin}, ${act}, flushes first`, flushesFirst[act]],
    ]),
  );

// One tree of processes for each group: a debug build takes two seconds to start one. The first
// three are the kinds of net.Socket handle.
const groups: Record<string, Record<string, unknown>> = {
  "a socket that a server accepted": {
    ...matrix("accepted"),
    "accepted, end first, closes first": closesFirst.end,
    "accepted, end first, flushes first": flushesFirst.end,
  },
  "a socket that dialed": {
    ...matrix("dialed"),
    "tcp, flushes first": flushesFirst.plain,
  },
  "a socket that arrived over a channel": matrix("adopted"),
  "a connection of an http.Server": {
    "http.Server connection, closes first": closesFirst.plain,
    "http.Server connection, flushes first": flushesFirst.plain,
  },
  "less in the queue, kept open, sent from 'connect', dialed again": {
    "nothing queued": { log: [], ...open },
    // Nothing is queued behind the chunk in flight: the socket only lost its handle.
    "one write in flight, flushes first": { log: ["drain", "in flight: ok"], ...open },
    "keepOpen": { log: ["drain", "in flight: ok", "queued: ok"], ...open },
    "sent from its own 'connect' listener": {
      log: ["in flight: write ECANCELED", "error: write ECANCELED", "close"],
      ...settled,
    },
    "a sent socket dials again": { newPeerGot: "x" },
    "a sent socket with a write in flight dials again": {
      log: ["connect", "in flight: write ECANCELED", "error: write ECANCELED", "close"],
      ...settled,
    },
    "the receiver dies with the handle still in the channel's queue": closed,
  },
  "what the peer and the receiver do before the ack": {
    "tcp, the peer resets before the ack": closed,
    "tcp, the peer writes, ends and then resets before the ack": closed,
    "the peer ends before the ack": closed,
    "sent behind a handle that the receiver has not acked": closesFirst.plain,
    "the receiver gets what the peer wrote before the ack": {
      echoed: "before the ack, after it",
      log: [],
      ...open,
    },
    "the receiver dies before the ack": closed,
  },
};
// When the receiver is gone, the channel closes the handles it still holds. Node closes none, and
// the writes stay where they are: under node those two cases do not run.
const receiverDies = [
  "the receiver dies before the ack",
  "the receiver dies with the handle still in the channel's queue",
];

// Where node v26.3.0 prints another row.
const inNode = (() => {
  const reset = ["in flight", "queued", "error"].map(what => `${what}: write EPIPE|ECONNRESET`);
  return {
    // The write fails with the reset itself.
    "tcp, the peer resets before the ack": { log: [...reset, "close"], ...settled },
    "tcp, the peer writes, ends and then resets before the ack": { log: [...reset, "close"], ...settled },
    // The handle reads on until the ack, and drops what it reads.
    "the receiver gets what the peer wrote before the ack": { echoed: "after it", log: [], ...open },
  };
})();

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
    // The receiver waits for stdin with its loop stopped: it does not see its child die.
    const stderr = (async () => {
      let text = "";
      for await (const chunk of proc.stderr) {
        text += Buffer.from(chunk).toString();
        proc.kill();
      }
      return text;
    })();
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
  test.skipIf(!node)(`node prints the same but for ${Object.keys(inNode).length} rows`, async () => {
    const expected = Object.assign({}, ...Object.values(groups), inNode);
    for (const name of receiverDies) delete expected[name];
    expect(await handoffs(node!, Object.keys(expected))).toEqual({ results: expected, stderr: "", exitCode: 0 });
  });
});
