// Pool slot accounting across the paths that hand a connection back to the pool.
// The mock servers record every statement per connection, so a transaction that
// lands on a connection somebody else still holds shows up in the recorded order.
// They also drop the socket on demand, which a real container will not do.
// Wire bytes come from ./wire-frames.ts.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import type net from "node:net";
import { join } from "node:path";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgNoData,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
} from "./wire-frames";

type Received = { conn: number; sql: string };
// `hold` can delay the answer to a statement. Answers keep the order of the statements.
type Hold = (sql: string) => Promise<void> | void;
type MockServer = (received: Received[], hold?: Hold) => Promise<{ port: number; server: net.Server }>;

function answerInOrder(hold: Hold | undefined) {
  let chain = Promise.resolve();
  return (sql: string, answer: () => void) => {
    if (!hold) return answer();
    chain = chain.then(() => hold(sql)).then(answer);
  };
}

// Query text containing "KILL" destroys the socket without answering. A prepared
// statement (the extended protocol, what a tagged template sends) is answered as a
// statement with text parameters and no columns.
const pgMockServer: MockServer = (received, hold) => {
  let nextConn = 0;
  return listeningServer(socket => {
    const connId = nextConn++;
    const answer = answerInOrder(hold);
    let prepared = "";
    let buffered = Buffer.alloc(0);
    let startup = true;
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (startup) {
        if (buffered.length < 4) return;
        const len = buffered.readInt32BE(0);
        if (buffered.length < len) return;
        buffered = buffered.subarray(len);
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      }
      while (buffered.length >= 5) {
        const type = String.fromCharCode(buffered[0]);
        const len = buffered.readInt32BE(1);
        if (buffered.length < 1 + len) return;
        const body = buffered.subarray(5, 1 + len);
        buffered = buffered.subarray(1 + len);
        if (type === "P") {
          // Parse: String(statement name) String(query) ...
          const nameEnd = body.indexOf(0);
          prepared = body.subarray(nameEnd + 1, body.indexOf(0, nameEnd + 1)).toString("utf8");
          received.push({ conn: connId, sql: prepared });
          answer(prepared, () => socket.write(pgParseComplete()));
          continue;
        }
        if (type === "D") {
          // Describe: Byte1('S' statement | 'P' portal). Only a statement describe lists the parameters.
          const parameters = Array(new Set(prepared.match(/\$\d+/g)).size).fill(25 /* text */);
          const replies = body[0] === 0x53 ? [pgParameterDescription(parameters), pgNoData()] : [pgNoData()];
          answer(prepared, () => socket.write(Buffer.concat(replies)));
          continue;
        }
        if (type === "B") {
          answer(prepared, () => socket.write(pgBindComplete()));
          continue;
        }
        if (type === "E") {
          answer(prepared, () => socket.write(pgCommandComplete("SELECT 0")));
          continue;
        }
        if (type === "S") {
          answer(prepared, () => socket.write(pgReadyForQuery()));
          continue;
        }
        if (type !== "Q") continue;
        const sql = body.subarray(0, body.indexOf(0)).toString("utf8");
        received.push({ conn: connId, sql });
        if (sql.includes("KILL")) {
          socket.destroy();
          return;
        }
        answer(sql, () => socket.write(Buffer.concat([pgCommandComplete("SELECT 0"), pgReadyForQuery()])));
      }
    });
    socket.on("error", () => {});
  });
};

const mysqlMockServer: MockServer = (received, hold) => {
  const COM_QUIT = 0x01;
  const COM_QUERY = 0x03;
  const COM_STMT_PREPARE = 0x16;
  const COM_STMT_EXECUTE = 0x17;
  let nextConn = 0;
  return listeningServer(socket => {
    const connId = nextConn++;
    const answer = answerInOrder(hold);
    let prepared = "";
    let nextStatementId = 1;
    let buffered = Buffer.alloc(0);
    let authed = false;
    socket.write(mysqlHandshakeV10());
    socket.on("data", (chunk: Buffer) => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(seq + 1));
          return;
        }
        if (mysqlAckSessionSetup(socket, payload)) return;
        if (payload[0] === COM_QUERY) {
          const sql = payload.subarray(1).toString("utf8");
          received.push({ conn: connId, sql });
          if (sql.includes("KILL")) {
            socket.destroy();
            return;
          }
          answer(sql, () => socket.write(mysqlOkPacket(1)));
        } else if (payload[0] === COM_STMT_PREPARE) {
          prepared = payload.subarray(1).toString("utf8");
          received.push({ conn: connId, sql: prepared });
          const statementId = nextStatementId++;
          answer(prepared, () => socket.write(mysqlStmtPrepareOk(1, statementId, 0, 0)));
        } else if (payload[0] === COM_STMT_EXECUTE) {
          answer(prepared, () => socket.write(mysqlOkPacket(1)));
        } else if (payload[0] === COM_QUIT) {
          socket.end();
        }
      });
    });
    socket.on("error", () => {});
  });
};

// Returns the first nested BEGIN or unmatched COMMIT/ROLLBACK per connection, or null.
function firstInterleaving(received: Received[]): string | null {
  const depth = new Map<number, number>();
  for (const { conn, sql } of received) {
    const word = sql.split(/\s+/, 1)[0].toUpperCase();
    const d = depth.get(conn) ?? 0;
    if (word === "BEGIN" || word === "START") {
      if (d !== 0) return `${word} inside an open transaction on conn ${conn}: ${JSON.stringify(received)}`;
      depth.set(conn, 1);
    } else if (word === "COMMIT" || word === "ROLLBACK") {
      if (d !== 1) return `${word} with no open transaction on conn ${conn}: ${JSON.stringify(received)}`;
      depth.set(conn, 0);
    }
  }
  return null;
}

type Adapter = {
  adapter: "postgres" | "mysql";
  mockServer: MockServer;
  beginCommand: string;
  closedCode: string;
  // The statements that differ by adapter. notify() is PostgreSQL only.
  wire: { notify: string | null; commitDistributed: string; rollbackDistributed: string };
  // The first statement that ends a distributed transaction when its callback fulfils, and when it rejects.
  distributedEnd: [string, string];
};
const adapters: Adapter[] = [
  {
    adapter: "postgres",
    mockServer: pgMockServer,
    beginCommand: "BEGIN",
    closedCode: "ERR_POSTGRES_CONNECTION_CLOSED",
    wire: {
      notify: "SELECT pg_notify($1, $2)",
      commitDistributed: "COMMIT PREPARED 'c'",
      rollbackDistributed: "ROLLBACK PREPARED 'r'",
    },
    distributedEnd: ["PREPARE TRANSACTION 'x'", "ROLLBACK"],
  },
  {
    adapter: "mysql",
    mockServer: mysqlMockServer,
    beginCommand: "START TRANSACTION",
    closedCode: "ERR_MYSQL_CONNECTION_CLOSED",
    wire: { notify: null, commitDistributed: "XA COMMIT 'c'", rollbackDistributed: "XA ROLLBACK 'r'" },
    // XA END goes ahead of XA PREPARE and of XA ROLLBACK.
    distributedEnd: ["XA END 'x'", "XA END 'x'"],
  },
];

// reserved.begin() / beginDistributed() calls that reject before anything is sent.
const rejectedBeforeBegin = [
  {
    name: "begin() with invalid options",
    begin: (reserved: Bun.ReservedSQL) => reserved.begin("read-only", async () => "unreachable"),
    message: "Transaction options can only contain letters, spaces, and commas.",
  },
  {
    name: "beginDistributed() with an invalid name",
    begin: (reserved: Bun.ReservedSQL) => reserved.beginDistributed("bad'name", async () => "unreachable"),
    message: "This adapter doesn't support distributed transactions.",
  },
];

// ---- Which statements of a handle reach the server ----
// One row of `statementsThatReachTheServer` is one scenario on its own mock server: a kind of
// handle, and the state of its scope at the moment the statements are made. One letter of the
// row is one way to make a statement, in the order of `producers`. The letter says what became
// of the statement:
//   S  sent ahead of the statement that ends its scope    r  rejected when it ran, nothing sent
//   L  sent behind it, outside the scope it was made in   c  rejected where it was made (a rejected promise)
//   i  a fragment: nothing sent and nothing rejected      -  not a call of this handle or adapter
//   .  not made in this row
// The last two letters are the statement that ends the scope itself when a scope around it ended
// first (S sent ahead of that end, L sent behind it, r never sent), and the promise of the scope
// (R resolved, E the error of its callback, C closedCode).
type Step = "begin" | "savepoint" | "reserve" | "beginDistributed";
const handleKinds = {
  "transaction": ["begin"],
  "savepoint": ["begin", "savepoint"],
  "nested savepoint": ["begin", "savepoint", "savepoint"],
  "reserved": ["reserve"],
  "transaction on reserved": ["reserve", "begin"],
  "distributed transaction": ["beginDistributed"],
} satisfies Record<string, Step[]>;
type HandleKind = keyof typeof handleKinds;
type ScopeState =
  // its callback is running
  | "open"
  // its callback settled, and the statement that ends it is not handed to the connection yet
  | "callback settled"
  // the server has the statement that ends it and has not answered
  | "end in flight"
  // the statement that ends it is answered, or the reservation is released
  | "ended"
  // the scope around it rolled back, or committed, while its own callback was running
  | "outer rolled back"
  | "outer committed"
  // close({ timeout }) of the outermost handle waits for a scope below it
  | "close waits"
  // close() of the transaction sent ROLLBACK and the server has not answered
  | "close in flight"
  // the server dropped the connection, and the pool has a new one
  | "connection lost";

// [kind, state, the row when the callback of the scope fulfils, the row when it rejects]
// prettier-ignore
const statementsThatReachTheServer: [HandleKind, ScopeState, fulfils: string, rejects?: string][] = [
  ["transaction", "open",              "SSSSSSSSSiiii.R"],
  ["transaction", "callback settled",  "SSSSrSrrriiii.R", "SSSSrSrrriiii.E"],
  ["transaction", "end in flight",     "rrrrrrrrriiii.R", "rrrrrrrrriiii.E"],
  ["transaction", "ended",             "crrrrrrrriici.R", "crrrrrrrriici.E"],
  ["transaction", "close waits",       "cSSSSSrSSiiciSR"],
  ["transaction", "close in flight",   "cr..rrrrriicirC", "cr..rrrrriicirE"],
  ["transaction", "connection lost",   "crrrrrrrriici.C"],

  ["savepoint", "open",                "SSSSSSSSSiiii.R"],
  ["savepoint", "callback settled",    "SSSSrSrrriiii.R", "SSSSrSrrriiii.E"],
  ["savepoint", "end in flight",       "rrrrrrrrriiii.R", "rrrrrrrrriiii.E"],
  ["savepoint", "ended",               "rrrrrrrrriiii.R", "rrrrrrrrriiii.E"],
  ["savepoint", "outer rolled back",   "rrrrrrrrriiiirC", "rrrrrrrrriiiirE"],
  ["savepoint", "outer committed",     "rrrrrrrrriiiirC", "rrrrrrrrriiiirE"],
  ["savepoint", "close waits",         "cSSSSSrSSiiciSR"],
  ["savepoint", "close in flight",     "cr..rrrrriicirC", "cr..rrrrriicirE"],
  ["savepoint", "connection lost",     "crrrrrrrriici.E"],

  ["nested savepoint", "open",              "SSSSSSSSSiiii.R"],
  ["nested savepoint", "callback settled",  "SSSSrSrrriiii.R", "SSSSrSrrriiii.E"],
  ["nested savepoint", "end in flight",     "rrrrrrrrriiii.R", "rrrrrrrrriiii.E"],
  ["nested savepoint", "ended",             "rrrrrrrrriiii.R", "rrrrrrrrriiii.E"],
  ["nested savepoint", "outer rolled back", "rrrrrrrrriiiirC", "rrrrrrrrriiiirE"],
  ["nested savepoint", "outer committed",   "rrrrrrrrriiiirC", "rrrrrrrrriiiirE"],
  ["nested savepoint", "close waits",       "cSSSSSrSSiiciSR"],
  ["nested savepoint", "close in flight",   "cr..rrrrriicirC", "cr..rrrrriicirE"],
  ["nested savepoint", "connection lost",   "crrrrrrrriici.E"],

  ["reserved", "open",                 "SSSSSS-SSiiii.."],
  ["reserved", "ended",                "crrrrr-rriici.."],
  ["reserved", "close waits",          "cSSSSS-SSiici.."],
  ["reserved", "connection lost",      "crrrrr-rriici.."],

  ["transaction on reserved", "open",             "SSSSSSSSSiiii.R"],
  ["transaction on reserved", "callback settled", "SSSSrSrrriiii.R", "SSSSrSrrriiii.E"],
  ["transaction on reserved", "end in flight",    "rrrrrrrrriiii.R", "rrrrrrrrriiii.E"],
  ["transaction on reserved", "ended",            "crrrrrrrriici.R", "crrrrrrrriici.E"],
  ["transaction on reserved", "close waits",      "SSSSSSSSSiiiiSR"],
  ["transaction on reserved", "close in flight",  "cr..rrrrriicirC", "cr..rrrrriicirE"],
  ["transaction on reserved", "connection lost",  "crrrrrrrriici.C"],

  ["distributed transaction", "open",             "SSSSSS-SSiiii.R"],
  ["distributed transaction", "callback settled", "SSSSrS-rriiii.R", "SSSSrS-rriiii.E"],
  ["distributed transaction", "end in flight",    "rrrrrr-rriiii.R", "rrrrrr-rriiii.E"],
  ["distributed transaction", "ended",            "crrrrr-rriici.R", "crrrrr-rriici.E"],
  ["distributed transaction", "close in flight",  "cr..rr-rriicirC", "cr..rr-rriicirE"],
  ["distributed transaction", "connection lost",  "crrrrr-rriici.C"],
];

const isClosedError = (reason: any) => /_CONNECTION_CLOSED$/.test(reason?.code ?? "");
const isNotACall = (reason: any) => /not supported|_INVALID_TRANSACTION_STATE$/.test(reason?.code ?? reason?.message);

// [the call, the statement it puts on the wire (a key of `wire` when the text differs by adapter),
// the letter when the call hands back a promise that is refused]. No statement: a fragment.
const producers: [
  make: (handle: any, early: any[] | null, file: string) => any,
  sent?: string | RegExp,
  refusedAs?: "c" | "r",
][] = [
  [handle => handle`SELECT 'tagged'`, "SELECT 'tagged'", "c"],
  [handle => handle.unsafe("SELECT 'unsafe'"), "SELECT 'unsafe'", "c"],
  // Two queries that were made while the scope was open and first run in the state of the row.
  [(_, early) => early && early[0], "SELECT 'early unsafe'"],
  [(_, early) => early && early[1], "SELECT 'early tagged'"],
  [(handle, _, file) => handle.file(file), "SELECT 'file'", "r"],
  [handle => handle.notify("channel", "payload"), "notify", "c"],
  [handle => handle.savepoint?.(async () => {}, "cell"), /^SAVEPOINT s\d+_cell$/, "r"],
  [handle => handle.commitDistributed("c"), "commitDistributed", "r"],
  [handle => handle.rollbackDistributed("r"), "rollbackDistributed", "r"],
  [handle => handle({ a: 1 })],
  [handle => handle([1, 2])],
  [handle => handle`1 = 1`],
  [handle => handle.unsafe("1 = 1")],
];

// Makes every statement of `producers` on the handle in one synchronous pass and runs it. A cell
// resolves to its letter. "?" is a statement that ran: the wire log decides between S and L.
function makeStatements(handle: any, early: any[] | null, file: string): Promise<string>[] {
  return producers.map(async ([make, sent, refusedAs]) => {
    let made: any;
    try {
      made = make(handle, early, file);
    } catch (err) {
      return isClosedError(err) ? "c" : "!";
    }
    if (made === undefined) return "-";
    if (made === null) return ".";
    const isQuery = typeof made.execute === "function";
    const letter = (err: any) =>
      isClosedError(err) ? (isQuery ? "r" : (refusedAs ?? "c")) : isNotACall(err) ? "-" : "!";
    if (sent === undefined) return isQuery || typeof made.then !== "function" ? "i" : made.then(() => "!", letter);
    if (isQuery) made.execute();
    return Promise.resolve(made).then(() => "?", letter);
  });
}

async function statementsOf(
  { adapter, mockServer, wire, distributedEnd }: Adapter,
  kind: HandleKind,
  state: ScopeState,
  callbackFulfils: boolean,
  file: string,
): Promise<string> {
  const received: Received[] = [];
  const log = () => received.map(entry => entry.sql);
  // The server keeps the answer to a held statement until `gate` resolves. `seen` resolves when it arrives.
  const holds = new Map<string, { seen: PromiseWithResolvers<void>; gate: PromiseWithResolvers<void> }>();
  const hold = (text: string) => {
    const held = { seen: Promise.withResolvers<void>(), gate: Promise.withResolvers<void>() };
    holds.set(text, held);
    return held;
  };
  const { port, server } = await mockServer(received, text => {
    const held = holds.get(text);
    if (!held) return;
    held.seen.resolve();
    return held.gate.promise;
  });
  const sql = new SQL({
    adapter,
    hostname: "127.0.0.1",
    port,
    username: "u",
    password: "p",
    database: "db",
    max: 1,
    tls: false,
    idleTimeout: 5,
  });
  try {
    // close({ timeout }) waits for a scope below the handle it is called on.
    const chain: Step[] = [...handleKinds[kind]];
    if (state === "close waits" && chain.length === 1) chain.push(chain[0] === "reserve" ? "begin" : "savepoint");

    // Every callback parks on a promise that the scenario settles, so a scope can outlive the one around it.
    type Level = {
      step: Step;
      handle: any;
      park: PromiseWithResolvers<void>;
      // The promise of the scope, as its letter.
      done?: Promise<string>;
      // The first statement that ends the scope when its callback fulfils, and when it rejects.
      end?: readonly [string, string];
      settled: boolean;
    };
    const levels: Level[] = [];
    for (const step of chain) {
      const level: Level = { step, handle: undefined, park: Promise.withResolvers<void>(), settled: false };
      if (step === "reserve") {
        level.handle = await sql.reserve();
      } else {
        const entered = Promise.withResolvers<void>();
        const callback = (handle: any) => {
          level.handle = handle;
          entered.resolve();
          return level.park.promise;
        };
        const outer: any = levels.at(-1)?.handle ?? sql;
        const scope: Promise<unknown> =
          step === "beginDistributed" ? sql.beginDistributed("x", callback) : outer[step](callback);
        level.done = scope.then(
          () => "R",
          err => (isClosedError(err) ? "C" : err.message === "callback failed" ? "E" : "!"),
        );
        await entered.promise;
        const savepoint = ` SAVEPOINT s${levels.filter(above => above.step === "savepoint").length}`;
        level.end = (
          {
            begin: ["COMMIT", "ROLLBACK"],
            savepoint: [`RELEASE${savepoint}`, `ROLLBACK TO${savepoint}`],
            beginDistributed: distributedEnd,
          } as const
        )[step];
      }
      levels.push(level);
    }
    // Ends a scope: its callback fulfils or rejects, a reservation is released.
    const settle = (level: Level, fulfils: boolean) => {
      level.settled = true;
      if (level.step === "reserve") return level.handle.release();
      if (fulfils) level.park.resolve();
      else level.park.reject(new Error("callback failed"));
      return level.done;
    };
    const target = levels[handleKinds[kind].length - 1];
    const outer = levels[handleKinds[kind].length - 2];
    const transaction = levels.find(level => level.step.startsWith("begin"))!;
    const ownEnd = target.end?.[callbackFulfils ? 0 : 1];
    // close() cancels a query that never ran, and a cancelled query never settles.
    const early =
      state === "close in flight"
        ? null
        : [target.handle.unsafe("SELECT 'early unsafe'"), target.handle`SELECT 'early tagged'`];
    // A handler that does not start the query.
    for (const query of early ?? []) Promise.prototype.then.call(query, undefined, () => {});
    const make = () => makeStatements(target.handle, early, file);

    let cells!: Promise<string>[];
    // A statement at or behind this index of the wire log is late.
    let lateFrom = Infinity;
    let ownEndLetter = ".";
    const ownEndBehind = (from: number) => (log().indexOf(ownEnd!, from) < 0 ? "r" : "L");

    if (state === "open") {
      await Promise.all((cells = make()));
    } else if (state === "callback settled") {
      // This reaction runs behind the one of the runner, so the runner has made the statement that
      // ends the scope. A query reaches the connection two microtasks after it is made.
      const react = () => void (cells = make());
      target.park.promise.then(react, react);
      await settle(target, callbackFulfils);
      lateFrom = log().indexOf(ownEnd!);
    } else if (state === "end in flight") {
      const { seen, gate } = hold(ownEnd!);
      const done = settle(target, callbackFulfils);
      await seen.promise;
      cells = make();
      gate.resolve();
      await done;
      lateFrom = log().indexOf(ownEnd!);
    } else if (state === "ended") {
      await settle(target, callbackFulfils);
      lateFrom = received.length;
      cells = make();
    } else if (state === "outer rolled back" || state === "outer committed") {
      const { seen, gate } = hold(outer.end![state === "outer committed" ? 0 : 1]);
      const outerDone = settle(outer, state === "outer committed");
      await seen.promise;
      lateFrom = received.length;
      cells = make();
      const done = settle(target, callbackFulfils);
      gate.resolve();
      await Promise.all([outerDone, done]);
      ownEndLetter = ownEndBehind(lateFrom);
    } else if (state === "close waits") {
      const closing = levels[0].handle.close({ timeout: 60 });
      await Promise.all((cells = make()));
      for (const level of levels.slice(1).reverse()) await settle(level, true);
      await closing;
      await settle(target, true);
      if (ownEnd) ownEndLetter = log().includes(ownEnd) ? "S" : "r";
    } else if (state === "close in flight") {
      const { seen, gate } = hold(transaction.end![1]);
      const closing = transaction.handle.close();
      await seen.promise;
      lateFrom = received.length;
      cells = make();
      gate.resolve();
      await closing;
      await settle(target, callbackFulfils);
      ownEndLetter = ownEndBehind(lateFrom);
    } else {
      state satisfies "connection lost";
      await target.handle.unsafe("SELECT 'KILL'").then(
        () => {},
        () => {},
      );
      for (const level of [...levels].reverse()) await settle(level, false);
      await sql.unsafe("SELECT 'revive'");
      lateFrom = received.length;
      cells = make();
    }
    const letters = await Promise.all(cells);
    for (const level of [...levels].reverse()) if (!level.settled) await settle(level, true);
    const sent = log();
    const row = letters.map((letter, i) => {
      const text = producers[i][1];
      const statement = typeof text === "string" && text in wire ? wire[text as keyof typeof wire] : text;
      const at = statement
        ? sent.findIndex(entry => (typeof statement === "string" ? entry === statement : statement.test(entry)))
        : -1;
      if (at < 0) return letter === "?" ? "!" : letter;
      return at < lateFrom ? "S" : "L";
    });
    return row.join("") + ownEndLetter + ((await target.done) ?? ".");
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe.each(adapters)("$adapter", entry => {
  const { adapter, mockServer, beginCommand, closedCode } = entry;
  const options = (port: number): Bun.SQL.Options => ({
    adapter,
    hostname: "127.0.0.1",
    port,
    username: "u",
    password: "p",
    database: "db",
    max: 1,
    tls: false,
    idleTimeout: 5,
  });

  test("concurrent sql.begin() stays serialized after a server-side disconnect with queries in flight", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      await sql.unsafe("SELECT 'warm'");

      // Two queries are bound to the slot when the server drops it.
      const die1 = sql.unsafe("SELECT 'KILL'").execute();
      const die2 = sql.unsafe("SELECT 'never sent'").execute();
      const [e1, e2] = await Promise.all([
        die1.then(
          () => null,
          e => e,
        ),
        die2.then(
          () => null,
          e => e,
        ),
      ]);
      expect(e1).toBeInstanceOf(Error);
      expect(e2).toBeInstanceOf(Error);

      await sql.unsafe("SELECT 'revive'");

      const pa = sql.unsafe("SELECT 'Pa'").execute();
      const pb = sql.unsafe("SELECT 'Pb'").execute();
      const t1 = sql.begin(async tx => {
        await tx.unsafe("SELECT 'T1a'");
        await tx.unsafe("SELECT 'T1b'");
        return "t1";
      });
      const t2 = sql.begin(async tx => {
        await tx.unsafe("SELECT 'T2a'");
        throw new Error("t2-app-error");
      });
      const t3 = sql.begin(async tx => {
        await tx.unsafe("SELECT 'T3a'");
        await tx.unsafe("SELECT 'T3b'");
        return "t3";
      });

      const results = await Promise.allSettled([pa, pb, t1, t2, t3]);

      expect(results[2]).toEqual({ status: "fulfilled", value: "t1" });
      expect(results[3].status).toBe("rejected");
      expect((results[3] as PromiseRejectedResult).reason?.message).toBe("t2-app-error");
      expect(results[4]).toEqual({ status: "fulfilled", value: "t3" });

      expect(firstInterleaving(received)).toBeNull();
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("a pool slot is reusable after a server-side disconnect during sql.reserve()", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const err = await (async () => {
        await using r = await sql.reserve();
        await r.unsafe("SELECT 'KILL'");
      })().then(
        () => null,
        e => e,
      );
      expect(err).toBeInstanceOf(Error);

      await sql.unsafe("SELECT 'revive'");
      const t1 = await sql.begin(async tx => {
        await tx.unsafe("SELECT 'T1a'");
        return "t1";
      });
      expect(t1).toBe("t1");
      expect(firstInterleaving(received)).toBeNull();
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("a pool slot is reusable after sql.reserve() is closed explicitly", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const r = await sql.reserve();
      await r.unsafe("SELECT 'inside'");
      await r.close();

      const t1 = await sql.begin(async tx => {
        await tx.unsafe("SELECT 'T1a'");
        return "t1";
      });
      expect(t1).toBe("t1");
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("concurrent sql.begin() stays serialized after a server-side disconnect during a transaction", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      await sql.unsafe("SELECT 'warm'");

      const err = await sql
        .begin(async tx => {
          await tx.unsafe("SELECT 'KILL'");
        })
        .catch(e => e);
      expect(err).toBeInstanceOf(Error);

      await sql.unsafe("SELECT 'revive'");

      const pa = sql.unsafe("SELECT 'Pa'").execute();
      const t1 = sql.begin(async tx => {
        await tx.unsafe("SELECT 'T1a'");
        await tx.unsafe("SELECT 'T1b'");
        return "t1";
      });
      const t2 = sql.begin(async tx => {
        await tx.unsafe("SELECT 'T2a'");
        return "t2";
      });

      const results = await Promise.allSettled([pa, t1, t2]);
      expect(results[1]).toEqual({ status: "fulfilled", value: "t1" });
      expect(results[2]).toEqual({ status: "fulfilled", value: "t2" });

      expect(firstInterleaving(received)).toBeNull();
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // A transaction started on a reserved connection runs on the reservation's own
  // slot. When it rejects before BEGIN is sent, the slot has to stay with the
  // reservation. bun:test also fails these tests if the rejected begin() leaves an
  // unhandled rejection behind.
  test.each(rejectedBeforeBegin)(
    "the reservation keeps its pool slot after reserved $name rejects",
    async ({ begin, message }) => {
      const received: Received[] = [];
      const { port, server } = await mockServer(received);
      const sql = new SQL(options(port));
      try {
        const reserved = await sql.reserve();
        const err = await begin(reserved).then(
          () => null,
          e => e,
        );
        expect(err?.message).toBe(message);

        // The reservation holds the pool's only slot, so this has to wait for release().
        const t1 = sql.begin(async tx => {
          await tx.unsafe("SELECT 'T1a'");
          return "t1";
        });
        await reserved.unsafe("SELECT 'R1'");
        await reserved.unsafe("SELECT 'R2'");
        expect(received).toEqual([
          { conn: 0, sql: "SELECT 'R1'" },
          { conn: 0, sql: "SELECT 'R2'" },
        ]);

        reserved.release();
        expect(await t1).toBe("t1");

        // release() brought the slot back to zero queries, so it can be reserved again.
        const reservedAgain = await sql.reserve();
        await reservedAgain.unsafe("SELECT 'R3'");
        reservedAgain.release();

        expect(received).toEqual([
          { conn: 0, sql: "SELECT 'R1'" },
          { conn: 0, sql: "SELECT 'R2'" },
          { conn: 0, sql: beginCommand },
          { conn: 0, sql: "SELECT 'T1a'" },
          { conn: 0, sql: "COMMIT" },
          { conn: 0, sql: "SELECT 'R3'" },
        ]);
      } finally {
        await sql.close({ timeout: 0 }).catch(() => {});
        await new Promise<void>(r => server.close(() => r()));
      }
    },
  );

  test("reserved.close({ timeout }) waits for a transaction started on the reservation", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const t1 = reserved.begin(async tx => {
        await tx.unsafe("SELECT 'T1a'");
        return "t1";
      });
      // The timeout is in seconds. close() resolves as soon as t1 settles; without the
      // transaction being tracked it would close the connection under t1 instead.
      const closed = reserved.close({ timeout: 60 });
      expect(await t1).toBe("t1");
      await closed;
      reserved.release();
      expect(received).toEqual([
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'T1a'" },
        { conn: 0, sql: "COMMIT" },
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // Same overlap with a transaction that fails. close() must wait for the ROLLBACK, and
  // the failure is the caller's to handle: bun:test fails this test if close()'s wait
  // reports it as an unhandled rejection as well.
  test("reserved.close({ timeout }) waits for a failing transaction without reporting its handled error", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const failing = reserved
        .begin(async tx => {
          await tx.unsafe("SELECT 'T1a'");
          throw new Error("t1-app-error");
        })
        .catch(err => err.message);
      const closed = reserved.close({ timeout: 60 });
      expect(await failing).toBe("t1-app-error");
      await closed;
      reserved.release();
      expect(received).toEqual([
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'T1a'" },
        { conn: 0, sql: "ROLLBACK" },
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // A statement that runs while COMMIT or ROLLBACK is in flight would be written behind it on
  // the same connection, and the server would run it outside the transaction.
  test.each(["COMMIT", "ROLLBACK"])(
    "a statement sent while %s is in flight is rejected and never reaches the server",
    async end => {
      const received: Received[] = [];
      const endReceived = Promise.withResolvers<void>();
      const endAnswer = Promise.withResolvers<void>();
      const { port, server } = await mockServer(received, sql => {
        if (sql !== end) return;
        endReceived.resolve();
        return endAnswer.promise;
      });
      const sql = new SQL(options(port));
      try {
        // Settles to null when the late statement runs, or to its rejection error.
        let late!: Promise<any>;
        const begun = sql
          .begin(async tx => {
            await tx.unsafe("SELECT 'T1a'");
            late = endReceived.promise
              .then(() => tx`SELECT 'late'`)
              .then(
                () => null,
                err => err,
              );
            if (end === "ROLLBACK") throw new Error("t1-app-error");
            return "t1";
          })
          .then(
            value => value,
            err => err.message,
          );
        await endReceived.promise;
        endAnswer.resolve();
        expect(await begun).toBe(end === "ROLLBACK" ? "t1-app-error" : "t1");
        const lateError = await late;
        expect(received).toEqual([
          { conn: 0, sql: beginCommand },
          { conn: 0, sql: "SELECT 'T1a'" },
          { conn: 0, sql: end },
        ]);
        expect(lateError?.code).toBe(closedCode);
      } finally {
        await sql.close({ timeout: 0 }).catch(() => {});
        await new Promise<void>(r => server.close(() => r()));
      }
    },
  );

  // tx.close() rolls the transaction back. Behind COMMIT or ROLLBACK of the runner there is
  // nothing left to roll back, and a ROLLBACK of its own would follow the end of the transaction.
  test.each(["COMMIT", "ROLLBACK"])("tx.close() while %s is in flight sends no ROLLBACK of its own", async end => {
    const received: Received[] = [];
    const endReceived = Promise.withResolvers<void>();
    const endAnswer = Promise.withResolvers<void>();
    const { port, server } = await mockServer(received, sql => {
      if (sql !== end) return;
      endReceived.resolve();
      return endAnswer.promise;
    });
    const sql = new SQL(options(port));
    try {
      let handle!: Bun.TransactionSQL;
      const begun = sql
        .begin(async tx => {
          handle = tx;
          await tx.unsafe("SELECT 'T1a'");
          if (end === "ROLLBACK") throw new Error("t1-app-error");
          return "t1";
        })
        .then(
          value => value,
          err => err.message,
        );
      await endReceived.promise;
      const closed = handle.close();
      endAnswer.resolve();
      expect(await begun).toBe(end === "ROLLBACK" ? "t1-app-error" : "t1");
      await closed;
      expect(received.map(entry => entry.sql)).toEqual([beginCommand, "SELECT 'T1a'", end]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // handle(row) builds a fragment for a later query. On a handle that no longer accepts
  // queries it has to stay a fragment: a rejected promise in its place is one that the
  // query it is part of never awaits, and bun:test fails this test if one is reported.
  test("a fragment built on a settled or released handle is not a rejected promise", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      let tx!: Bun.TransactionSQL;
      await sql.begin(async handle => {
        tx = handle;
        await handle.unsafe("SELECT 'T1a'");
      });
      const reserved = await sql.reserve();
      reserved.release();

      const results = await Promise.all(
        [tx, reserved].map(handle => {
          const fragment = handle({ v: "late" });
          expect(typeof (fragment as any).then).toBe("undefined");
          return handle`INSERT INTO t ${fragment}`.then(
            () => null,
            err => err.code,
          );
        }),
      );
      expect(results).toEqual([closedCode, closedCode]);
      expect(received).toEqual([
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'T1a'" },
        { conn: 0, sql: "COMMIT" },
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // The tasks of a Promise.all go on after one of them failed. Behind ROLLBACK TO SAVEPOINT
  // their statements would belong to the transaction, and COMMIT would keep them.
  test("a statement of a rolled-back savepoint does not reach the server behind ROLLBACK TO SAVEPOINT", async () => {
    const received: Received[] = [];
    const rolledBack = Promise.withResolvers<void>();
    const { port, server } = await mockServer(received, sql => {
      if (sql === "ROLLBACK TO SAVEPOINT s0") rolledBack.resolve();
    });
    const sql = new SQL(options(port));
    try {
      const tasks: Promise<string>[] = [];
      await sql.begin(async tx => {
        await tx.unsafe("SELECT 'outer'");
        const savepoint = tx.savepoint(sp =>
          Promise.all(
            ["a", "b"].map(item => {
              const task = (async () => {
                await sp.unsafe(`SELECT '${item}1'`);
                if (item === "a") throw new Error("item a is invalid");
                await rolledBack.promise;
                await sp.unsafe(`SELECT '${item}2'`);
              })();
              tasks.push(
                task.then(
                  () => "resolved",
                  err => err.code ?? err.message,
                ),
              );
              return task;
            }),
          ),
        );
        expect(await savepoint.catch(err => err.message)).toBe("item a is invalid");
        expect(await Promise.all(tasks)).toEqual(["item a is invalid", closedCode]);
        await tx.unsafe("SELECT 'after'");
      });
      expect(received.map(entry => entry.sql)).toEqual([
        beginCommand,
        "SELECT 'outer'",
        "SAVEPOINT s0",
        "SELECT 'a1'",
        "SELECT 'b1'",
        "ROLLBACK TO SAVEPOINT s0",
        "SELECT 'after'",
        "COMMIT",
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // A savepoint that runs beside another task can settle after the transaction ended. Its own
  // RELEASE SAVEPOINT or ROLLBACK TO SAVEPOINT would reach the server behind COMMIT or ROLLBACK.
  // Behind a ROLLBACK that failed, ROLLBACK TO SAVEPOINT turns the failed transaction into an open one.
  test.each(["COMMIT", "ROLLBACK"])(
    "a savepoint that settles behind %s of its transaction sends no statement of its own",
    async end => {
      const received: Received[] = [];
      const endReceived = Promise.withResolvers<void>();
      const endAnswer = Promise.withResolvers<void>();
      const { port, server } = await mockServer(received, sql => {
        if (sql !== end) return;
        endReceived.resolve();
        return endAnswer.promise;
      });
      const sql = new SQL(options(port));
      try {
        let savepoint!: Promise<string>;
        const begun = sql
          .begin(async tx => {
            const inSavepoint = Promise.withResolvers<void>();
            savepoint = tx
              .savepoint(async sp => {
                await sp.unsafe("SELECT 'in savepoint'");
                inSavepoint.resolve();
                await endReceived.promise;
                if (end === "ROLLBACK") throw new Error("savepoint-app-error");
              })
              .then(
                () => "released",
                err => err.code ?? err.message,
              );
            await inSavepoint.promise;
            if (end === "ROLLBACK") throw new Error("t1-app-error");
            return "t1";
          })
          .then(
            value => value,
            err => err.message,
          );
        await endReceived.promise;
        endAnswer.resolve();
        expect(await begun).toBe(end === "ROLLBACK" ? "t1-app-error" : "t1");
        expect(await savepoint).toBe(end === "ROLLBACK" ? "savepoint-app-error" : closedCode);
        expect(received.map(entry => entry.sql)).toEqual([beginCommand, "SAVEPOINT s0", "SELECT 'in savepoint'", end]);
      } finally {
        await sql.close({ timeout: 0 }).catch(() => {});
        await new Promise<void>(r => server.close(() => r()));
      }
    },
  );

  // With max: 1 the next sql.begin() gets the connection of the transaction that just ended. A
  // statement of the ended transaction would run inside it, and commit or roll back with it.
  test("a statement of an ended transaction does not run inside the next transaction on its connection", async () => {
    using dir = tempDir("sql-ended-transaction", { "statement.sql": "SELECT 'file'" });
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      let ended!: Bun.TransactionSQL;
      let early!: Bun.SQL.Query<unknown>;
      await sql.begin(async tx => {
        ended = tx;
        // A query is lazy. This one is made inside the transaction and first awaited after it.
        early = tx.unsafe("SELECT 'made in T1'");
        await tx.unsafe("SELECT 'T1a'");
      });
      const code = (statement: PromiseLike<unknown>) =>
        statement.then(
          () => "resolved",
          err => err.code,
        );
      const late = await sql.begin(async tx => {
        await tx.unsafe("SELECT 'T2a'");
        const late = [
          await code(early),
          await code(ended.unsafe("SELECT 'unsafe'")),
          await code(ended.unsafe("SELECT 'values'").values()),
          await code(ended.file(join(String(dir), "statement.sql"))),
        ];
        await tx.unsafe("SELECT 'T2b'");
        return late;
      });
      expect(late).toEqual([closedCode, closedCode, closedCode, closedCode]);
      expect(received.map(entry => entry.sql)).toEqual([
        beginCommand,
        "SELECT 'T1a'",
        "COMMIT",
        beginCommand,
        "SELECT 'T2a'",
        "SELECT 'T2b'",
        "COMMIT",
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("a statement of a reserved handle does not run on the connection after release()", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      await reserved.unsafe("SELECT 'reserved'");
      const early = reserved.unsafe("SELECT 'made before release()'");
      reserved.release();
      const code = (statement: PromiseLike<unknown>) =>
        statement.then(
          () => "resolved",
          err => err.code,
        );
      expect([await code(early), await code(reserved.unsafe("SELECT 'unsafe'"))]).toEqual([closedCode, closedCode]);
      await sql.unsafe("SELECT 'pool'");
      expect(received.map(entry => entry.sql)).toEqual(["SELECT 'reserved'", "SELECT 'pool'"]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("the queries of an array that a savepoint callback returns run ahead of RELEASE SAVEPOINT", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      await sql.begin(tx => tx.savepoint(sp => [sp.unsafe("SELECT 'sp1'"), sp.unsafe("SELECT 'sp2'")]));
      expect(received.map(entry => entry.sql)).toEqual([
        beginCommand,
        "SAVEPOINT s0",
        "SELECT 'sp1'",
        "SELECT 'sp2'",
        "RELEASE SAVEPOINT s0",
        "COMMIT",
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // These statements reach the connection ahead of COMMIT and of RELEASE SAVEPOINT, so they belong
  // to the scope and must keep running. A scope that refused statements from the moment its
  // callback settled would drop them.
  test("a statement that nothing awaits still runs when it goes out ahead of the end of its scope", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      await sql.begin(async tx => {
        ["a", "b"].forEach(async item => {
          await tx.unsafe(`SELECT 'transaction ${item}'`);
        });
      });
      await sql.begin(async tx => {
        await tx.savepoint(async sp => {
          ["a", "b"].forEach(async item => {
            await sp.unsafe(`SELECT 'savepoint ${item}'`);
          });
        });
      });
      expect(received.map(entry => entry.sql)).toEqual([
        beginCommand,
        "SELECT 'transaction a'",
        "SELECT 'transaction b'",
        "COMMIT",
        beginCommand,
        "SAVEPOINT s0",
        "SELECT 'savepoint a'",
        "SELECT 'savepoint b'",
        "RELEASE SAVEPOINT s0",
        "COMMIT",
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // Every way to make a statement on a handle, in every state of the scope of the handle.
  // The legend is at `statementsThatReachTheServer`.
  test.each(statementsThatReachTheServer.map(([kind, state, fulfils, rejects]) => ({ kind, state, fulfils, rejects })))(
    "a $kind handle, $state: a statement is sent only ahead of the statement that ends its scope",
    async ({ kind, state, fulfils, rejects }) => {
      using dir = tempDir("sql-statements-of-a-handle", { "statement.sql": "SELECT 'file'" });
      const file = join(String(dir), "statement.sql");
      // notify() is PostgreSQL only.
      const expected = (row: string) => (entry.wire.notify ? row : row.slice(0, 5) + "-" + row.slice(6));
      const [whenItFulfils, whenItRejects] = await Promise.all([
        statementsOf(entry, kind, state, true, file),
        rejects && statementsOf(entry, kind, state, false, file),
      ]);
      expect({ "callback fulfils": whenItFulfils, "callback rejects": whenItRejects }).toEqual({
        "callback fulfils": expected(fulfils),
        "callback rejects": rejects && expected(rejects),
      });
    },
  );

  // Runs in a child process: bun:test would turn any unhandled rejection into a test
  // failure, and the second half of this contract is that one rejection IS reported.
  test("a rejected reserved begin() is reported as unhandled only when the caller ignores it", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const reported = [];
            process.on("unhandledRejection", err => reported.push(err.message));
            const sql = new Bun.SQL(${JSON.stringify(options(port))});
            const reserved = await sql.reserve();
            const handled = await reserved
              .begin(async () => {
                throw new Error("handled by the caller");
              })
              .catch(err => err.message);
            reserved.begin("read-only", async () => {});
            await reserved.unsafe("SELECT 'still reserved'");
            reserved.release();
            await sql.close();
            console.log(JSON.stringify({ handled, reported }));
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        handled: "handled by the caller",
        reported: ["Transaction options can only contain letters, spaces, and commas."],
      });
      expect(exitCode).toBe(0);
      expect(received).toEqual([
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "ROLLBACK" },
        { conn: 0, sql: "SELECT 'still reserved'" },
      ]);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});
