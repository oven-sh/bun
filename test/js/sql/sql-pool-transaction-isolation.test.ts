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
  mysqlErrPacket,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgErrorResponse,
  pgNoData,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
} from "./wire-frames";

type Received = { conn: number; sql: string };
// `hold` can delay the answer to a statement, and "error" makes the answer to a simple query an
// error. Answers keep the order of the statements.
type Hold = (sql: string) => Promise<void | "error"> | void | "error";
type MockServer = (received: Received[], hold?: Hold) => Promise<{ port: number; server: net.Server }>;

function answerInOrder(hold: Hold | undefined) {
  let chain = Promise.resolve();
  return (sql: string, answer: () => void, refuse: () => void = answer) => {
    if (!hold) return answer();
    chain = chain.then(() => hold(sql)).then(verdict => (verdict === "error" ? refuse() : answer()));
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
        answer(
          sql,
          () => socket.write(Buffer.concat([pgCommandComplete("SELECT 0"), pgReadyForQuery()])),
          () =>
            socket.write(
              Buffer.concat([pgErrorResponse({ S: "ERROR", C: "XX000", M: `refused: ${sql}` }), pgReadyForQuery("E")]),
            ),
        );
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
          answer(
            sql,
            () => socket.write(mysqlOkPacket(1)),
            () => socket.write(mysqlErrPacket(1, 1105, "HY000", `refused: ${sql}`)),
          );
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
  // The error of a statement on a client whose connection closed, and on one whose transaction or savepoint ended.
  closedCode: string;
  endedCode: string;
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
    endedCode: "ERR_POSTGRES_INVALID_TRANSACTION_STATE",
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
    endedCode: "ERR_MYSQL_INVALID_TRANSACTION_STATE",
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
//   S  sent, and not behind the statement that ended its scope
//   L  sent behind the statement that ended its scope
//   e  rejected when it ran, nothing sent: its transaction or savepoint ended (endedCode)
//   r  the same, with the error of a closed connection (closedCode)
//   d  rejected where it was made (a rejected promise): its transaction or savepoint ended
//   c  the same, with the error of a closed connection
//   i  a fragment: nothing sent and nothing rejected
//   -  not a call of this handle or adapter           .  not made, or not a part of the row
// COMMIT and ROLLBACK end a transaction, ROLLBACK TO SAVEPOINT ends a savepoint, release() and
// close() end a reservation. RELEASE SAVEPOINT ends nothing: the savepoint becomes a part of the
// scope around it, and its handle goes on as a handle of that scope.
// The last two letters are the statement that the runner of the scope sends when its callback
// settles, in the rows where something around the scope happened first (S, L as above, r never
// sent), and the promise of the scope (R resolved, E the error of its callback, C closedCode,
// D endedCode).
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
  // the scope around it rolled back while its own callback was running
  | "outer rolled back"
  // the scope around it committed, or was released (a savepoint, a reservation), in that time
  | "outer completed"
  // close({ timeout }) of the outermost handle waits for a scope below it. How the scopes end after
  // that is not a part of the row.
  | "close waits"
  // close() of the transaction sent ROLLBACK and the server has not answered
  | "close in flight"
  // the same ROLLBACK, sent by the timer of close({ timeout })
  | "close timed out"
  // the server dropped the connection, and the pool has a new one
  | "connection lost";

// [kind, state, the row when the callback of the scope fulfils, the row when it rejects]
// prettier-ignore
const statementsThatReachTheServer: [HandleKind, ScopeState, fulfils: string, rejects?: string][] = [
  ["transaction", "open",             "SSSSSSSSSiiii.R"],
  ["transaction", "callback settled", "SSSSeSeeeiiii.R", "SSSSeSeeeiiii.E"],
  ["transaction", "end in flight",    "eeeeeeeeeiiii.R", "eeeeeeeeeiiii.E"],
  ["transaction", "ended",            "deeeeeeeeiidi.R", "deeeeeeeeiidi.E"],
  ["transaction", "close waits",      "cSSSSSrSSiici..", "cSSSSSrSSiici.."],
  ["transaction", "close in flight",  "de..eeeeeiidirC", "de..eeeeeiidirE"],
  ["transaction", "close timed out",  "de..eeeeeiidirC", "de..eeeeeiidirE"],
  ["transaction", "connection lost",  "crrrrrrrriici.C"],

  ["savepoint", "open",               "SSSSSSSSSiiii.R"],
  ["savepoint", "callback settled",   "SSSSSSSSSiiii.R", "SSSSeSeeeiiii.E"],
  ["savepoint", "end in flight",      "SSSSSSSSSiiii.R", "eeeeeeeeeiiii.E"],
  ["savepoint", "ended",              "SSSSSSSSSiiii.R", "eeeeeeeeeiiii.E"],
  ["savepoint", "outer rolled back",  "eeeeeeeeeiiiirD", "eeeeeeeeeiiiirE"],
  ["savepoint", "outer completed",    "eeeeeeeeeiiiirD", "eeeeeeeeeiiiirE"],
  ["savepoint", "close waits",        "cSSSSSrSSiici..", "cSSSSSrSSiici.."],
  ["savepoint", "close in flight",    "de..eeeeeiidirD", "de..eeeeeiidirE"],
  ["savepoint", "close timed out",    "de..eeeeeiidirD", "de..eeeeeiidirE"],
  ["savepoint", "connection lost",    "crrrrrrrriici.E"],

  ["nested savepoint", "open",               "SSSSSSSSSiiii.R"],
  ["nested savepoint", "callback settled",   "SSSSSSSSSiiii.R", "SSSSeSeeeiiii.E"],
  ["nested savepoint", "end in flight",      "SSSSSSSSSiiii.R", "eeeeeeeeeiiii.E"],
  ["nested savepoint", "ended",              "SSSSSSSSSiiii.R", "eeeeeeeeeiiii.E"],
  ["nested savepoint", "outer rolled back",  "eeeeeeeeeiiiirD", "eeeeeeeeeiiiirE"],
  ["nested savepoint", "outer completed",    "SSSSSSSSSiiiiSR", "SSSSeSSSSiiiiSE"],
  ["nested savepoint", "close waits",        "cSSSSSrSSiici..", "cSSSSSrSSiici.."],
  ["nested savepoint", "close in flight",    "de..eeeeeiidirD", "de..eeeeeiidirE"],
  ["nested savepoint", "close timed out",    "de..eeeeeiidirD", "de..eeeeeiidirE"],
  ["nested savepoint", "connection lost",    "crrrrrrrriici.E"],

  ["reserved", "open",               "SSSSSS-SSiiii.."],
  ["reserved", "ended",              "crrrrr-rriici.."],
  ["reserved", "close waits",        "cSSSSS-SSiici.."],
  ["reserved", "connection lost",    "crrrrr-rriici.."],

  ["transaction on reserved", "open",             "SSSSSSSSSiiii.R"],
  ["transaction on reserved", "callback settled", "SSSSeSeeeiiii.R", "SSSSeSeeeiiii.E"],
  ["transaction on reserved", "end in flight",    "eeeeeeeeeiiii.R", "eeeeeeeeeiiii.E"],
  ["transaction on reserved", "ended",            "deeeeeeeeiidi.R", "deeeeeeeeiidi.E"],
  ["transaction on reserved", "outer completed",  "SSSSeSSSSiiiiSR", "SSSSeSSSSiiiiSE"],
  ["transaction on reserved", "close waits",      "SSSSSSSSSiiii..", "SSSSSSSSSiiii.."],
  ["transaction on reserved", "close in flight",  "de..eeeeeiidirC", "de..eeeeeiidirE"],
  ["transaction on reserved", "close timed out",  "de..eeeeeiidirC", "de..eeeeeiidirE"],
  ["transaction on reserved", "connection lost",  "crrrrrrrriici.C"],

  ["distributed transaction", "open",             "SSSSSS-SSiiii.R"],
  ["distributed transaction", "callback settled", "SSSSeS-eeiiii.R", "SSSSeS-eeiiii.E"],
  ["distributed transaction", "end in flight",    "eeeeee-eeiiii.R", "eeeeee-eeiiii.E"],
  ["distributed transaction", "ended",            "deeeee-eeiidi.R", "deeeee-eeiidi.E"],
  ["distributed transaction", "close in flight",  "de..ee-eeiidirC", "de..ee-eeiidirE"],
  ["distributed transaction", "connection lost",  "crrrrr-rriici.C"],
];

const isClosedError = (reason: any) => /_CONNECTION_CLOSED$/.test(reason?.code ?? "");
const isEndedError = (reason: any) =>
  /_INVALID_TRANSACTION_STATE$/.test(reason?.code ?? "") && /ended$/.test(reason?.message ?? "");
const isNotACall = (reason: any) => /not supported|_INVALID_TRANSACTION_STATE$/.test(reason?.code ?? reason?.message);
// The letter of a refusal. `closed` is the letter for the error of a closed connection.
const refusal = (reason: any, closed: "c" | "r") =>
  isEndedError(reason) ? (closed === "c" ? "d" : "e") : isClosedError(reason) ? closed : isNotACall(reason) ? "-" : "!";

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
      return refusal(err, "c");
    }
    if (made === undefined) return "-";
    if (made === null) return ".";
    const isQuery = typeof made.execute === "function";
    const letter = (err: any) => refusal(err, isQuery ? "r" : (refusedAs ?? "c"));
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
    if (state === "close timed out" && chain.at(-1) === "begin") chain.push("savepoint");

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
          err => (isEndedError(err) ? "D" : isClosedError(err) ? "C" : err.message === "callback failed" ? "E" : "!"),
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
      state === "close in flight" || state === "close timed out"
        ? null
        : [target.handle.unsafe("SELECT 'early unsafe'"), target.handle`SELECT 'early tagged'`];
    // A handler that does not start the query.
    for (const query of early ?? []) Promise.prototype.then.call(query, undefined, () => {});
    const make = () => makeStatements(target.handle, early, file);

    let cells!: Promise<string>[];
    // A statement at or behind this index of the wire log is late.
    let lateFrom = Infinity;
    let ownEndLetter = ".";
    // The statement at the end of the target's callback ends its scope, but for RELEASE SAVEPOINT.
    const ownEndEnds = target.step !== "savepoint" || !callbackFulfils;
    const ownEndSince = (from: number) =>
      from === Infinity ? (log().includes(ownEnd!) ? "S" : "r") : log().indexOf(ownEnd!, from) < 0 ? "r" : "L";

    if (state === "open") {
      await Promise.all((cells = make()));
    } else if (state === "callback settled") {
      // This reaction runs behind the one of the runner, so the runner has made the statement that
      // ends the scope. A query reaches the connection two microtasks after it is made.
      const react = () => void (cells = make());
      target.park.promise.then(react, react);
      await settle(target, callbackFulfils);
      if (ownEndEnds) lateFrom = log().indexOf(ownEnd!);
    } else if (state === "end in flight") {
      const { seen, gate } = hold(ownEnd!);
      const done = settle(target, callbackFulfils);
      await seen.promise;
      cells = make();
      gate.resolve();
      await done;
      if (ownEndEnds) lateFrom = log().indexOf(ownEnd!);
    } else if (state === "ended") {
      await settle(target, callbackFulfils);
      if (ownEndEnds) lateFrom = received.length;
      cells = make();
    } else if (state === "outer rolled back" || state === "outer completed") {
      const outerFulfils = state === "outer completed";
      // A reservation has no statement at its end: release() leaves the connection to its transaction.
      const held = outer.end && hold(outer.end[outerFulfils ? 0 : 1]);
      const outerDone = settle(outer, outerFulfils);
      await held?.seen.promise;
      if (outer.step.startsWith("begin") || (outer.step === "savepoint" && !outerFulfils)) lateFrom = received.length;
      cells = make();
      const done = settle(target, callbackFulfils);
      held?.gate.resolve();
      await Promise.all([outerDone, done]);
      ownEndLetter = ownEndSince(lateFrom);
    } else if (state === "close waits") {
      const closing = levels[0].handle.close({ timeout: 60 });
      await Promise.all((cells = make()));
      for (const level of levels.slice(1).reverse()) await settle(level, level !== target || callbackFulfils);
      await closing;
      await settle(target, callbackFulfils);
    } else if (state === "close in flight" || state === "close timed out") {
      const { seen, gate } = hold(transaction.end![1]);
      // The timer of close({ timeout }) starts when there is a scope below the transaction to wait for.
      const closing = transaction.handle.close(state === "close timed out" ? { timeout: 0.001 } : undefined);
      await seen.promise;
      lateFrom = received.length;
      cells = make();
      gate.resolve();
      await closing;
      await settle(target, callbackFulfils);
      ownEndLetter = ownEndSince(lateFrom);
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
    if (state === "close waits") return row.join("") + "..";
    return row.join("") + ownEndLetter + ((await target.done) ?? ".");
  } finally {
    await sql.close({ timeout: 0 }).catch(() => {});
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe.each(adapters)("$adapter", entry => {
  const { adapter, mockServer, beginCommand, closedCode, endedCode } = entry;
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

  // The wait of close({ timeout }) is for all of the pending work. A query that fails does not end it.
  test("reserved.close({ timeout }) waits for a reserved transaction when a query of the reservation fails first", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received, sql => (sql === "SELECT 'refused'" ? "error" : undefined));
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const started = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      let closeSettled = false;
      let closeSettledInsideTransaction: boolean | undefined;
      const t1 = reserved.begin(async tx => {
        await tx.unsafe("SELECT 'T1a'");
        started.resolve();
        await gate.promise;
        // One round trip to the server behind the failed query of the reservation.
        await tx.unsafe("SELECT 'T1b'");
        closeSettledInsideTransaction = closeSettled;
        return "t1";
      });
      await started.promise;
      const refused = reserved.unsafe("SELECT 'refused'").then(
        () => "resolved",
        err => err.message,
      );
      const closed = reserved.close({ timeout: 60 }).then(() => {
        closeSettled = true;
      });
      expect(await refused).toContain("refused: SELECT 'refused'");
      gate.resolve();
      expect(await t1).toBe("t1");
      await closed;
      reserved.release();
      expect({ closeSettledInsideTransaction, log: received.map(entry => entry.sql) }).toEqual({
        closeSettledInsideTransaction: false,
        log: [beginCommand, "SELECT 'T1a'", "SELECT 'refused'", "SELECT 'T1b'", "COMMIT"],
      });
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // release() during a reserved.begin() must not hand the connection to the next
  // holder while the transaction is still open: the nested COMMIT would then commit
  // the other holder's work. The other transaction's ROLLBACK would roll back nothing.
  test.each([
    { outcome: "commits", endCommand: "COMMIT" },
    { outcome: "rolls back", endCommand: "ROLLBACK" },
  ])("reserved.release() hands the connection back after the reserved transaction $outcome", async ({ endCommand }) => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const started = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      const nested = reserved
        .begin(async tx => {
          await tx.unsafe("SELECT 'N1'");
          started.resolve();
          await gate.promise;
          await tx.unsafe("SELECT 'N2 after release'");
          if (endCommand === "ROLLBACK") throw new Error("nested-app-error");
          return "nested";
        })
        .catch(err => err.message);
      await started.promise;
      const released = reserved.release();
      // max: 1, so this transaction runs only once the pool has the connection back.
      const other = sql.begin(async tx => {
        await tx.unsafe("SELECT 'OTHER'");
        return "other";
      });
      gate.resolve();
      expect(await nested).toBe(endCommand === "ROLLBACK" ? "nested-app-error" : "nested");
      await released;
      expect(await other).toBe("other");
      expect(received).toEqual([
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'N1'" },
        { conn: 0, sql: "SELECT 'N2 after release'" },
        { conn: 0, sql: endCommand },
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'OTHER'" },
        { conn: 0, sql: "COMMIT" },
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("reserved.release() closes the handle at once while the reserved transaction still runs", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const started = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      const nested = reserved.begin(async tx => {
        await tx.unsafe("SELECT 'N1'");
        started.resolve();
        await gate.promise;
        return "nested";
      });
      await started.promise;
      const released = reserved.release();
      const rejected = await Promise.allSettled([reserved`SELECT 'late'`, reserved.begin(async () => {})]);
      expect(rejected.map(r => (r.status === "rejected" ? r.reason.message : r.status))).toEqual([
        "Connection closed",
        "Connection closed",
      ]);
      gate.resolve();
      expect(await nested).toBe("nested");
      await released;
      // The second release() is a no-op.
      await reserved.release();
      expect(received).toEqual([
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'N1'" },
        { conn: 0, sql: "COMMIT" },
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // The promise release() returns must not wait for the caller's own transaction,
  // or this callback could never return.
  test("reserved.release() awaited inside the reserved transaction does not deadlock", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const nested = reserved.begin(async tx => {
        await tx.unsafe("SELECT 'N1'");
        await reserved.release();
        await tx.unsafe("SELECT 'N2 after release'");
        return "nested";
      });
      const other = sql.begin(async tx => {
        await tx.unsafe("SELECT 'OTHER'");
        return "other";
      });
      expect(await nested).toBe("nested");
      expect(await other).toBe("other");
      expect(received).toEqual([
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'N1'" },
        { conn: 0, sql: "SELECT 'N2 after release'" },
        { conn: 0, sql: "COMMIT" },
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'OTHER'" },
        { conn: 0, sql: "COMMIT" },
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // A pool query does not wait in line like sql.begin(): the pool runs it the moment a connection
  // is back. Inside the reserved transaction it would commit or roll back with it.
  test.each([
    { outcome: "commits", endCommand: "COMMIT" },
    { outcome: "rolls back", endCommand: "ROLLBACK" },
  ])("a pool query around reserved.release() runs after the reserved transaction $outcome", async ({ endCommand }) => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const started = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      const nested = reserved
        .begin(async tx => {
          await tx.unsafe("SELECT 'N1'");
          started.resolve();
          await gate.promise;
          await tx.unsafe("SELECT 'N2 after release'");
          if (endCommand === "ROLLBACK") throw new Error("nested-app-error");
          return "nested";
        })
        .catch(err => err.message);
      await started.promise;
      const queued = sql.unsafe("SELECT 'queued before release'").execute();
      reserved.release();
      const made = sql.unsafe("SELECT 'made after release'").execute();
      gate.resolve();
      expect(await nested).toBe(endCommand === "ROLLBACK" ? "nested-app-error" : "nested");
      await Promise.all([queued, made]);
      expect(received.map(entry => entry.sql)).toEqual([
        beginCommand,
        "SELECT 'N1'",
        "SELECT 'N2 after release'",
        endCommand,
        "SELECT 'queued before release'",
        "SELECT 'made after release'",
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("reserved.release() waits for a distributed transaction started on the reservation", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const started = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      const nested = reserved.beginDistributed("x", async tx => {
        await tx.unsafe("SELECT 'N1'");
        started.resolve();
        await gate.promise;
        await tx.unsafe("SELECT 'N2 after release'");
        return "nested";
      });
      await started.promise;
      reserved.release();
      const other = sql.unsafe("SELECT 'OTHER'").execute();
      gate.resolve();
      expect(await nested).toBe("nested");
      await other;
      const marks = ["SELECT 'N1'", "SELECT 'N2 after release'", entry.distributedEnd[0], "SELECT 'OTHER'"];
      expect(received.map(entry => entry.sql).filter(statement => marks.includes(statement))).toEqual(marks);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // Two transactions on one reservation share its connection. The pool gets it after the last one.
  test("reserved.release() waits for every transaction started on the reservation", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const parked = (name: string) => {
        const started = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        const done = reserved.begin(async tx => {
          await tx.unsafe(`SELECT '${name}1'`);
          started.resolve();
          await gate.promise;
          await tx.unsafe(`SELECT '${name}2'`);
          return name;
        });
        return { started: started.promise, gate, done };
      };
      const a = parked("A");
      await a.started;
      const b = parked("B");
      await b.started;
      reserved.release();
      const other = sql.unsafe("SELECT 'OTHER'").execute();
      a.gate.resolve();
      expect(await a.done).toBe("A");
      // B still runs. Its next statement is written behind a pool query that got the connection too early.
      b.gate.resolve();
      expect(await b.done).toBe("B");
      await other;
      expect(received.map(entry => entry.sql)).toEqual([
        beginCommand,
        "SELECT 'A1'",
        beginCommand,
        "SELECT 'B1'",
        "SELECT 'A2'",
        "COMMIT",
        "SELECT 'B2'",
        "COMMIT",
        "SELECT 'OTHER'",
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("a connection that drops while reserved.release() waits leaves the pool slot usable", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const started = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      const nested = reserved
        .begin(async tx => {
          await tx.unsafe("SELECT 'N1'");
          started.resolve();
          await gate.promise;
          await tx.unsafe("SELECT 'KILL'");
        })
        .then(
          () => null,
          err => err,
        );
      await started.promise;
      reserved.release();
      gate.resolve();
      expect(await nested).toBeInstanceOf(Error);
      // A slot that went back to the pool twice would give its connection to both transactions at once.
      const transactions = ["T1", "T2"].map(name =>
        sql.begin(async tx => {
          await tx.unsafe(`SELECT '${name}a'`);
          await tx.unsafe(`SELECT '${name}b'`);
          return name;
        }),
      );
      expect(await Promise.all(transactions)).toEqual(["T1", "T2"]);
      expect(firstInterleaving(received)).toBeNull();
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("reserved.release() called again while it waits hands the connection back once", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const started = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      const nested = reserved.begin(async tx => {
        await tx.unsafe("SELECT 'N1'");
        started.resolve();
        await gate.promise;
        return "nested";
      });
      await started.promise;
      reserved.release();
      reserved.release();
      reserved[Symbol.dispose]();
      await reserved[Symbol.asyncDispose]();
      const transactions = ["T1", "T2"].map(name =>
        sql.begin(async tx => {
          await tx.unsafe(`SELECT '${name}a'`);
          await tx.unsafe(`SELECT '${name}b'`);
          return name;
        }),
      );
      gate.resolve();
      expect(await nested).toBe("nested");
      expect(await Promise.all(transactions)).toEqual(["T1", "T2"]);
      expect(received.map(entry => entry.sql)).toEqual([
        beginCommand,
        "SELECT 'N1'",
        "COMMIT",
        beginCommand,
        "SELECT 'T1a'",
        "SELECT 'T1b'",
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

  // close({ timeout }) waits for the queries of the handle, and the wait starts a query that
  // never ran. The error of a query belongs to whoever awaits the query: bun:test fails this
  // test if the wait reports it as an unhandled rejection as well.
  test("reserved.close({ timeout }) does not report the query that release() refused", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const reserved = await sql.reserve();
      const lazy = reserved.unsafe("SELECT 'never awaited'");
      const closed = reserved.close({ timeout: 60 });
      reserved.release();
      await closed;
      expect(
        await lazy.then(
          () => "resolved",
          err => err.code,
        ),
      ).toBe(closedCode);
      await sql.unsafe("SELECT 'pool'");
      expect(received.map(entry => entry.sql)).toEqual(["SELECT 'pool'"]);
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
        expect(lateError?.code).toBe(endedCode);
      } finally {
        await sql.close({ timeout: 0 }).catch(() => {});
        await new Promise<void>(r => server.close(() => r()));
      }
    },
  );

  // tx.close() rolls the transaction back. Behind COMMIT or ROLLBACK of the runner there is
  // nothing left to roll back, and a ROLLBACK of its own would follow the end of the transaction.
  // close() then waits for the answer of the server, like begin() does.
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
    const other = new SQL(options(port));
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
      let closeSettled = false;
      const closed = handle.close().then(() => void (closeSettled = true));
      // A round trip on another connection gives close() the time to settle, and it must not:
      // the server has not answered.
      await other.unsafe("SELECT 'ping'");
      expect(closeSettled).toBe(false);
      endAnswer.resolve();
      expect(await begun).toBe(end === "ROLLBACK" ? "t1-app-error" : "t1");
      await closed;
      expect(received).toEqual([
        { conn: 0, sql: beginCommand },
        { conn: 0, sql: "SELECT 'T1a'" },
        { conn: 0, sql: end },
        { conn: 1, sql: "SELECT 'ping'" },
      ]);
    } finally {
      await other.close({ timeout: 0 }).catch(() => {});
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
      expect(results).toEqual([endedCode, closedCode]);
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
        expect(await Promise.all(tasks)).toEqual(["item a is invalid", endedCode]);
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

  // The client of a released savepoint is a client of the scope around that savepoint. A savepoint
  // that it opens belongs to that scope, and ends with it.
  test("a savepoint opened through the client of a released savepoint ends with the savepoint around it", async () => {
    type SavepointClient = Bun.SavepointSQL & Pick<Bun.TransactionSQL, "savepoint">;
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const late = await sql.begin(async tx => {
        let inner!: SavepointClient;
        await tx
          .savepoint(async outer => {
            let released!: SavepointClient;
            await outer.savepoint(async sp => {
              released = sp;
            });
            await released.savepoint(async sp => {
              inner = sp;
            });
            throw new Error("outer failed");
          })
          .catch(() => {});
        const late = await inner.unsafe("SELECT 'late'").then(
          () => "resolved",
          err => err.code,
        );
        await tx.unsafe("SELECT 'after'");
        return late;
      });
      expect(late).toBe(endedCode);
      expect(received.map(entry => entry.sql)).toEqual([
        beginCommand,
        "SAVEPOINT s0",
        "SAVEPOINT s1",
        "RELEASE SAVEPOINT s1",
        "SAVEPOINT s2",
        "RELEASE SAVEPOINT s2",
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
        expect(await savepoint).toBe(end === "ROLLBACK" ? "savepoint-app-error" : endedCode);
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
      expect(late).toEqual([endedCode, endedCode, endedCode, endedCode]);
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

  // The server can refuse the statement at the end of a savepoint. The runner rolls the savepoint
  // back when RELEASE SAVEPOINT fails, and a ROLLBACK TO SAVEPOINT that fails is the error of the
  // savepoint. The handle ends when the connection gets ROLLBACK TO SAVEPOINT, whatever the answer.
  test.each([
    { refused: "RELEASE SAVEPOINT s0", callbackFails: false },
    { refused: "ROLLBACK TO SAVEPOINT s0", callbackFails: true },
  ])("a savepoint rejects with the error of the server when the server refuses $refused", async scenario => {
    const { refused, callbackFails } = scenario;
    const received: Received[] = [];
    const { port, server } = await mockServer(received, sql => (sql === refused ? "error" : undefined));
    const sql = new SQL(options(port));
    try {
      const outcome = await sql.begin(async tx => {
        let sp!: Bun.SavepointSQL;
        const savepoint = await tx
          .savepoint(async handle => {
            sp = handle;
            await handle.unsafe("SELECT 'in savepoint'");
            if (callbackFails) throw new Error("savepoint failed");
          })
          .then(
            () => "resolved",
            err => err.message,
          );
        const late = await sp.unsafe("SELECT 'late'").then(
          () => "resolved",
          err => err.code,
        );
        await tx.unsafe("SELECT 'after'");
        return { savepoint, late };
      });
      expect(outcome).toEqual({ savepoint: `refused: ${refused}`, late: endedCode });
      expect(received.map(entry => entry.sql)).toEqual([
        beginCommand,
        "SAVEPOINT s0",
        "SELECT 'in savepoint'",
        ...(callbackFails ? [] : ["RELEASE SAVEPOINT s0"]),
        "ROLLBACK TO SAVEPOINT s0",
        "SELECT 'after'",
        "COMMIT",
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // A savepoint that runs beside the rest of the callback can fail in the same moment as its
  // transaction ends. Its ROLLBACK TO SAVEPOINT is sent ahead of COMMIT or ROLLBACK, or not at
  // all, and the error of the savepoint is the error of its callback in both cases.
  test("a savepoint that fails while its transaction ends keeps the error of its callback", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const errors: string[] = [];
      for (const end of ["COMMIT", "ROLLBACK"]) {
        // The callback of the savepoint rejects this many microtasks after the one of the transaction settled.
        for (let turns = 0; turns < 8; turns++) {
          let savepoint!: Promise<string>;
          await sql
            .begin(async tx => {
              const entered = Promise.withResolvers<void>();
              const leave = Promise.withResolvers<void>();
              savepoint = tx
                .savepoint(async () => {
                  entered.resolve();
                  await leave.promise;
                  for (let i = 0; i < turns; i++) await null;
                  throw new Error("savepoint failed");
                })
                .then(
                  () => "resolved",
                  err => err.code ?? err.message,
                );
              await entered.promise;
              leave.resolve();
              if (end === "ROLLBACK") throw new Error("transaction failed");
            })
            .catch(() => {});
          errors.push(await savepoint);
        }
      }
      expect(errors).toEqual(Array(16).fill("savepoint failed"));
      const log = received.map(entry => entry.sql);
      const behindTheEnd = log.filter(
        (statement, i) => statement.startsWith("ROLLBACK TO") && ["COMMIT", "ROLLBACK"].includes(log[i - 1]),
      );
      expect(behindTheEnd).toEqual([]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // tx.close({ timeout }) rolls the transaction back at once when no query of it is pending, and
  // a statement that was refused is not pending.
  test("a refused statement does not keep tx.close({ timeout }) from rolling back", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      let late!: string;
      await sql
        .begin(async tx => {
          let sp!: Bun.SavepointSQL;
          await tx
            .savepoint(async handle => {
              sp = handle;
              throw new Error("savepoint failed");
            })
            .catch(() => {});
          late = await sp.unsafe("SELECT 'late'").then(
            () => "resolved",
            err => err.code,
          );
          await tx.close({ timeout: 60 });
        })
        .catch(() => {});
      expect(late).toBe(endedCode);
      expect(received.map(entry => entry.sql)).toEqual([
        beginCommand,
        "SAVEPOINT s0",
        "ROLLBACK TO SAVEPOINT s0",
        "ROLLBACK",
      ]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  test("tx.close({ timeout }) waits for a pending query when another one fails first", async () => {
    const received: Received[] = [];
    const heldSeen = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<void>();
    const { port, server } = await mockServer(received, sql => {
      if (sql === "SELECT 'refused'") return "error";
      if (sql === "SELECT 'held'") {
        heldSeen.resolve();
        return answer.promise;
      }
    });
    const sql = new SQL(options(port));
    try {
      let closeSettled = false;
      let closeSettledWhenAnswered: boolean | undefined;
      let refused: string | undefined;
      await sql
        .begin(async tx => {
          const failing = tx.unsafe("SELECT 'refused'").then(
            () => "resolved",
            err => err.message,
          );
          const held = tx.unsafe("SELECT 'held'").then(() => {
            closeSettledWhenAnswered = closeSettled;
          });
          const closed = tx.close({ timeout: 60 }).then(() => {
            closeSettled = true;
          });
          refused = await failing;
          await heldSeen.promise;
          answer.resolve();
          await held;
          await closed;
        })
        .then(
          () => {},
          () => {},
        );
      expect({ refused, closeSettledWhenAnswered, log: received.map(entry => entry.sql).slice(0, 3) }).toEqual({
        refused: expect.stringContaining("refused: SELECT 'refused'"),
        closeSettledWhenAnswered: false,
        log: [beginCommand, "SELECT 'refused'", "SELECT 'held'"],
      });
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // tx.close({ timeout }) waits for the queries of the transaction, and the wait starts a query
  // that never ran. bun:test fails this test if the wait reports the refusal of that query as an
  // unhandled rejection.
  test("tx.close({ timeout }) does not report the query that a rolled-back savepoint refused", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      let lazy!: Bun.SQL.Query<unknown>;
      await sql.begin(async tx => {
        await tx
          .savepoint(async sp => {
            lazy = sp.unsafe("SELECT 'never awaited'");
            throw new Error("savepoint failed");
          })
          .catch(() => {});
        await tx.close({ timeout: 60 });
      });
      expect(
        await lazy.then(
          () => "resolved",
          err => err.code,
        ),
      ).toBe(endedCode);
      expect(received.map(entry => entry.sql)).not.toContain("SELECT 'never awaited'");
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // `await using` releases the reservation when the block is left. A query is lazy: one that the
  // block returns without an await runs after that, on a connection that is back in the pool.
  test("a query that leaves an `await using` block of a reservation without an await is rejected", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    const sql = new SQL(options(port));
    try {
      const run = async () => {
        await using reserved = await sql.reserve();
        await reserved.unsafe("SELECT 'awaited'");
        return reserved.unsafe("SELECT 'returned'");
      };
      expect(
        await run().then(
          () => "resolved",
          err => err.code,
        ),
      ).toBe(closedCode);
      await sql.unsafe("SELECT 'pool'");
      expect(received.map(entry => entry.sql)).toEqual(["SELECT 'awaited'", "SELECT 'pool'"]);
    } finally {
      await sql.close({ timeout: 0 }).catch(() => {});
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  // Runs in a child process: bun:test would turn the unhandled rejection into a test failure, and
  // the contract is that the statement is not dropped in silence.
  test("a statement of an ended transaction that nothing awaits is reported as an unhandled rejection", async () => {
    const received: Received[] = [];
    const { port, server } = await mockServer(received);
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const reported = [];
            const first = Promise.withResolvers();
            process.on("unhandledRejection", err => {
              reported.push(err.code);
              first.resolve();
            });
            const sql = new Bun.SQL(${JSON.stringify(options(port))});
            let ended;
            await sql.begin(async tx => {
              ended = tx;
              await tx.unsafe("SELECT 'T1a'");
            });
            ended.unsafe("SELECT 'late'").execute();
            await sql.unsafe("SELECT 'pool'");
            // Holds the connection open until the rejection is reported, so the child cannot print too early.
            await first.promise;
            await sql.close();
            console.log(JSON.stringify({ reported }));
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ reported: [endedCode] });
      expect(exitCode).toBe(0);
      expect(received.map(entry => entry.sql)).toEqual([beginCommand, "SELECT 'T1a'", "COMMIT", "SELECT 'pool'"]);
    } finally {
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
            const first = Promise.withResolvers();
            process.on("unhandledRejection", err => {
              reported.push(err.message);
              first.resolve();
            });
            const sql = new Bun.SQL(${JSON.stringify(options(port))});
            const reserved = await sql.reserve();
            const handled = await reserved
              .begin(async () => {
                throw new Error("handled by the caller");
              })
              .catch(err => err.message);
            reserved.begin("read-only", async () => {});
            await reserved.unsafe("SELECT 'still reserved'");
            // Holds the reservation until the rejection is reported, so the child cannot print too early.
            await first.promise;
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
