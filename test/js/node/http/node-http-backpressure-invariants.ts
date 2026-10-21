// Seeded plans of write(), _send(), end(), cork() and transport events against one ServerResponse, and the
// invariants that Node.js v26.3.0 keeps for every one of them:
//  1. A write() that returned false gets one 'drain' once the transport is empty, or a 'close'. No other 'drain' comes.
//  2. 'drain' comes with res.writableLength 0 and an empty socket, never after end() or after the socket was destroyed.
//  3. A write callback runs once, before 'finish'. One that reports no error runs after the socket took its chunk,
//     also when the socket is destroyed later. The callbacks run in order: only the callback of a chunk that the
//     socket took inside write() can come up to one tick late.
//  4. After a write(), a writableLength at or over the high water mark means that a 'drain' is owed.
//  5. writableNeedDrain is true right after a false, and false when no 'drain' is owed.
//  6. The body on the wire is the bytes that were written. After a teardown from a 'drain' listener or from a write
//     callback, it has the bytes that the event stood for.
// After the peer ended its side the server ends the socket: a later write goes nowhere, so only 'close' is required.
// node-http-backpressure.test.ts runs them on a stream given to server.emit('connection'), also under Node.js.
// node-http-syscall-fault.test.ts runs them on a listening server, with short sends in place of a slow client.
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import net from "node:net";
import { Duplex } from "node:stream";

type Step =
  | { op: "write"; size: number; cb: boolean; str: boolean; wait: boolean }
  | { op: "send"; size: number; cb: boolean }
  | { op: "budget" | "foreign"; n: number }
  // res.cork() now, res.uncork() behind the next `span` steps.
  | { op: "cork"; span: number }
  | { op: "turn" | "tick" | "release" | "releaseNow" | "flushHeaders" | "eof" };

export type Plan = {
  seed: number;
  hwm: number;
  chunked: boolean;
  version: "1.1" | "1.1 close" | "1.0";
  steps: Step[];
  // The bytes that the transport takes at once.
  budget: number;
  // Who destroys the socket: the plan or a reset of the peer at step `teardownAt`, the 'drain' listener, or a write callback.
  teardown: "socket" | "reset" | "drain" | "cb" | null;
  teardownAt: number;
  // The size of a write() that the first 'drain' listener makes.
  drainWrite: number;
  end: { size: number; cb: boolean } | null;
  // The response waits behind another one for its first `queuedSteps` steps.
  pipelined: boolean;
  queuedSteps: number;
  // Like a TLS socket: a write within the budget completes on the next tick, not inside write().
  onTick: boolean;
};

// What a plan needs from the connection under the response.
export type Transport = {
  start(server: Server, requests: string): void;
  // The request is in: from here on the budget applies.
  begin(): void;
  // The bytes that the socket holds, when the transport can tell.
  held(): number | null;
  pending(res: ServerResponse): boolean;
  // Lets the socket take one write that it holds.
  release(): boolean;
  budget(bytes: number): void;
  // Bytes of another writer on the same socket.
  foreign(bytes: number): boolean;
  destroy(res: ServerResponse): void;
  // The peer resets the connection. True when the socket is gone at once.
  reset(): boolean;
  // The peer ends its side. `ended` runs behind the 'end' listener of the server. False when the transport has no such step.
  eof(ended: () => void): boolean;
  // What the socket took so far, when the transport can tell at once.
  taken(): Buffer | null;
  wire(complete: (wire: Buffer) => boolean): Promise<Buffer>;
  stop(): void;
  // Turns without progress after which a plan counts as stalled.
  idleTurns: number;
  // False when the transport refuses a write under the high water mark that it cannot send at once.
  buffersUnderTheMark: boolean;
  // False when a 'drain' or a write callback can come before the bytes that it stands for are sent.
  signalsAfterSend: boolean;
  // True when a destroyed socket never runs the callbacks of the writes that it held. Node.js then never runs them either.
  forgetsHeldWrites: boolean;
};

type Fault = {
  set(rule: { syscall: string; action: string; bytes: number; repeat: number }): void;
  clear(): void;
};

function prng(seed: number) {
  let s = Math.imul((seed >>> 0) ^ ((seed >>> 0) >>> 16), 0x45d9f3b);
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
  s = (s ^ (s >>> 16)) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x1_0000_0000;
  };
}

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const tick = () => new Promise<void>(resolve => process.nextTick(resolve));
const BYTES = Buffer.alloc(2 * 65536 + 2, "a");
const TEXT = BYTES.toString("latin1");
// An upper bound of the chunked framing of one write.
const FRAME = 16;

export function makePlan(seed: number, native: boolean): Plan {
  const r = prng(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const hwm = pick([1024, 16384, 65536, 65536]);
  const sizes = [0, 1, hwm >> 3, hwm >> 2, (hwm >> 1) - 1, hwm >> 1, (hwm >> 1) + 1, hwm - 1, hwm, hwm + 1, 2 * hwm];
  let steps: Step[] = [];
  const count = 1 + Math.floor(r() * 10);
  for (let i = 0; i < count; i++) {
    const k = r();
    if (k < 0.48) steps.push({ op: "write", size: pick(sizes), cb: r() < 0.4, str: r() < 0.15, wait: r() < 0.5 });
    else if (k < 0.56) steps.push({ op: "send", size: pick([1, hwm >> 2, hwm]), cb: r() < 0.7 });
    else if (k < 0.65) steps.push({ op: "turn" });
    else if (k < 0.71) steps.push({ op: "tick" });
    else if (k < 0.77) steps.push({ op: "release" });
    else if (k < 0.81) steps.push({ op: "releaseNow" });
    else if (k < 0.88) steps.push({ op: "budget", n: pick([1, hwm >> 1, hwm, 4 * hwm]) });
    else if (k < 0.92) steps.push({ op: "foreign", n: pick([1, 100]) });
    else if (k < 0.95) steps.push({ op: "cork", span: Math.floor(r() * 4) });
    else if (k < 0.97) steps.push({ op: "eof" });
    else steps.push({ op: "flushHeaders" });
  }
  const chunked = r() < 0.5;
  const version = pick(["1.1", "1.1", "1.1", "1.1 close", "1.0"] as const);
  const budget = pick([0, 512, hwm >> 1, hwm + 1024, 8 * hwm, Infinity]);
  const teardown = r() < 0.15 ? pick(["socket", "reset", "drain", "cb"] as const) : null;
  const teardownAt = Math.floor(r() * count);
  const drainWrite = r() < 0.3 ? pick([1, hwm >> 1, hwm]) : 0;
  const end = r() < 0.85 ? { size: pick([0, 0, 1, hwm >> 1, hwm + 1]), cb: r() < 0.4 } : null;
  const pipelined = r() < 0.2 && version === "1.1";
  const queuedSteps = Math.floor(r() * 4);
  const onTick = r() < 0.3;
  // res._send() writes raw body bytes: not for a chunked body, and a queued response sends them ahead of its buffered writes.
  if (chunked || pipelined) steps = steps.filter(step => step.op !== "send");
  if (native) steps = steps.filter(step => step.op !== "foreign" && step.op !== "eof");
  return {
    seed,
    hwm,
    chunked,
    version,
    steps,
    budget,
    teardown,
    teardownAt,
    drainWrite,
    end,
    pipelined,
    queuedSteps,
    onTick,
  };
}

export function describePlan(plan: Plan) {
  const steps = plan.steps.map(step =>
    step.op === "write"
      ? `w${step.size}${step.cb ? "c" : ""}${step.str ? "s" : ""}${step.wait ? "!" : ""}`
      : step.op === "send"
        ? `S${step.size}${step.cb ? "c" : ""}`
        : step.op === "budget"
          ? `+${step.n}`
          : step.op === "foreign"
            ? `x${step.n}`
            : step.op === "cork"
              ? `cork${step.span}`
              : step.op,
  );
  return [
    `hwm=${plan.hwm}${plan.onTick ? " tick-socket" : ""}`,
    plan.chunked ? "chunked" : "length",
    `http=${plan.version}`,
    `budget=${plan.budget}`,
    plan.pipelined ? `pipelined(${plan.queuedSteps})` : "",
    plan.teardown ? `teardown=${plan.teardown}@${plan.teardownAt}` : "",
    plan.drainWrite ? `drainWrite=${plan.drainWrite}` : "",
    `end=${plan.end ? plan.end.size + (plan.end.cb ? "c" : "") : "none"}`,
    `[${steps.join(" ")}]`,
  ]
    .filter(Boolean)
    .join(" ");
}

// Takes `budget` bytes at once, like a kernel buffer with that much room, then holds every write until it is released.
class CapacitySocket extends Duplex {
  budget = 0;
  held: { chunk: Buffer; callback: (err?: Error | null) => void }[] = [];
  wire: Buffer[] = [];
  constructor(
    highWaterMark: number,
    private onTick: boolean,
    // Like Bun's net.Socket at a reset of the peer, and like readable-stream@3: the held writes are dropped.
    private forgets: boolean,
  ) {
    super({ highWaterMark });
  }
  _read() {}
  _write(chunk: Buffer, _encoding: string, callback: (err?: Error | null) => void) {
    if (this.held.length === 0 && this.budget >= chunk.length) {
      this.budget -= chunk.length;
      this.wire.push(chunk);
      if (this.onTick) process.nextTick(callback);
      else callback();
    } else {
      this.held.push({ chunk, callback });
    }
  }
  releaseOne() {
    const held = this.held.shift();
    if (!held) return false;
    this.wire.push(held.chunk);
    held.callback();
    return true;
  }
  _destroy(err: Error | null, callback: (err?: Error | null) => void) {
    for (const held of this.held.splice(0)) if (!this.forgets) held.callback(err ?? new Error("canceled"));
    callback(err);
  }
}

// A stream that the plan drives, given to server.emit('connection').
export function streamTransport(plan: Plan, forgetsHeldWrites = false): Transport {
  const socket = new CapacitySocket(plan.hwm, plan.onTick, forgetsHeldWrites);
  socket.on("error", () => {});
  socket.budget = plan.budget;
  return {
    start(server, requests) {
      server.emit("connection", socket);
      socket.push(requests);
    },
    begin() {},
    held: () => socket.writableLength,
    pending: () => socket.held.length > 0,
    release: () => socket.releaseOne(),
    budget: bytes => void (socket.budget += bytes),
    foreign(bytes) {
      if (socket.destroyed || socket.writableEnded) return false;
      socket.write(Buffer.alloc(bytes, "x"));
      return true;
    },
    destroy: () => void socket.destroy(),
    reset() {
      socket.destroy(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
      return true;
    },
    eof(ended) {
      socket.once("end", ended);
      socket.push(null);
      return true;
    },
    taken: () => Buffer.concat(socket.wire),
    wire: async () => Buffer.concat(socket.wire),
    stop() {
      if (!socket.destroyed) socket.destroy();
    },
    idleTurns: 6,
    buffersUnderTheMark: true,
    signalsAfterSend: true,
    forgetsHeldWrites,
  };
}

// A listening server and a client in this process. Short sends stand for the room in the kernel buffer.
// With `handOver`, a net.Server accepts the connection and gives its socket to server.emit('connection').
export function listenTransport(plan: Plan, fault: Fault, handOver = false): Transport {
  let client: net.Socket | undefined;
  let listening: net.Server | undefined;
  let accepted: net.Socket | undefined;
  const received: Buffer[] = [];
  const clamp = (bytes: number) => {
    fault.clear();
    if (bytes === Infinity) return;
    const short = Math.max(256, Math.min(bytes, 256 * 1024));
    fault.set({ syscall: "send", action: "short", bytes: short, repeat: -1 });
    fault.set({ syscall: "writev", action: "short", bytes: short, repeat: -1 });
  };
  return {
    start(server, requests) {
      const front = handOver ? net.createServer(socket => server.emit("connection", (accepted = socket))) : server;
      listening = front;
      front.listen(0, "127.0.0.1", () => {
        const socket = net.connect((front.address() as net.AddressInfo).port, "127.0.0.1", () =>
          socket.write(requests),
        );
        socket.on("data", chunk => received.push(chunk));
        socket.on("error", () => {});
        client = socket;
      });
    },
    // The rules are process-wide: they start once the request is in, so that only the response meets them.
    begin: () => clamp(plan.budget || 512),
    // What the stream holds in JS. The native handle does not say.
    held: () => accepted?.writableLength ?? null,
    pending: res => res.writableLength > 0 || (accepted?.writableLength ?? 0) > 0,
    release: () => false,
    budget: clamp,
    foreign: () => false,
    destroy: res => void res.req.socket.destroy(),
    reset() {
      client?.resetAndDestroy();
      return false;
    },
    eof(ended) {
      if (!accepted || !client) return false;
      accepted.once("end", ended);
      client.end();
      return true;
    },
    taken: () => null,
    async wire(complete) {
      fault.clear();
      let last = -1;
      for (let idle = 0; idle < 200; idle++) {
        const wire = Buffer.concat(received);
        if (complete(wire)) return wire;
        if (wire.length !== last) idle = 0;
        last = wire.length;
        await turn();
      }
      return Buffer.concat(received);
    },
    stop() {
      fault.clear();
      client?.destroy();
      accepted?.destroy();
      listening?.close();
      if (!handOver) (listening as Server | undefined)?.closeAllConnections();
    },
    idleTurns: 40,
    buffersUnderTheMark: handOver,
    // The cork of the loop holds the writes under 16 KiB outside of what the handle counts, so a 'drain' or a write callback can come before those bytes are sent. A stream has no such cork.
    signalsAfterSend: handOver,
    forgetsHeldWrites: false,
  };
}

// The number of body bytes on the wire, or what is wrong with it.
function bodyOnWire(wire: Buffer) {
  const headEnd = wire.indexOf("\r\n\r\n");
  if (headEnd < 0) return "no head on the wire";
  const head = wire.subarray(0, headEnd).toString("latin1").toLowerCase();
  let at = headEnd + 4;
  if (!head.includes("transfer-encoding: chunked")) return wire.length - at;
  let got = 0;
  for (;;) {
    const lineEnd = wire.indexOf("\r\n", at);
    if (lineEnd < 0) return "chunked body cut short on the wire";
    const size = parseInt(wire.subarray(at, lineEnd).toString("latin1"), 16);
    if (!(size >= 0)) return "bad chunk size on the wire";
    at = lineEnd + 2 + size + 2;
    if (at > wire.length) return "chunked body cut short on the wire";
    if (size === 0) break;
    got += size;
  }
  return at === wire.length ? got : `${wire.length - at} bytes behind the last chunk`;
}

// The body bytes of the response that the wire has so far: of a chunked body, the chunks that are complete.
// `heads` responses without a body are ahead of it on the wire.
function bodyTaken(wire: Buffer, heads: number) {
  let at = 0;
  let head = "";
  for (let i = 0; i <= heads; i++) {
    const headEnd = wire.indexOf("\r\n\r\n", at);
    if (headEnd < 0) return 0;
    head = wire.subarray(at, headEnd).toString("latin1").toLowerCase();
    at = headEnd + 4;
  }
  if (!head.includes("transfer-encoding: chunked")) return wire.length - at;
  let got = 0;
  for (;;) {
    const lineEnd = wire.indexOf("\r\n", at);
    if (lineEnd < 0) return got;
    const size = parseInt(wire.subarray(at, lineEnd).toString("latin1"), 16);
    at = lineEnd + 2 + size + 2;
    if (!(size > 0) || at > wire.length) return got;
    got += size;
  }
}

async function runPlan(
  res: ServerResponse,
  T: Transport,
  plan: Plan,
  violation: (message: string) => void,
  first: ServerResponse | null,
) {
  let owed = false;
  // Node.js owes no 'drain' for a false that only the chunks under a cork caused.
  let owedUnderCork = false;
  let closed = false;
  let finished = false;
  let ended = false;
  let tornDown = false;
  // The peer reset the connection, and the server does not know yet.
  let resetting = false;
  // The peer ended its side, so the server ended the socket: what the response writes from here on goes nowhere.
  let afterEof = false;
  let bodyAtEof = 0;
  let done = false;
  let foreign = false;
  let queued = first !== null;
  let drains = 0;
  let corked = 0;
  // A teardown under a cork: Node.js drops the callbacks of the chunks that the cork holds.
  let lossy = false;
  // An upper bound of the bytes handed to the transport behind the head.
  let handed = 0;
  let body = 0;
  // The body bytes that the 'drain' or the write callback which destroyed the socket stood for.
  let mustHave = 0;
  const heads = plan.pipelined ? 1 : 0;
  // `late`: written after the peer ended its side. `loose`: an empty chunk under a cork, which Node.js writes ahead of the chunks that the cork holds.
  const callbacks: {
    index: number;
    ran: number;
    mark: number;
    body: number;
    empty: boolean;
    late: boolean;
    loose: boolean;
  }[] = [];

  res.on("close", () => (closed = true));
  res.on("finish", () => {
    finished = true;
    // A destroyed socket fails its writes: Node still emits 'finish' from the failed last one.
    if (done || tornDown) return;
    if (callbacks.some(callback => !callback.ran && !callback.empty && !callback.late)) {
      violation("'finish' before a write callback");
    }
    if (!foreign && T.held()) violation(`'finish' with ${T.held()} bytes in the socket`);
  });
  res.on("drain", () => {
    drains++;
    if (done) return;
    if (tornDown) violation("'drain' after the socket was destroyed");
    if (ended) violation("'drain' after end()");
    if (!owed) violation("'drain' that no false owes");
    owed = owedUnderCork = false;
    if (res.writableLength !== 0) violation(`'drain' with res.writableLength=${res.writableLength}`);
    if (T.held()) violation(`'drain' with ${T.held()} bytes in the socket`);
    if (res.writableNeedDrain) violation("writableNeedDrain is true inside 'drain'");
    if (tornDown || ended) return;
    if (plan.teardown === "drain") {
      mustHave = afterEof ? bodyAtEof : body;
      return destroySocket();
    }
    if (plan.drainWrite && drains === 1) {
      // The buffer is free again: a write smaller than the mark is accepted.
      const returned = write({ op: "write", size: plan.drainWrite, cb: false, str: false, wait: false });
      const framing = plan.chunked && plan.version !== "1.0" ? plan.drainWrite.toString(16).length + 4 : 0;
      if (
        T.buffersUnderTheMark &&
        returned !== plan.drainWrite + framing < res.writableHighWaterMark &&
        !res.destroyed
      ) {
        violation(`write(${plan.drainWrite}) inside 'drain' returned ${returned}, mark ${res.writableHighWaterMark}`);
      }
    }
  });

  function destroySocket() {
    tornDown = true;
    lossy ||= corked > 0;
    T.destroy(res);
  }
  function onCallback(entry: (typeof callbacks)[number], err?: Error | null) {
    entry.ran++;
    if (done) return;
    if (entry.ran > 1) violation(`write callback ${entry.index} ran twice`);
    if (finished && !entry.empty && !entry.late && !tornDown) {
      violation(`write callback ${entry.index} after 'finish'`);
    }
    if (err) {
      // Behind the end of the peer the server ends the socket: a response that still waits behind another one fails there.
      if (!tornDown && !resetting && !afterEof) {
        violation(`write callback ${entry.index} got ${(err as NodeJS.ErrnoException).code ?? err.message}`);
      }
      return;
    }
    // The socket took the chunk of a callback that reports no error, also when the socket is gone by now.
    const taken = foreign || entry.late || entry.loose ? null : T.taken();
    if (taken !== null && bodyTaken(taken, heads) < entry.body) {
      violation(`write callback ${entry.index} reported no error and its chunk is not on the wire`);
    }
    if (tornDown) return;
    if (!entry.loose) checkPlace(entry);
    if (plan.teardown === "cb") {
      mustHave = entry.late ? bodyAtEof : entry.loose ? 0 : entry.body;
      destroySocket();
    }
  }
  // A callback runs behind the ones of the writes before it, when the socket holds no more than what came behind its chunk.
  function checkPlace(entry: (typeof callbacks)[number]) {
    const earlier = callbacks.filter(other => other.index < entry.index && !other.ran);
    if (earlier.length) {
      // The socket took those chunks inside write(), so their callbacks come in this tick. One that still waits in the next turn is out of order.
      setImmediate(() => {
        for (const other of earlier) {
          if (!other.ran) violation(`write callback ${entry.index} before write callback ${other.index}`);
        }
      });
    }
    const behind = handed - entry.mark;
    const held = T.held();
    if (held !== null && held > behind) {
      violation(
        `write callback ${entry.index} while the socket holds ${held} bytes, at most ${behind} behind its chunk`,
      );
    }
  }
  function track(size: number, withCallback: boolean) {
    handed += size + FRAME;
    body += size;
    if (!withCallback) return undefined;
    const empty = size === 0;
    const entry = {
      index: callbacks.length,
      ran: 0,
      mark: handed,
      body,
      empty,
      late: afterEof,
      loose: empty && corked > 0,
    };
    callbacks.push(entry);
    return (err?: Error | null) => onCallback(entry, err);
  }
  function write(step: Extract<Step, { op: "write" }>) {
    const data = step.str ? TEXT.slice(0, step.size) : BYTES.subarray(0, step.size);
    const callback = track(step.size, step.cb);
    const returned = callback ? res.write(data, callback) : res.write(data);
    if (!returned) {
      owedUnderCork = corked > 0 && (!owed || owedUnderCork);
      owed = true;
      if (!res.destroyed && res.writableNeedDrain !== true) {
        violation("writableNeedDrain is not true right after write() returned false");
      }
    } else if (!owed && res.writableNeedDrain) {
      violation("writableNeedDrain is true and no write() returned false");
    }
    // Node.js counts a chunk under a cork, and one behind the end of the peer, apart from what the socket holds.
    if (!owed && !corked && !afterEof && res.writableLength >= res.writableHighWaterMark) {
      violation(
        `writableLength ${res.writableLength} >= mark ${res.writableHighWaterMark} after write(${step.size}) returned true`,
      );
    }
    return returned;
  }
  function uncorkAll() {
    for (; corked > 0; corked--) res.uncork();
  }
  // Lets the transport take one held write for each turn until `until()`. False when it is empty and idle, and `until()` still does not hold.
  async function settle(until: () => boolean) {
    for (let idle = 0, turns = 0; !until(); turns++) {
      await turn();
      if (until()) break;
      if (T.pending(res) && turns < 20000) {
        T.release();
        idle = 0;
      } else if (++idle > T.idleTurns) return false;
    }
    return true;
  }

  T.begin();
  if (!plan.chunked) res.setHeader("Content-Length", 1 << 30);
  if (plan.steps.some(step => step.op === "send")) res.writeHead(200);
  let stalled = false;
  const uncorks: number[] = [];
  for (let i = 0; i < plan.steps.length && !tornDown && !closed && !stalled; i++) {
    for (; uncorks[i] > 0; uncorks[i]--, corked--) res.uncork();
    if (queued && i === plan.queuedSteps) {
      first!.end();
      queued = false;
    }
    if (plan.teardown === "reset" && i === plan.teardownAt) {
      lossy ||= corked > 0;
      resetting = true;
      tornDown = T.reset();
      // Under a cork Node.js keeps the chunk and says true.
      if (tornDown && !plan.pipelined && !corked && res.write("z") !== false) {
        violation("write() after a reset did not return false");
      }
      break;
    }
    if (plan.teardown === "socket" && i === plan.teardownAt) {
      destroySocket();
      // The socket is gone and the response does not know yet: write() says false, as on a full socket.
      if (plan.pipelined || corked) break;
      if (res.write("z") !== false) violation("write() after socket.destroy() did not return false");
      else if (!res.destroyed && res.writableNeedDrain !== true) {
        violation("writableNeedDrain is not true after a write() to a destroyed socket returned false");
      }
      break;
    }
    const step = plan.steps[i];
    if (step.op === "write") {
      // Under a cork the 'drain' waits for the uncork() of a later step.
      if (!write(step) && step.wait && !queued && !corked && !(await settle(() => !owed || closed || tornDown))) {
        violation(`stall: write(${step.size}) returned false and no 'drain' came with the transport empty`);
        stalled = true;
      }
    } else if (step.op === "send") {
      (res as any)._send(BYTES.subarray(0, step.size), undefined, track(step.size, step.cb));
    } else if (step.op === "turn") {
      await turn();
    } else if (step.op === "tick") {
      await tick();
    } else if (step.op === "releaseNow") {
      // The transport takes a held write in the turn of the writes.
      T.release();
    } else if (step.op === "release") {
      await turn();
      T.release();
    } else if (step.op === "budget") {
      T.budget(step.n);
    } else if (step.op === "foreign") {
      if (T.foreign(step.n)) {
        foreign = true;
        handed += step.n;
      }
    } else if (step.op === "cork") {
      res.cork();
      corked++;
      const at = i + 1 + step.span;
      uncorks[at] = (uncorks[at] ?? 0) + 1;
    } else if (step.op === "eof") {
      // The server ends the socket from its 'end' listener, which runs ahead of this one.
      if (!afterEof) {
        T.eof(() => {
          afterEof = true;
          bodyAtEof = body;
          lossy ||= corked > 0;
        });
      }
    } else {
      res.flushHeaders();
    }
  }
  if (queued) first!.end();
  // Under a cork an end() differs: Node.js sends a chunk of end() behind the last chunk, and on a stream Bun never sends the response.
  if (!tornDown) uncorkAll();

  if (tornDown || closed || resetting) {
    if (!(await settle(() => closed))) violation("no 'close' after the socket was destroyed");
    // Bun fails at 'close' the callbacks of the writes that a stream forgot. Node.js leaves them.
    const left = T.forgetsHeldWrites && !process.versions.bun;
    const missing =
      plan.pipelined || lossy || left ? 0 : callbacks.filter(callback => callback.ran !== 1 && !callback.late).length;
    if (missing) violation(`${missing} write callbacks did not run exactly once after the teardown`);
  } else if (!stalled && plan.end) {
    ended = true;
    owed = false;
    const data = plan.end.size ? BYTES.subarray(0, plan.end.size) : undefined;
    handed += plan.end.size + FRAME;
    body += plan.end.size;
    let endCallbacks = 0;
    if (plan.end.cb) {
      res.end(data, () => {
        endCallbacks++;
        if (!finished && !done && !afterEof) violation("end() callback before 'finish'");
      });
    } else {
      res.end(data);
    }
    if (!(await settle(() => finished || closed))) {
      violation("no 'finish' after end() with the transport empty");
    } else if (finished) {
      await turn();
      if (plan.end.cb && endCallbacks !== 1) violation(`end() callback ran ${endCallbacks} times`);
      if (afterEof) {
        // The socket sends what it had when the peer ended its side. A kernel can still have some of it.
        const got = bodyTaken(await T.wire(wire => bodyTaken(wire, heads) >= bodyAtEof), heads);
        if (!foreign && !tornDown && got < bodyAtEof) {
          violation(`the wire has ${got} body bytes, ${bodyAtEof} were written before the peer ended its side`);
        }
      } else if (!foreign && !plan.pipelined && !tornDown) {
        const got = bodyOnWire(await T.wire(wire => bodyOnWire(wire) === body));
        if (got !== body)
          violation(typeof got === "string" ? got : `body on the wire is ${got} bytes, ${body} written`);
      }
      if (plan.version !== "1.1" && !(await settle(() => closed))) {
        violation("no 'close' after 'finish' on a connection that closes");
      }
    }
  } else if (!stalled) {
    const drained = () => !owed || owedUnderCork;
    if (!(await settle(() => (drained() && callbacks.every(callback => callback.ran || callback.late)) || closed))) {
      violation(
        !drained()
          ? "stall: a write() returned false and no 'drain' came with the transport empty"
          : "stall: write callbacks did not run with the transport empty",
      );
    }
  }
  if (mustHave && tornDown && !foreign && T.signalsAfterSend) {
    const got = bodyTaken(await T.wire(wire => bodyTaken(wire, heads) >= mustHave), heads);
    if (got < mustHave) {
      const event = plan.teardown === "drain" ? "'drain'" : "write callback";
      violation(
        `the wire has ${got} body bytes, ${mustHave} were written before the ${event} that destroyed the socket`,
      );
    }
  }
  done = true;
}

// Runs one plan on a fresh server. Resolves with the invariants that it broke.
export async function checkPlan(
  createServer: (listener: (req: IncomingMessage, res: ServerResponse) => void) => Server,
  plan: Plan,
  T: Transport,
) {
  const violations: string[] = [];
  const violation = (message: string) => void (violations.includes(message) || violations.push(message));
  let first: ServerResponse | null = null;
  let running: Promise<void> | undefined;
  const server = createServer((req, res) => {
    if (plan.pipelined && req.url === "/first") {
      first = res;
      res.writeHead(200, { "Content-Length": "0" });
      res.flushHeaders();
      return;
    }
    running = runPlan(res, T, plan, violation, first);
  });
  const rest =
    plan.version === "1.0"
      ? "HTTP/1.0\r\n\r\n"
      : plan.version === "1.1 close"
        ? "HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        : "HTTP/1.1\r\nHost: localhost\r\n\r\n";
  T.start(server, plan.pipelined ? `GET /first ${rest}GET /second ${rest}` : `GET / ${rest}`);
  for (let i = 0; i < 2000 && !running; i++) await turn();
  if (!running) violation("the request was not dispatched");
  else await running;
  T.stop();
  await turn();
  return violations;
}
