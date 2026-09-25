// Runs SCENARIO against a mock server in this process and prints what every query settled with.
//
// User JS that the client calls while it parses a socket read can run the event loop: Bun.build()
// waits for an async plugin setup(), require() can auto-install, expect(promise).resolves waits.
// Here that JS is a parameter's toString() (the client converts the parameter of a queued request
// when the ReadyForQuery of the request before it arrives) or a sql.listen() listener. The mock is
// in the same process, so that JS can make the server write and then run the loop until the
// client's loop has read those bytes.
//
// It is a subprocess because a broken build hangs or aborts in these scenarios.
import { SQL } from "bun";
import net from "node:net";
import {
  listeningServer,
  pgAuthenticationOk,
  pgBindComplete,
  pgBindParameters,
  pgCommandComplete,
  pgCString,
  pgDataRow,
  pgNotificationResponse,
  pgParameterDescription,
  pgParseComplete,
  pgRaw,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

type Connection = {
  socket: net.Socket;
  /** The replies to the Syncs that came in while `hold` was set, oldest first. One entry is one reply. */
  held: Buffer[][];
  hold: boolean;
  /** Ends the connection after this many replies to a Bind: every query then settles or rejects. */
  endAfter: number;
  executed: number;
  onReply(): void;
};

const connections: Connection[] = [];

// Answers a Parse with a one-column text statement and a Bind with one row: the bound value, or
// `big:<length>` for a long one.
const { port, server } = await listeningServer(socket => {
  const connection: Connection = { socket, held: [], hold: false, endAfter: Infinity, executed: 0, onReply() {} };
  connections.push(connection);
  let buffered = Buffer.alloc(0);
  let startup = true;
  let batch: { type: string; body: Buffer }[] = [];
  socket.on("error", () => {});
  socket.on("data", chunk => {
    buffered = Buffer.concat([buffered, chunk]);
    if (startup) {
      if (buffered.length < 4 || buffered.length < buffered.readInt32BE(0)) return;
      buffered = buffered.subarray(buffered.readInt32BE(0));
      startup = false;
      socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
    }
    buffered = pgReadFrontendMessages(buffered, (code, body) => {
      const type = String.fromCharCode(code);
      if (type === "Q") {
        // LISTEN, from sql.listen().
        reply(connection, [pgCommandComplete("LISTEN"), pgReadyForQuery()]);
        return;
      }
      if (type !== "S") {
        batch.push({ type, body: Buffer.from(body) });
        return;
      }
      const frames: Buffer[] = [];
      for (const message of batch) {
        if (message.type === "P") frames.push(pgParseComplete());
        else if (message.type === "D")
          frames.push(pgParameterDescription([25]), pgRowDescription([{ name: "x", typeOid: 25 }]));
        else if (message.type === "B") {
          const value = pgBindParameters(message.body)[0]!;
          const row = value.length > 100 ? Buffer.from(`big:${value.length}`) : value;
          frames.push(pgBindComplete(), pgDataRow([row]), pgCommandComplete("SELECT 1"));
          connection.executed++;
        }
      }
      batch = [];
      reply(connection, [...frames, pgReadyForQuery()]);
    });
  });
});

function reply(connection: Connection, frames: Buffer[]) {
  if (connection.hold) {
    connection.held.push(frames);
  } else {
    connection.socket.write(Buffer.concat(frames));
    if (connection.executed >= connection.endAfter) connection.socket.end();
  }
  connection.onReply();
}

/** The mock holds `count` replies of `connection`. */
function heldReplies(connection: Connection, count: number) {
  const { promise, resolve } = Promise.withResolvers<void>();
  connection.onReply = () => {
    if (connection.held.length >= count) resolve();
  };
  connection.onReply();
  return promise;
}

// A second socket pair of this loop. The peer writes one byte after the mock wrote to the client:
// when that byte is here, the loop has read what the mock wrote before it.
const accepted = Promise.withResolvers<net.Socket>();
const marker = await listeningServer(accepted.resolve);
const markerSocket = net.connect(marker.port, "127.0.0.1");
const markerPeer = await accepted.promise;

/** The loop has read what the mock wrote. */
function read() {
  const { promise, resolve } = Promise.withResolvers<void>();
  markerSocket.once("data", () => resolve());
  markerPeer.write("x");
  return promise;
}

/** Runs the event loop, from inside the caller, until the loop has read what the mock wrote. */
function runLoopUntilRead() {
  const promise = read();
  // Bun.build() waits for an async plugin setup(). The rejection stops the build before it bundles.
  try {
    Bun.build({
      entrypoints: [import.meta.path],
      plugins: [{ name: "run the loop", setup: () => promise.then(() => Promise.reject(new Error("done"))) }],
    });
  } catch {}
}

const options = { url: `postgres://u@127.0.0.1:${port}/db`, max: 1, idleTimeout: 0, connectionTimeout: 0 };

// A plain object goes out as text: the Bind encoder calls its toString().
const text = (value: string) => ({ toString: () => value });
const big = text(Buffer.alloc(70_000, "c").toString());
const select = (sql: SQL, value: { toString(): string }) => sql`select ${value}::text as x`.execute();

const settle = (promise: Promise<any>) =>
  promise.then(
    rows => [...rows].map(row => row.x),
    error => ({ rejected: error?.code ?? String(error) }),
  );

let conversions = 0;
/** A parameter whose first conversion runs `inside`. */
function converting(value: string, inside: () => void) {
  return {
    toString() {
      if (conversions++ === 0) inside();
      return value;
    },
  };
}

/**
 * One connection with a prepared statement and three requests on the wire: a, b and the big one.
 * The big one fills the write buffer, so the fourth request (q) is queued and not written. The
 * client converts q's parameter when the ReadyForQuery of a's reply arrives: inside the parse of
 * the read that the last chunk of `first` came in. The mock writes one chunk of `first` at a time.
 */
async function pipelined(
  first: (replies: Buffer[][]) => Buffer[],
  inside: (connection: Connection, replies: Buffer[][]) => void,
  rest: (replies: Buffer[][]) => Buffer[],
) {
  const sql = new SQL(options);
  await select(sql, text("warm"));
  const connection = connections.at(-1)!;
  connection.hold = true;
  connection.endAfter = 5;

  const queries = {
    a: settle(select(sql, text("a"))),
    b: settle(select(sql, text("b"))),
    big: settle(select(sql, big)),
    q: settle(
      select(
        sql,
        converting("q", () => {
          inside(connection, connection.held);
          runLoopUntilRead();
          connection.hold = false;
          connection.socket.write(Buffer.concat(rest(connection.held)));
        }),
      ),
    ),
  };
  await heldReplies(connection, 3);
  for (const chunk of first(connection.held)) {
    connection.socket.write(chunk);
    await read();
  }
  return {
    a: await queries.a,
    b: await queries.b,
    big: await queries.big,
    q: await queries.q,
    conversions,
  };
}

const scenarios: Record<string, () => Promise<unknown>> = {
  // The bytes that come in during the conversion are newer than the rest of the read that is
  // being parsed. They are short: they fit in the part of the receive buffer that is parsed.
  "newer bytes of the same connection"() {
    return pipelined(
      ([a, b]) => [Buffer.concat([...a, ...b])],
      (connection, [, , big]) => connection.socket.write(Buffer.concat(big.slice(0, 2))),
      ([, , big]) => big.slice(2),
    );
  },

  // The read during the conversion is longer than the read that is being parsed.
  "a longer read of the same connection"() {
    // A NoticeResponse: the client reads it and drops it.
    const notice = pgRaw(
      "N",
      Buffer.concat([Buffer.from("M"), pgCString(Buffer.alloc(70_000, "n").toString()), Buffer.from([0])]),
    );
    return pipelined(
      ([a, b]) => [Buffer.concat([...a, ...b])],
      connection => connection.socket.write(notice),
      ([, , big]) => big,
    );
  },

  // The read that is being parsed ends inside b's reply. The rest of it comes in during the conversion.
  "the rest of a message"() {
    return pipelined(
      ([a, b]) => [Buffer.concat([...a, Buffer.concat(b).subarray(0, 9)])],
      (connection, [, b]) => connection.socket.write(Buffer.concat(b).subarray(9)),
      ([, , big]) => big,
    );
  },

  // The client has the start of a's reply in its own buffer when the read with the rest comes in.
  "newer bytes, with a message that came in two reads"() {
    return pipelined(
      ([a, b]) => [Buffer.concat(a).subarray(0, 3), Buffer.concat([Buffer.concat(a).subarray(3), ...b])],
      (connection, [, , big]) => connection.socket.write(Buffer.concat(big.slice(0, 2))),
      ([, , big]) => big.slice(2),
    );
  },

  // Nothing comes in on the connection. Another connection of the loop reads two replies.
  async "a read of another connection"() {
    const other = new SQL(options);
    await select(other, text("warm"));
    const otherConnection = connections.at(-1)!;
    otherConnection.hold = true;
    const others = [settle(select(other, text("1"))), settle(select(other, text("2")))];
    await heldReplies(otherConnection, 2);
    const result = await pipelined(
      ([a, b]) => [Buffer.concat([...a, ...b])],
      () => otherConnection.socket.write(Buffer.concat(otherConnection.held.flat())),
      ([, , big]) => big,
    );
    return { ...(result as object), other: await Promise.all(others) };
  },

  // A listener runs the loop. Two notifications came in one read; a third one comes in during the listener.
  async "a notification listener"() {
    const sql = new SQL(options);
    const seen: string[] = [];
    const { promise: all, resolve } = Promise.withResolvers<void>();
    let connection!: Connection;
    await sql.listen("channel", payload => {
      seen.push(payload);
      if (payload === "1") {
        connection.socket.write(pgNotificationResponse(1, "channel", "3"));
        runLoopUntilRead();
        connection.socket.end();
      }
    });
    connection = connections.at(-1)!;
    connection.socket.once("close", () => resolve());
    connection.socket.write(
      Buffer.concat([pgNotificationResponse(1, "channel", "1"), pgNotificationResponse(1, "channel", "2")]),
    );
    await all;
    return { seen };
  },
};

console.log(JSON.stringify(await scenarios[process.env.SCENARIO!]()));
process.exit(0);
