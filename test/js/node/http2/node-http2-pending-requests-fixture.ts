/**
 * Gives 16 client requests up while they wait, and prints how many of them are still alive after
 * garbage collection. node-http2-pending-requests.test.ts runs it in a process of its own: a
 * request that nothing references can outlive a collection in a process that has other work. A
 * heap snapshot shows such requests under the JITWorkList root, which holds the values that an
 * optimizing compilation in flight refers to.
 *
 *   bun node-http2-pending-requests-fixture.ts <scenario>
 *   node --expose-gc node-http2-pending-requests-fixture.ts <scenario>
 */
import { type EventEmitter } from "node:events";
import http2 from "node:http2";
import net from "node:net";

const GIVEN_UP = 16;

const collect: () => void = typeof Bun !== "undefined" ? () => Bun.gc(true) : (globalThis as any).gc;
const immediate = () => new Promise<void>(resolve => setImmediate(resolve));
const eventOf = (emitter: EventEmitter, name: string) => new Promise(resolve => emitter.once(name, resolve));

/** Collects until the count of live targets has not moved for three passes. Resolves to that count. */
async function alive(refs: WeakRef<object>[]): Promise<number> {
  let last = refs.length;
  for (let same = 0; same < 3;) {
    // A WeakRef keeps its target for the rest of the job that read it, so every pass collects
    // from a new job.
    await immediate();
    collect();
    const now = refs.filter(ref => ref.deref() !== undefined).length;
    same = now === last ? same + 1 : 0;
    last = now;
  }
  return last;
}

type GiveUp = (req: http2.ClientHttp2Stream, controller: AbortController) => void;

/**
 * Makes GIVEN_UP requests that wait, then gives each one up, the oldest or the newest first. No
 * reference to a request survives this function: only the WeakRefs it returns can still reach
 * one. `closed` settles when every request has emitted 'close'.
 */
function giveUpWaitingRequests(session: http2.ClientHttp2Session, giveUp: GiveUp, first: "oldest" | "newest") {
  const requests = Array.from({ length: GIVEN_UP }, () => {
    const controller = new AbortController();
    const req = session.request({ ":path": "/given-up" }, { signal: controller.signal });
    req.on("error", () => {});
    return { req, controller };
  });
  const refs = requests.map(({ req }) => new WeakRef<object>(req));
  const closed = Promise.all(requests.map(({ req }) => eventOf(req, "close")));
  if (first === "newest") requests.reverse();
  for (const { req, controller } of requests) giveUp(req, controller);
  return { refs, closed };
}

/** A session whose socket never connects: the lookup never answers. */
function sessionThatNeverConnects() {
  const socket = net.connect({ host: "never-connects.invalid", port: 80, lookup: () => {} });
  const session = http2.connect("http://never-connects.invalid", { createConnection: () => socket });
  session.on("error", () => {});
  return { session, socket };
}

/**
 * The requests wait behind a request that has the only stream slot of a server, which never
 * answers it, and behind a keeper that stays. So a request leaves the queue from every place but
 * the front.
 */
async function behindTheStreamLimit(giveUp: GiveUp, first: "oldest" | "newest") {
  const held = Promise.withResolvers<void>();
  const server = http2.createServer({ settings: { maxConcurrentStreams: 1 } });
  server.on("stream", (stream: http2.ServerHttp2Stream) => {
    stream.on("error", () => {});
    held.resolve();
  });
  server.listen(0, "127.0.0.1");
  await eventOf(server, "listening");
  const session = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
  session.on("error", () => {});
  await eventOf(session, "remoteSettings");
  const holder = session.request({ ":path": "/hold" });
  holder.on("error", () => {});
  await held.promise;
  const keeper = session.request({ ":path": "/keeper" });
  keeper.on("error", () => {});

  const { refs, closed } = giveUpWaitingRequests(session, giveUp, first);
  await closed;
  const result = { alive: await alive(refs), givenUp: refs.length, slotTaken: !holder.closed };
  session.destroy();
  server.close();
  return result;
}

async function beforeTheConnect() {
  const { session, socket } = sessionThatNeverConnects();
  const { refs, closed } = giveUpWaitingRequests(session, req => req.destroy(), "newest");
  await closed;
  const result = { alive: await alive(refs), givenUp: refs.length, connecting: session.connecting };
  session.destroy();
  socket.destroy();
  return result;
}

/**
 * The JIT can hold the queue's record of a request for a while. This scenario does the same on
 * purpose, with the record of the oldest request, and counts the other requests.
 */
async function aRecordIsHeld() {
  const { session, socket } = sessionThatNeverConnects();
  const { record, refs, closed } = (() => {
    const requests = Array.from({ length: GIVEN_UP }, () => session.request({ ":path": "/" }));
    const oldest: any = requests[0];
    const kPendingRequest = Object.getOwnPropertySymbols(oldest).find(key => key.description === "pendingRequest")!;
    const record: { req: http2.ClientHttp2Stream } = oldest[kPendingRequest];
    const refs = requests.slice(1).map(req => new WeakRef<object>(req));
    const closed = Promise.all(requests.map(req => eventOf(req, "close")));
    for (const req of requests) req.destroy();
    return { record, refs, closed };
  })();
  await closed;
  const result = { alive: await alive(refs), givenUp: refs.length, heldRequestDestroyed: record.req.destroyed };
  session.destroy();
  socket.destroy();
  return result;
}

const scenarios: Record<string, () => Promise<object>> = {
  "destroy, oldest first": () => behindTheStreamLimit(req => req.destroy(), "oldest"),
  "destroy with an error, newest first": () =>
    behindTheStreamLimit(req => req.destroy(new Error("given up")), "newest"),
  "AbortSignal, oldest first": () => behindTheStreamLimit((_, controller) => controller.abort(), "oldest"),
  "before the connect": beforeTheConnect,
  "a record is held": aRecordIsHeld,
};

console.log(JSON.stringify(await scenarios[process.argv[2]]()));
