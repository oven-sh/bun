// Prints the sweeps at which socket timeouts ran, as JSON.
//
// The loop runs the socket timeout sweep about once every 4 seconds.
// `sweepSocketTimers()` runs it by hand, so `socket.timeout(seconds)` is due
// `Math.ceil(seconds / 4)` sweeps after the call and nothing here waits.
//
// usage: bun socket-timeout-fixture.ts <tcp | tls | upgradeTLS | parked | serve>
import type { Socket, SocketHandler, WebSocketHandler } from "bun";
import { getEventLoopStats, sweepSocketTimers } from "bun:internal-for-testing";
import * as transport from "./tls-fixture-transport";

type State = {
  fired: number[];
  /** Seconds for `timeout()` calls from the `timeout` handler, one per call. */
  rearm: number[];
  /** Runs in the `timeout` handler. */
  then?: () => void;
  /** Seconds for a `timeout()` call from the `data` handler. */
  idle?: number;
  received?: PromiseWithResolvers<void>;
};
const state = (): State => ({ fired: [], rearm: [] });

const mode = process.argv[2] as "tcp" | "tls" | "upgradeTLS" | "parked" | "serve";
const useTLS = mode === "tls" || mode === "parked";
const serverTLS = useTLS ? { cert: process.env.TLS_CERT!, key: process.env.TLS_KEY! } : undefined;
const clientTLS = useTLS ? { rejectUnauthorized: false } : undefined;

// Sweeps run since the last `arm()`.
let sweep = 0;
// What the fixture does now, for `fail()`.
let step = "start";

function fail(error: string): never {
  console.log(JSON.stringify({ error: `${step}: ${error}` }));
  process.exit(1);
}
// Inside the timeout of the test, so a step that never completes still names itself.
setTimeout(() => fail("timed out"), 40_000);

const handlers = {
  close() {
    fail("a socket closed");
  },
  error(_socket, error) {
    fail(`socket error: ${error}`);
  },
  data(socket) {
    if (socket.data.idle) socket.timeout(socket.data.idle);
    socket.data.received?.resolve();
  },
  timeout(socket) {
    socket.data.fired.push(sweep);
    const again = socket.data.rearm.shift();
    if (again !== undefined) socket.timeout(again);
    socket.data.then?.();
  },
} satisfies SocketHandler<State>;

let accepted = Promise.withResolvers<Socket<State>>();
using listener = Bun.listen<State>({
  hostname: "127.0.0.1",
  port: 0,
  tls: serverTLS,
  socket: {
    ...handlers,
    open(socket) {
      socket.data = state();
      if (!serverTLS) accepted.resolve(socket);
    },
    handshake(socket, success) {
      if (!success) fail("the TLS handshake of an accepted socket failed");
      accepted.resolve(socket);
    },
  },
});

type Connection = { server: Socket<State>; client: Socket<State> };

/** One connection with both ends ready: open for TCP, handshake done for TLS. */
async function connection(): Promise<Connection> {
  const ready = Promise.withResolvers<void>();
  const client = await Bun.connect<State>({
    hostname: "127.0.0.1",
    port: listener.port,
    tls: clientTLS,
    data: state(),
    socket: {
      ...handlers,
      open() {
        if (!clientTLS) ready.resolve();
      },
      handshake(_socket, success) {
        if (!success) fail("the TLS handshake of a client socket failed");
        ready.resolve();
      },
    },
  });
  await ready.promise;
  const server = await accepted.promise;
  accepted = Promise.withResolvers();
  return { server, client };
}

function arm(socket: Socket<State>, seconds: number) {
  sweep = 0;
  socket.timeout(seconds);
}

function run(sweeps: number) {
  for (let i = 0; i < sweeps; i++) {
    sweep++;
    sweepSocketTimers(1);
  }
}

/** Every sweep up to `target` in one call, for a stretch in which no timeout is due. */
function skipTo(target: number) {
  const stretch = target - sweep;
  sweep = target;
  sweepSocketTimers(stretch);
}

// Its timeout is due at the next sweep, so it tells when the loop ran a sweep of its own.
let canary: Socket<State>;

/** False if the loop ran a sweep of its own before `wait` settled: a count across it is then one off. */
async function undisturbed(wait: Promise<unknown>) {
  canary.data.fired.length = 0;
  canary.timeout(4);
  await wait;
  canary.timeout(0);
  return canary.data.fired.length === 0;
}

/** Runs `once` again for as long as it returns undefined, which it does when `undisturbed()` was false. */
async function retry<T>(once: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const value = await once();
    if (value !== undefined) return value;
  }
  fail("the loop ran a sweep of its own in each of 5 attempts");
}

/** An accepted socket starts with a timeout of 120 seconds. */
function acceptDefault() {
  return retry(async () => {
    const pending = connection();
    if (!(await undisturbed(pending))) return;
    const { server } = await pending;
    sweep = 0;
    run(40);
    return server.data.fired;
  });
}

/** `timeout(seconds)` on an accepted socket and on a client socket, for each value. */
async function values() {
  const seconds = [240, 241, 300, 956, 960, 964, 14400, 86400, 262160, 2147483647];
  const connections: Connection[] = [];
  for (const _ of seconds) connections.push(await connection());
  sweep = 0;
  seconds.forEach((n, i) => {
    connections[i].server.timeout(n);
    connections[i].client.timeout(n);
  });
  // One sweep at a time around each deadline. A handler that ran in a stretch between them
  // shows the last sweep of that stretch.
  run(300);
  for (const due of [14400 / 4, 86400 / 4, 262160 / 4]) {
    skipTo(due - 10);
    run(20);
  }
  const at = (end: keyof Connection) => Object.fromEntries(seconds.map((n, i) => [n, connections[i][end].data.fired]));
  const open = connections.every(({ server, client }) => server.readyState === 1 && client.readyState === 1);
  return { accepted: at("server"), client: at("client"), "the sockets stay open": open };
}

/** A `timeout()` call that follows another one. */
async function orders() {
  const result: Record<string, unknown> = {};
  {
    const { client } = await connection();
    arm(client, 3600);
    run(70);
    arm(client, 8);
    run(300);
    result["timeout(8) replaces timeout(3600)"] = client.data.fired;
  }
  {
    const { client } = await connection();
    arm(client, 8);
    arm(client, 3600);
    run(1000);
    result["timeout(3600) replaces timeout(8)"] = client.data.fired;
  }
  {
    const { client } = await connection();
    arm(client, 3600);
    run(70);
    client.timeout(0);
    run(1000);
    result["timeout(0) cancels timeout(3600)"] = client.data.fired;
  }
  {
    const { client } = await connection();
    client.data.rearm = [3600, 3600];
    arm(client, 3600);
    run(2800);
    result["timeout(3600) again from the handler, twice"] = client.data.fired;
  }
  {
    // The sweep reaches `newer` before `middle`, and `older` after it.
    const older = (await connection()).client;
    const middle = (await connection()).client;
    const newer = (await connection()).client;
    middle.data.then = () => {
      older.timeout(960);
      newer.timeout(960);
    };
    arm(middle, 40);
    run(300);
    result["timeout(960) on an older and a newer socket, from a handler"] = [older.data.fired, newer.data.fired];
  }
  return result;
}

/** Data in both directions between the call and the deadline. */
async function io() {
  async function exchange({ server, client }: Connection) {
    server.data.received = Promise.withResolvers();
    client.data.received = Promise.withResolvers();
    server.write("x");
    client.write("x");
    await Promise.all([server.data.received.promise, client.data.received.promise]);
  }
  const cases = {
    "timeout(300), 40 sweeps, data, 80 sweeps": { seconds: 300, before: 40, after: 80, idle: undefined },
    "the same, with timeout(300) again in `data`": { seconds: 300, before: 40, after: 80, idle: 300 },
    "timeout(3600), 500 sweeps, data, 410 sweeps": { seconds: 3600, before: 500, after: 410, idle: undefined },
  };
  const result: Record<string, unknown> = {};
  for (const [name, { seconds, before, after, idle }] of Object.entries(cases)) {
    step = name;
    result[name] = await retry(async () => {
      const pair = await connection();
      pair.server.data.idle = pair.client.data.idle = idle;
      sweep = 0;
      pair.server.timeout(seconds);
      pair.client.timeout(seconds);
      run(before);
      if (!(await undisturbed(exchange(pair)))) return;
      run(after);
      return { accepted: pair.server.data.fired, client: pair.client.data.fired };
    });
  }
  return result;
}

async function sockets() {
  canary = (await connection()).client;
  step = "the accept default";
  const byDefault = await acceptDefault();
  step = "values";
  const byValue = await values();
  step = "orders";
  const byOrder = await orders();
  return { "no timeout() call on an accepted socket": byDefault, values: byValue, orders: byOrder, io: await io() };
}

/**
 * uSockets runs 5 TLS handshake reads per loop iteration. It parks the other
 * readable sockets in a queue of their own, which the sweep walks separately.
 * 12 accepted sockets, 7 of them parked.
 */
async function parked() {
  const count = 12;
  const iteration = () => getEventLoopStats().iteration;
  // Immediates run after the dispatch of a loop iteration.
  const iterations = async (n: number) => {
    const target = iteration() + n;
    while (iteration() < target) await new Promise(r => setImmediate(r));
  };
  // The first accepted socket completes its handshake. Its handler arms the others.
  let first: Socket<State> | undefined;
  const firstReady = Promise.withResolvers<void>();
  const sockets: Socket<State>[] = [];
  let clientHandshakes = 0;
  // One loop iteration has to deliver every ClientHello: see tls-fixture-transport.ts.
  const { address } = transport.listen<State>("parked", {
    tls: serverTLS,
    socket: {
      ...handlers,
      // With a `handshake` handler, `open` runs before the TLS handshake.
      handshake(socket, success) {
        if (!success) fail("the TLS handshake of an accepted socket failed");
        if (socket === first) firstReady.resolve();
      },
      // The ClientHello of the others stays unread until `resume()`.
      open(socket) {
        socket.data = state();
        if (!first) {
          first = socket;
          return;
        }
        socket.pause();
        sockets.push(socket);
      },
    },
  });
  const connect = () =>
    transport.connect(address, {
      tls: clientTLS,
      socket: {
        data() {},
        close() {
          fail("a client socket closed");
        },
        error(_socket, error) {
          fail(`client socket error: ${error}`);
        },
        handshake(_socket, success) {
          if (!success) fail("the TLS handshake of a client socket failed");
          clientHandshakes++;
        },
      },
    });
  step = "the first connection";
  await connect();
  await firstReady.promise;
  step = "accept 12 sockets";
  for (let i = 0; i < count; i++) await connect();
  while (sockets.length < count) await iterations(1);
  // After these, every ClientHello is in the receive queue of the server.
  await iterations(2);
  for (const socket of sockets) socket.resume();
  // The next iteration reads 5 of them and parks the other 7.
  await iterations(1);
  step = "sweeps";
  sweep = 0;
  for (const socket of sockets) socket.timeout(3600);
  run(1000);
  // Armed from the handler of `first`, while the sweep that runs it is still going.
  first!.data.then = () => {
    for (const socket of sockets) socket.timeout(960);
  };
  arm(first!, 40);
  run(300);
  // A paused socket stays unread, so only the 5 clients whose ClientHello was
  // read complete their handshake: the other 7 were parked during the sweeps.
  for (const socket of sockets) socket.pause();
  step = "40 more loop iterations";
  await iterations(40);
  return { fired: sockets.map(socket => socket.data.fired), clientHandshakes };
}

/**
 * The two sockets `upgradeTLS()` returns share one native socket. Its timeout
 * goes to the handlers of the TLS socket, whichever of the two armed it.
 */
async function upgraded() {
  const upgrade = (client: Socket<State>, data: State) =>
    client.upgradeTLS<State>({ data, tls: { rejectUnauthorized: false }, socket: handlers });
  const result: Record<string, unknown> = {};
  {
    const { client } = await connection();
    const tlsState = state();
    const [raw, tls] = upgrade(client, tlsState);
    arm(raw, 1000);
    run(300);
    result["raw.timeout(1000)"] = tlsState.fired.splice(0);
    arm(tls, 1004);
    run(300);
    result["tls.timeout(1004)"] = tlsState.fired;
  }
  {
    const { client } = await connection();
    const tcpState = client.data;
    const tlsState = state();
    arm(client, 40);
    upgrade(client, tlsState);
    run(300);
    result["timeout(40), then upgradeTLS()"] = { tcp: tcpState.fired, tls: tlsState.fired };
  }
  return result;
}

/**
 * A `Bun.serve` WebSocket and a client that sends nothing after the upgrade.
 * The server pings it when `idleTimeout` minus a margin of 4 to 16 seconds has
 * passed, and closes it when the margin has passed too. 0 arms no timer.
 */
async function serve() {
  canary = (await connection()).client;
  const cases: Record<string, Pick<WebSocketHandler, "idleTimeout">> = {
    "idleTimeout: 120": { idleTimeout: 120 },
    "idleTimeout: 960": { idleTimeout: 960 },
    // No timer. `0 - margin` in 16 bits would be 65532 seconds, which are 16383 sweeps.
    "idleTimeout: 0": { idleTimeout: 0 },
  };
  const result: Record<string, unknown> = {};
  for (const [name, options] of Object.entries(cases)) {
    step = name;
    result[name] = await retry(async () => {
      const closed: number[] = [];
      using server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request, server) {
          if (!server.upgrade(request)) fail("the upgrade failed");
        },
        websocket: {
          ...options,
          message() {},
          close() {
            closed.push(sweep);
          },
        },
      });
      const response = Promise.withResolvers<void>();
      const dial = Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          open(socket) {
            socket.write(
              "GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
            );
          },
          // The 101 response. The server arms the idle timeout when it sends it.
          data() {
            response.resolve();
          },
          close() {},
          error(_socket, error) {
            fail(`client socket error: ${error}`);
          },
        },
      });
      if (!(await undisturbed(Promise.all([dial, response.promise])))) return;
      sweep = 0;
      run(300);
      skipTo(20_000);
      // A copy: the server closes the WebSocket when it stops.
      return [...closed];
    });
  }
  return result;
}

const result = await { tcp: sockets, tls: sockets, upgradeTLS: upgraded, parked, serve }[mode]();
console.log(JSON.stringify(result));
process.exit(0);
