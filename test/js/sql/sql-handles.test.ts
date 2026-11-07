// What stays in a table on a real server is in sql-handles-servers.test.ts.
import { SQL } from "bun";
import { heapStats } from "bun:jsc";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
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
// Can delay the answer to a statement; "error" makes the answer to a simple query an error. Answers keep the order of the statements.
type Hold = (sql: string) => Promise<void | "error"> | void | "error";
type MockServer = (
  received: Received[],
  hold: Hold,
  drops: (sql: string) => boolean,
  leavesAfter: (sql: string) => boolean,
  // PostgreSQL only
  tagOf: (sql: string) => string,
) => Promise<{ port: number; server: net.Server }>;

function answerInOrder(hold: Hold) {
  let chain = Promise.resolve();
  return (sql: string, answer: () => void, refuse: () => void = answer) => {
    chain = chain.then(() => hold(sql)).then(verdict => (verdict === "error" ? refuse() : answer()));
  };
}

// A prepared statement is answered as one with text parameters and no columns.
const pgMockServer: MockServer = (received, hold, drops, leavesAfter, tagOf) => {
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
          const nameEnd = body.indexOf(0);
          prepared = body.subarray(nameEnd + 1, body.indexOf(0, nameEnd + 1)).toString("utf8");
          received.push({ conn: connId, sql: prepared });
          answer(prepared, () => socket.write(pgParseComplete()));
        } else if (type === "D") {
          const parameters = Array(new Set(prepared.match(/\$\d+/g)).size).fill(25 /* text */);
          const replies = body[0] === 0x53 ? [pgParameterDescription(parameters), pgNoData()] : [pgNoData()];
          answer(prepared, () => socket.write(Buffer.concat(replies)));
        } else if (type === "B") {
          answer(prepared, () => socket.write(pgBindComplete()));
        } else if (type === "E") {
          answer(prepared, () => socket.write(pgCommandComplete("SELECT 0")));
        } else if (type === "S") {
          answer(prepared, () => socket.write(pgReadyForQuery()));
        } else if (type === "Q") {
          const sql = body.subarray(0, body.indexOf(0)).toString("utf8");
          received.push({ conn: connId, sql });
          if (drops(sql)) {
            socket.destroy();
            return;
          }
          const send = (...reply: Buffer[]) =>
            leavesAfter(sql)
              ? socket.end(Buffer.concat([...reply, pgErrorResponse({ S: "FATAL", C: "57P01", M: "goodbye" })]))
              : socket.write(Buffer.concat(reply));
          answer(
            sql,
            () => send(pgCommandComplete(tagOf(sql)), pgReadyForQuery()),
            () => send(pgErrorResponse({ S: "ERROR", C: "XX000", M: `refused: ${sql}` }), pgReadyForQuery("E")),
          );
        }
      }
    });
    socket.on("error", () => {});
  });
};

const mysqlMockServer: MockServer = (received, hold, drops, leavesAfter) => {
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
          if (drops(sql)) {
            socket.destroy();
            return;
          }
          const send = (reply: Buffer) =>
            leavesAfter(sql)
              ? socket.end(Buffer.concat([reply, mysqlErrPacket(0, 1053, "08S01", "goodbye")]))
              : socket.write(reply);
          answer(
            sql,
            () => send(mysqlOkPacket(1)),
            () => send(mysqlErrPacket(1, 1105, "HY000", `refused: ${sql}`)),
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

type Adapter = {
  adapter: "postgres" | "mysql";
  mockServer: MockServer;
  BEGIN: string;
  distributedBegin: string;
  closedCode: string;
  endedCode: string;
  // notify() is PostgreSQL only
  wire: { notify: string | null; commitDistributed: string; rollbackDistributed: string };
  // what ends beginDistributed("x") when its callback fulfils, and when it rejects
  distributedEnd: [string[], string[]];
};
const adapters: Adapter[] = [
  {
    adapter: "postgres",
    mockServer: pgMockServer,
    BEGIN: "BEGIN",
    distributedBegin: "BEGIN",
    closedCode: "ERR_POSTGRES_CONNECTION_CLOSED",
    endedCode: "ERR_POSTGRES_INVALID_TRANSACTION_STATE",
    wire: {
      notify: "SELECT pg_notify($1, $2)",
      commitDistributed: "COMMIT PREPARED 'c'",
      rollbackDistributed: "ROLLBACK PREPARED 'r'",
    },
    distributedEnd: [["PREPARE TRANSACTION 'x'"], ["ROLLBACK"]],
  },
  {
    adapter: "mysql",
    mockServer: mysqlMockServer,
    BEGIN: "START TRANSACTION",
    distributedBegin: "XA START 'x'",
    closedCode: "ERR_MYSQL_CONNECTION_CLOSED",
    endedCode: "ERR_MYSQL_INVALID_TRANSACTION_STATE",
    wire: { notify: null, commitDistributed: "XA COMMIT 'c'", rollbackDistributed: "XA ROLLBACK 'r'" },
    distributedEnd: [
      ["XA END 'x'", "XA PREPARE 'x'"],
      ["XA END 'x'", "XA ROLLBACK 'x'"],
    ],
  },
];

type Server = {
  /** max: 1 */
  sql: SQL;
  options: Bun.SQL.Options;
  received: Received[];
  log(): string[];
  /** The server keeps its answer to `text` until answer(). `seen` resolves when the statement arrives. */
  hold(text: string): { seen: Promise<void>; answer(): void };
  /** The server answers `text` with the error `refused: ${text}`. */
  refuse(text: string): void;
  /** The server drops the connection when `text` arrives, as it does for "SELECT 'KILL'". */
  drop(text: string): void;
  /** The server shuts down behind its answer to `text`: the answer, its goodbye and the end of the connection in one write. */
  leaveAfter(text: string): void;
  /** PostgreSQL: the command tag in the answer to `text`. */
  answerWithTag(text: string, tag: string): void;
};

async function withServer<T>({ adapter, mockServer }: Adapter, run: (server: Server) => Promise<T>): Promise<T> {
  const received: Received[] = [];
  const holds = new Map<string, { seen: PromiseWithResolvers<void>; gate: PromiseWithResolvers<void> }>();
  const refused = new Set<string>();
  const dropped = new Set(["SELECT 'KILL'"]);
  const last = new Set<string>();
  const tags = new Map<string, string>();
  const { port, server } = await mockServer(
    received,
    text => {
      if (refused.has(text)) return "error";
      const held = holds.get(text);
      if (!held) return;
      held.seen.resolve();
      return held.gate.promise;
    },
    text => dropped.has(text),
    text => last.has(text),
    text => tags.get(text) ?? "SELECT 0",
  );
  const options: Bun.SQL.Options = {
    adapter,
    hostname: "127.0.0.1",
    port,
    username: "u",
    password: "p",
    database: "db",
    max: 1,
    tls: false,
    idleTimeout: 5,
  };
  const sql = new SQL(options);
  try {
    return await run({
      sql,
      options,
      received,
      log: () => received.map(entry => entry.sql),
      hold(text) {
        const held = { seen: Promise.withResolvers<void>(), gate: Promise.withResolvers<void>() };
        holds.set(text, held);
        return { seen: held.seen.promise, answer: held.gate.resolve };
      },
      refuse: text => void refused.add(text),
      drop: text => void dropped.add(text),
      leaveAfter: text => void last.add(text),
      answerWithTag: (text, tag) => void tags.set(text, tag),
    });
  } finally {
    for (const held of holds.values()) held.gate.resolve();
    await sql.close({ timeout: 0 }).catch(() => {});
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

const outcome = (promise: PromiseLike<unknown>): Promise<any> =>
  promise.then(
    value => (value === undefined || Array.isArray(value) ? "resolved" : value),
    err => err?.code ?? err?.message ?? err,
  );
const errorOf = (promise: PromiseLike<unknown>): Promise<any> =>
  promise.then(
    () => null,
    err => err,
  );

/** Not expect(fn).toThrow(): that one waits for what `fn` returns, and nothing starts a lazy query. */
function thrownBy(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

function parked() {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  return { entered: entered.promise, enter: entered.resolve, gate: gate.promise, go: gate.resolve };
}

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

// One row of `statementsThatReachTheServer` is one scenario on its own mock server: a kind of handle, and the state
// of its scope when the statements are made. One letter per entry of `producers`, in order:
//   S  sent, and not behind the statement that ended its scope
//   L  sent behind the statement that ended its scope
//   e  rejected when it ran, nothing sent: its transaction or savepoint ended (endedCode)
//   r  the same, with the error of a closed connection (closedCode)
//   i  a fragment: nothing sent and nothing rejected
//   -  not a call of this handle or adapter           .  not a part of the row
// The last two letters: the statement that the runner of the scope sends when its callback settles (S, L as above,
// r never sent), and the promise of the scope (R resolved, E the error of its callback, C closedCode, D endedCode).
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
  // close({ timeout }) of the outermost handle waits for a scope below it. How the scopes end after that is not a part of the row.
  | "close waits"
  // close() of the transaction sent ROLLBACK and the server has not answered
  | "close in flight"
  // the same ROLLBACK, sent by the timer of close({ timeout })
  | "close timed out"
  // the server dropped the connection, and the pool has a new one
  | "connection lost";

// prettier-ignore
const statementsThatReachTheServer: [HandleKind, ScopeState, fulfils: string, rejects?: string][] = [
  ["transaction", "open",             "SSSSSSSSSiiii.R"],
  ["transaction", "callback settled", "SSSSeSeSSiiii.R", "SSSSeSeSSiiii.E"],
  ["transaction", "end in flight",    "eeeeeeeeeiiii.R", "eeeeeeeeeiiii.E"],
  ["transaction", "ended",            "eeeeeeeeeiiii.R", "eeeeeeeeeiiii.E"],
  ["transaction", "close waits",      "rrrrrrrrriiii..", "rrrrrrrrriiii.."],
  ["transaction", "close in flight",  "rrrrrrrrriiiirC", "rrrrrrrrriiiirE"],
  ["transaction", "close timed out",  "rrrrrrrrriiiirC", "rrrrrrrrriiiirE"],
  ["transaction", "connection lost",  "rrrrrrrrriiii.C"],

  ["savepoint", "open",               "SSSSSSSSSiiii.R"],
  ["savepoint", "callback settled",   "SSSSeSeSSiiii.R", "SSSSeSeSSiiii.E"],
  ["savepoint", "end in flight",      "eeeeeeeeeiiii.R", "eeeeeeeeeiiii.E"],
  ["savepoint", "ended",              "eeeeeeeeeiiii.R", "eeeeeeeeeiiii.E"],
  ["savepoint", "outer rolled back",  "eeeeeeeeeiiiirD", "eeeeeeeeeiiiirE"],
  ["savepoint", "outer completed",    "eeeeeeeeeiiiirD", "eeeeeeeeeiiiirE"],
  ["savepoint", "close waits",        "rrrrrrrrriiii..", "rrrrrrrrriiii.."],
  ["savepoint", "close in flight",    "rrrrrrrrriiiirC", "rrrrrrrrriiiirE"],
  ["savepoint", "close timed out",    "rrrrrrrrriiiirC", "rrrrrrrrriiiirE"],
  ["savepoint", "connection lost",    "rrrrrrrrriiii.E"],

  ["nested savepoint", "open",               "SSSSSSSSSiiii.R"],
  ["nested savepoint", "callback settled",   "SSSSeSeSSiiii.R", "SSSSeSeSSiiii.E"],
  ["nested savepoint", "end in flight",      "eeeeeeeeeiiii.R", "eeeeeeeeeiiii.E"],
  ["nested savepoint", "ended",              "eeeeeeeeeiiii.R", "eeeeeeeeeiiii.E"],
  ["nested savepoint", "outer rolled back",  "eeeeeeeeeiiiirD", "eeeeeeeeeiiiirE"],
  ["nested savepoint", "outer completed",    "eeeeeeeeeiiiirD", "eeeeeeeeeiiiirE"],
  ["nested savepoint", "close waits",        "rrrrrrrrriiii..", "rrrrrrrrriiii.."],
  ["nested savepoint", "close in flight",    "rrrrrrrrriiiirC", "rrrrrrrrriiiirE"],
  ["nested savepoint", "close timed out",    "rrrrrrrrriiiirC", "rrrrrrrrriiiirE"],
  ["nested savepoint", "connection lost",    "rrrrrrrrriiii.E"],

  ["reserved", "open",               "SSSSSS-SSiiii.."],
  ["reserved", "ended",              "rrrrrr-rriiii.."],
  ["reserved", "close waits",        "rrrrrr-rriiii.."],
  ["reserved", "connection lost",    "rrrrrr-rriiii.."],

  ["transaction on reserved", "open",             "SSSSSSSSSiiii.R"],
  ["transaction on reserved", "callback settled", "SSSSeSeSSiiii.R", "SSSSeSeSSiiii.E"],
  ["transaction on reserved", "end in flight",    "eeeeeeeeeiiii.R", "eeeeeeeeeiiii.E"],
  ["transaction on reserved", "ended",            "eeeeeeeeeiiii.R", "eeeeeeeeeiiii.E"],
  ["transaction on reserved", "outer completed",  "SSSSeSSSSiiiiSR", "SSSSeSSSSiiiiSE"],
  ["transaction on reserved", "close waits",      "SSSSSSSSSiiii..", "SSSSSSSSSiiii.."],
  ["transaction on reserved", "close in flight",  "rrrrrrrrriiiirC", "rrrrrrrrriiiirE"],
  ["transaction on reserved", "close timed out",  "rrrrrrrrriiiirC", "rrrrrrrrriiiirE"],
  ["transaction on reserved", "connection lost",  "rrrrrrrrriiii.C"],

  ["distributed transaction", "open",             "SSSSSS-SSiiii.R"],
  ["distributed transaction", "callback settled", "SSSSeS-SSiiii.R", "SSSSeS-SSiiii.E"],
  ["distributed transaction", "end in flight",    "eeeeee-eeiiii.R", "eeeeee-eeiiii.E"],
  ["distributed transaction", "ended",            "eeeeee-eeiiii.R", "eeeeee-eeiiii.E"],
  ["distributed transaction", "close in flight",  "rrrrrr-rriiiirC", "rrrrrr-rriiiirE"],
  ["distributed transaction", "connection lost",  "rrrrrr-rriiii.C"],
];

const isClosedError = (reason: any) => /_CONNECTION_CLOSED$/.test(reason?.code ?? "");
const isEndedError = (reason: any) =>
  /_INVALID_TRANSACTION_STATE$/.test(reason?.code ?? "") && /ended$/.test(reason?.message ?? "");
const isNotACall = (reason: any) => /not supported|_INVALID_TRANSACTION_STATE$/.test(reason?.code ?? reason?.message);
const refusalLetter = (reason: any) =>
  isEndedError(reason) ? "e" : isClosedError(reason) ? "r" : isNotACall(reason) ? "-" : "!";

// [the call, the statement it puts on the wire (a key of `wire` when the text differs by adapter)]. No statement: a fragment.
const producers: [make: (handle: any, early: any[], file: string) => any, sent?: string | RegExp][] = [
  [handle => handle`SELECT 'tagged'`, "SELECT 'tagged'"],
  [handle => handle.unsafe("SELECT 'unsafe'"), "SELECT 'unsafe'"],
  // Two queries that were made while the scope was open and first run in the state of the row.
  [(_, early) => early[0], "SELECT 'early unsafe'"],
  [(_, early) => early[1], "SELECT 'early tagged'"],
  [(handle, _, file) => handle.file(file), "SELECT 'file'"],
  [handle => handle.notify("channel", "payload"), "notify"],
  [handle => handle.savepoint?.("cell", async () => {}), /^SAVEPOINT s\d+_cell$/],
  [handle => handle.commitDistributed("c"), "commitDistributed"],
  [handle => handle.rollbackDistributed("r"), "rollbackDistributed"],
  [handle => handle({ a: 1 })],
  [handle => handle([1, 2])],
  [handle => handle`1 = 1`],
  [handle => handle.unsafe("1 = 1")],
];

// A cell resolves to its letter. "?" is a statement that ran: the wire log decides between S and L.
function makeStatements(handle: any, early: any[], file: string): Promise<string>[] {
  return producers.map(async ([make, sent]) => {
    let made: any;
    try {
      made = make(handle, early, file);
    } catch (err) {
      return refusalLetter(err);
    }
    if (made === undefined) return "-";
    const isQuery = typeof made.execute === "function";
    if (sent === undefined) return isQuery || typeof made.then !== "function" ? "i" : "!";
    if (isQuery) made.execute();
    return Promise.resolve(made).then(() => "?", refusalLetter);
  });
}

function statementsOf(
  entry: Adapter,
  kind: HandleKind,
  state: ScopeState,
  callbackFulfils: boolean,
  file: string,
): Promise<string> {
  return withServer(entry, async ({ sql, received, log, hold }) => {
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
            beginDistributed: [entry.distributedEnd[0][0], entry.distributedEnd[1][0]],
          } as const
        )[step];
      }
      levels.push(level);
    }
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
    const early = [target.handle.unsafe("SELECT 'early unsafe'"), target.handle`SELECT 'early tagged'`];
    const make = () => makeStatements(target.handle, early, file);

    let cells!: Promise<string>[];
    // A statement at or behind this index of the wire log is late.
    let lateFrom = Infinity;
    let ownEndLetter = ".";
    const ownEndSince = (from: number) =>
      from === Infinity ? (log().includes(ownEnd!) ? "S" : "r") : log().indexOf(ownEnd!, from) < 0 ? "r" : "L";

    if (state === "open") {
      await Promise.all((cells = make()));
    } else if (state === "callback settled") {
      // This reaction runs behind the one of the runner, so the runner has made the statement that ends the scope,
      // and `await` has not handed it to the connection yet.
      const react = () => void (cells = make());
      target.park.promise.then(react, react);
      await settle(target, callbackFulfils);
      lateFrom = log().indexOf(ownEnd!);
    } else if (state === "end in flight") {
      const { seen, answer } = hold(ownEnd!);
      const done = settle(target, callbackFulfils);
      await seen;
      cells = make();
      answer();
      await done;
      lateFrom = log().indexOf(ownEnd!);
    } else if (state === "ended") {
      await settle(target, callbackFulfils);
      lateFrom = received.length;
      cells = make();
    } else if (state === "outer rolled back" || state === "outer completed") {
      const outerFulfils = state === "outer completed";
      // A reservation has no statement at its end: release() leaves the connection to its transaction.
      const held = outer.end && hold(outer.end[outerFulfils ? 0 : 1]);
      const outerDone = settle(outer, outerFulfils);
      await held?.seen;
      if (outer.step !== "reserve") lateFrom = received.length;
      cells = make();
      const done = settle(target, callbackFulfils);
      held?.answer();
      await Promise.all([outerDone, done]);
      ownEndLetter = ownEndSince(lateFrom);
    } else if (state === "close waits") {
      const closing = levels[0].handle.close({ timeout: 60 });
      await Promise.all((cells = make()));
      for (const level of levels.slice(1).reverse()) await settle(level, level !== target || callbackFulfils);
      await closing;
      await settle(target, callbackFulfils);
    } else if (state === "close in flight" || state === "close timed out") {
      const { seen, answer } = hold(transaction.end![1]);
      // The timer of close({ timeout }) starts when there is a scope below the transaction to wait for.
      const closing = transaction.handle.close(state === "close timed out" ? { timeout: 0.001 } : undefined);
      await seen;
      lateFrom = received.length;
      cells = make();
      answer();
      await closing;
      await settle(target, callbackFulfils);
      ownEndLetter = ownEndSince(lateFrom);
    } else {
      state satisfies "connection lost";
      await outcome(target.handle.unsafe("SELECT 'KILL'"));
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
      const statement =
        typeof text === "string" && text in entry.wire ? entry.wire[text as keyof Adapter["wire"]] : text;
      const at = statement
        ? sent.findIndex(line => (typeof statement === "string" ? line === statement : statement.test(line)))
        : -1;
      if (at < 0) return letter === "?" ? "!" : letter;
      return at < lateFrom ? "S" : "L";
    });
    if (state === "close waits") return row.join("") + "..";
    return row.join("") + ownEndLetter + ((await target.done) ?? ".");
  });
}

describe.each(adapters)("$adapter", entry => {
  const { BEGIN, distributedBegin, closedCode, endedCode, distributedEnd } = entry;
  const scenario = <T>(run: (server: Server) => Promise<T>) => withServer(entry, run);

  test.each(statementsThatReachTheServer.map(([kind, state, fulfils, rejects]) => ({ kind, state, fulfils, rejects })))(
    "a $kind handle, $state: a statement is sent only ahead of the statement that ends its scope",
    async ({ kind, state, fulfils, rejects }) => {
      using dir = tempDir("sql-statements-of-a-handle", { "statement.sql": "SELECT 'file'" });
      const file = join(String(dir), "statement.sql");
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

  test("begin() gives its connection back when the connection closes, not when the callback returns", () =>
    scenario(async ({ sql, received }) => {
      const callback = parked();
      let returned = false;
      const abandoned = sql.begin(async tx => {
        await outcome(tx.unsafe("SELECT 'KILL'"));
        await callback.gate;
        returned = true;
      });
      expect(await outcome(abandoned)).toBe(closedCode);

      const r1 = sql.reserve().then(async reserved => {
        const servedLate = returned;
        await reserved.unsafe("SELECT 'R1'");
        reserved.release();
        return servedLate;
      });
      const t2 = sql.begin(async tx => {
        const servedLate = returned;
        await tx.unsafe("SELECT 'T2a'");
        // The abandoned callback returns while t2 has the connection. A second release() would start t3 inside t2.
        callback.go();
        await tx.unsafe("SELECT 'T2b'");
        return servedLate;
      });
      const t3 = sql.begin(tx => tx.unsafe("SELECT 'T3a'"));
      await sql.unsafe("SELECT 'plain'");
      callback.go();

      expect({ servedLate: await Promise.all([r1, t2]), t3: await outcome(t3), received }).toEqual({
        servedLate: [false, false],
        t3: "resolved",
        received: [
          { conn: 0, sql: BEGIN },
          { conn: 0, sql: "SELECT 'KILL'" },
          { conn: 1, sql: "SELECT 'R1'" },
          { conn: 1, sql: BEGIN },
          { conn: 1, sql: "SELECT 'T2a'" },
          { conn: 1, sql: "SELECT 'T2b'" },
          { conn: 1, sql: "COMMIT" },
          { conn: 1, sql: BEGIN },
          { conn: 1, sql: "SELECT 'T3a'" },
          { conn: 1, sql: "COMMIT" },
          { conn: 1, sql: "SELECT 'plain'" },
        ],
      });
    }));

  test("sql.close() does not wait for a begin() callback that lost its connection", () =>
    scenario(async ({ sql }) => {
      const callback = parked();
      let returned = false;
      const abandoned = sql.begin(async tx => {
        await outcome(tx.unsafe("SELECT 'KILL'"));
        await callback.gate;
        returned = true;
      });
      expect(await outcome(abandoned)).toBe(closedCode);
      // Nothing is left to close, so close() settles in microtasks: one turn of the event loop tells the outcomes apart.
      const closedLate = sql.close().then(() => returned);
      await new Promise<void>(resolve => setImmediate(resolve));
      callback.go();
      expect(await closedLate).toBe(false);
    }));

  test.each<[string, (sql: SQL, use: (handle: any) => Promise<void>) => Promise<unknown>]>([
    ["sql.begin()", (sql, use) => sql.begin(use)],
    [
      "sql.reserve()",
      async (sql, use) => {
        await using reserved = await sql.reserve();
        await use(reserved);
      },
    ],
    [
      "reserved.begin()",
      async (sql, use) => {
        await using reserved = await sql.reserve();
        await reserved.begin(use);
      },
    ],
  ])("%s that outlives its connection gives it back once", (_, holdConnection) =>
    scenario(async ({ sql }) => {
      const lost = parked();
      const held = outcome(
        holdConnection(sql, async handle => {
          await outcome(handle.unsafe("SELECT 'KILL'"));
          lost.enter();
          await lost.gate;
        }),
      );
      await lost.entered;
      await sql.unsafe("SELECT 'reconnect'");
      lost.go();
      await held;
      // An idle connection is reserved in the call. With any other count the reservation is queued and the abort cancels it.
      const controller = new AbortController();
      const again = sql.reserve({ signal: controller.signal }).then(
        reserved => (reserved.release(), "reserved"),
        () => "queued",
      );
      controller.abort();
      expect(await again).toBe("reserved");
    }),
  );

  test("a query that first runs after the connection dropped rejects with the error of the drop", () =>
    scenario(async ({ sql }) => {
      const reserved = await sql.reserve();
      const lazy = reserved.unsafe("SELECT 'lazy'");
      const dropped = await errorOf(reserved.unsafe("SELECT 'KILL'"));
      expect([dropped.code, (await errorOf(lazy)) === dropped]).toEqual([closedCode, true]);
    }));

  test.each<[string, (reserved: Bun.ReservedSQL, fn: (tx: any) => Promise<unknown>) => Promise<unknown>, string[]]>([
    ["begin() commits", (reserved, fn) => reserved.begin(fn), [BEGIN, "COMMIT"]],
    [
      "begin() rolls back",
      (reserved, fn) => reserved.begin(tx => fn(tx).then(() => Promise.reject(new Error("nested failed")))),
      [BEGIN, "ROLLBACK"],
    ],
    [
      "beginDistributed() is prepared",
      (reserved, fn) => reserved.beginDistributed("x", fn),
      [distributedBegin, ...distributedEnd[0]],
    ],
  ])(
    "reserved.release() shuts the handle at once and hands the connection back after %s",
    (_, begin, [opened, ...ended]) =>
      scenario(async ({ sql, log, received }) => {
        const reserved = await sql.reserve();
        const nested = parked();
        const transaction = outcome(
          begin(reserved, async tx => {
            await tx.unsafe("SELECT 'N1'");
            nested.enter();
            await nested.gate;
            await tx.unsafe("SELECT 'N2 after release'");
          }),
        );
        await nested.entered;
        const queued = sql.unsafe("SELECT 'queued before release'").execute();
        await reserved.release();
        expect(await Promise.all([outcome(reserved`SELECT 'late'`), outcome(reserved.begin(async () => {}))])).toEqual([
          closedCode,
          closedCode,
        ]);
        const other = sql.begin(tx => tx.unsafe("SELECT 'OTHER'"));
        nested.go();
        await transaction;
        await Promise.all([queued, other]);
        expect(log().slice(0, 3 + ended.length)).toEqual([
          opened,
          "SELECT 'N1'",
          "SELECT 'N2 after release'",
          ...ended,
        ]);
        expect(log().length).toBe(3 + ended.length + 4);
        if (ended[0] === "COMMIT" || ended[0] === "ROLLBACK") expect(firstInterleaving(received)).toBeNull();
      }),
  );

  test("reserved.release() awaited inside a transaction on the reservation does not deadlock", () =>
    scenario(async ({ sql, log }) => {
      const reserved = await sql.reserve();
      const nested = reserved.begin(async tx => {
        await tx.unsafe("SELECT 'N1'");
        await reserved.release();
        await tx.unsafe("SELECT 'N2 after release'");
        return "nested";
      });
      const other = sql.begin(tx => tx.unsafe("SELECT 'OTHER'"));
      expect(await nested).toBe("nested");
      await other;
      expect(log()).toEqual([
        BEGIN,
        "SELECT 'N1'",
        "SELECT 'N2 after release'",
        "COMMIT",
        BEGIN,
        "SELECT 'OTHER'",
        "COMMIT",
      ]);
    }));

  test("the transactions of a reservation run one at a time, and release() waits for all of them", () =>
    scenario(async ({ sql, log }) => {
      const context = new AsyncLocalStorage<string>();
      const reserved = await sql.reserve();
      const a = parked();
      const transactions = [
        context.run("a", () =>
          reserved.begin(async tx => {
            await tx.unsafe("SELECT 'A1'");
            a.enter();
            await a.gate;
            await tx.unsafe("SELECT 'A2'");
            return context.getStore();
          }),
        ),
        context.run("b", () =>
          reserved.begin(async tx => {
            await tx.unsafe("SELECT 'B1'");
            return context.getStore();
          }),
        ),
        context.run("c", () =>
          reserved.begin(async () => {
            throw new Error(`${context.getStore()} failed`);
          }),
        ),
      ].map(outcome);
      await a.entered;
      reserved.release();
      const other = sql.unsafe("SELECT 'OTHER'").execute();
      a.go();
      expect(await Promise.all(transactions)).toEqual(["a", "b", "c failed"]);
      await other;
      expect(log()).toEqual([
        BEGIN,
        "SELECT 'A1'",
        "SELECT 'A2'",
        "COMMIT",
        BEGIN,
        "SELECT 'B1'",
        "COMMIT",
        BEGIN,
        "ROLLBACK",
        "SELECT 'OTHER'",
      ]);
    }));

  test.each<[string, (reserved: Bun.ReservedSQL, tx: any) => unknown]>([
    ["the connection drops while release() waits", (_, tx) => tx.unsafe("SELECT 'KILL'")],
    [
      "release() is called again while it waits",
      async reserved => {
        reserved.release();
        reserved[Symbol.dispose]();
        await reserved[Symbol.asyncDispose]();
      },
    ],
  ])("the connection goes back once when %s", (_, during) =>
    scenario(async ({ sql, received }) => {
      const reserved = await sql.reserve();
      const nested = parked();
      const transaction = outcome(
        reserved.begin(async tx => {
          await tx.unsafe("SELECT 'N1'");
          nested.enter();
          await nested.gate;
          await during(reserved, tx);
        }),
      );
      await nested.entered;
      reserved.release();
      nested.go();
      await transaction;
      // A connection that went back twice would be given to both at once.
      const transactions = ["T1", "T2"].map(name =>
        sql.begin(async tx => {
          await tx.unsafe(`SELECT '${name}a'`);
          await tx.unsafe(`SELECT '${name}b'`);
          return name;
        }),
      );
      expect(await Promise.all(transactions)).toEqual(["T1", "T2"]);
      expect(firstInterleaving(received)).toBeNull();
    }),
  );

  test("reserved.close({ timeout }) closes the connection and gives it back once what runs is done", () =>
    scenario(async ({ sql, received, hold }) => {
      const reserved = await sql.reserve();
      const held = hold("SELECT 'in flight'");
      const inFlight = outcome(reserved.unsafe("SELECT 'in flight'").execute());
      const transaction = reserved.begin(async tx => {
        await tx.unsafe("SELECT 'T1'");
        return "t1";
      });
      const closing = [reserved.close({ timeout: 60 }), reserved.close(), reserved.release()];
      await held.seen;
      expect(await outcome(reserved.unsafe("SELECT 'late'"))).toBe(closedCode);
      held.answer();
      expect(await Promise.all([inFlight, transaction])).toEqual(["resolved", "t1"]);
      await Promise.all(closing);
      await sql.unsafe("SELECT 'pool'");
      expect(received).toEqual([
        { conn: 0, sql: "SELECT 'in flight'" },
        { conn: 0, sql: BEGIN },
        { conn: 0, sql: "SELECT 'T1'" },
        { conn: 0, sql: "COMMIT" },
        { conn: 1, sql: "SELECT 'pool'" },
      ]);
    }));

  test("reserved.close({ timeout }) closes the connection under what outlives the timeout, with one error", () =>
    scenario(async ({ sql, received, hold }) => {
      const reserved = await sql.reserve();
      const held = hold("SELECT 'slow'");
      const running = ["SELECT 'slow'", "SELECT 'behind it'"].map(text => outcome(reserved.unsafe(text).execute()));
      await held.seen;
      await reserved.close({ timeout: 0.001 });
      expect(await Promise.all(running)).toEqual([closedCode, closedCode]);
      await sql.unsafe("SELECT 'pool'");
      expect(received.at(-1)).toEqual({ conn: 1, sql: "SELECT 'pool'" });
    }));

  // bun:test fails these two if the wait reports the error of a query, which its caller has handled, a second time.
  test("close({ timeout }) resolves when the server drops the connection while it waits", () =>
    scenario(async ({ sql, received }) => {
      const reserved = await sql.reserve();
      const dropped = outcome(reserved.unsafe("SELECT 'KILL'").execute());
      await reserved.close({ timeout: 60 });
      expect(await dropped).toBe(closedCode);
      const transaction = sql.begin(async tx => {
        const dropped = outcome(tx.unsafe("SELECT 'KILL'").execute());
        await tx.close({ timeout: 60 });
        expect(await dropped).toBe(closedCode);
      });
      expect(await outcome(transaction)).toBe(closedCode);
      expect(received).toEqual([
        { conn: 0, sql: "SELECT 'KILL'" },
        { conn: 1, sql: BEGIN },
        { conn: 1, sql: "SELECT 'KILL'" },
      ]);
    }));

  test.each<[string, (sql: SQL, use: (handle: any) => Promise<void>) => Promise<unknown>]>([
    ["reserved", async (sql, use) => use(await sql.reserve())],
    ["tx", (sql, use) => outcome(sql.begin(use))],
  ])("%s.close({ timeout }) goes on waiting when one of the queries fails", (_, open) =>
    scenario(async ({ sql, hold, refuse }) => {
      refuse("SELECT 'refused'");
      const held = hold("SELECT 'held'");
      await open(sql, async handle => {
        const failing = errorOf(handle.unsafe("SELECT 'refused'").execute());
        const pending = outcome(handle.unsafe("SELECT 'held'").execute());
        let closed = false;
        const closing = handle.close({ timeout: 60 }).then(() => void (closed = true));
        expect((await failing).message).toContain("refused: SELECT 'refused'");
        await held.seen;
        expect(closed).toBe(false);
        held.answer();
        expect(await pending).toBe("resolved");
        await closing;
      });
    }),
  );

  test("close() with an invalid timeout throws and leaves the handle as it was", () =>
    scenario(async ({ sql, log }) => {
      const reserved = await sql.reserve();
      expect(await outcome(reserved.close({ timeout: -1 }))).toBe("ERR_INVALID_ARG_VALUE");
      await reserved.unsafe("SELECT 'reserved'");
      await reserved.release();
      const transaction = sql.begin(async tx => {
        const code = await outcome(tx.close({ timeout: NaN }));
        await tx.unsafe("SELECT 'tx'");
        return code;
      });
      expect(await transaction).toBe("ERR_INVALID_ARG_VALUE");
      expect(log()).toEqual(["SELECT 'reserved'", BEGIN, "SELECT 'tx'", "COMMIT"]);
    }));

  const transactionKinds: [string, (sql: SQL, fn: (tx: any) => Promise<unknown>) => Promise<unknown>, string[]][] = [
    ["begin()", (sql, fn) => sql.begin(fn), [BEGIN, "ROLLBACK"]],
    ["beginDistributed()", (sql, fn) => sql.beginDistributed("x", fn), [distributedBegin, ...distributedEnd[1]]],
    [
      "reserved.begin()",
      async (sql, fn) => {
        await using reserved = await sql.reserve();
        try {
          return await reserved.begin(fn);
        } finally {
          await reserved.unsafe("SELECT 'still reserved'");
        }
      },
      [BEGIN, "ROLLBACK", "SELECT 'still reserved'"],
    ],
  ];

  test.each(transactionKinds)(
    "tx.close({ timeout }) rolls %s back once what runs is done, and the transaction rejects",
    (_, begin, [opened, ...after]) =>
      scenario(async ({ sql, log, hold }) => {
        const held = hold("SELECT 'in flight'");
        let late: unknown;
        const transaction = begin(sql, async tx => {
          const inFlight = tx.unsafe("SELECT 'in flight'").execute();
          const closing = [tx.close({ timeout: 60 }), tx.close()];
          await held.seen;
          held.answer();
          await inFlight;
          await Promise.all(closing);
          late = await outcome(tx`SELECT 'late'`);
          await tx.close();
        });
        expect({ transaction: await outcome(transaction), late }).toEqual({
          transaction: closedCode,
          late: closedCode,
        });
        expect(log()).toEqual([opened, "SELECT 'in flight'", ...after]);
      }),
  );

  test.each(transactionKinds)(
    "tx.close() that nobody awaits rolls %s back, and nothing commits after it",
    (_, begin, [opened, ...after]) =>
      scenario(async ({ sql, log }) => {
        const transaction = begin(sql, async tx => {
          await tx.unsafe("SELECT 'T1'");
          tx.close();
          return "callback returned";
        });
        expect(await outcome(transaction)).toBe(closedCode);
        expect(log()).toEqual([opened, "SELECT 'T1'", ...after]);
      }),
  );

  // Each then() moves the callback one microtask later, so the runner and close() meet in every order.
  test("tx.close({ timeout }) and the runner send one ROLLBACK between them", () =>
    scenario(async ({ sql, log }) => {
      for (let hops = 0; hops < 4; hops++) {
        let closing: Promise<void> | undefined;
        const transaction = sql.begin(async tx => {
          let pending: Promise<unknown> = tx.unsafe("SELECT 'pending'").execute();
          for (let hop = 0; hop < hops; hop++) pending = pending.then(rows => rows);
          closing = tx.close({ timeout: 60 });
          await pending;
        });
        expect(await outcome(transaction)).toBe(closedCode);
        await closing;
      }
      let closing: Promise<void> | undefined;
      const failing = sql.begin(async tx => {
        tx.unsafe("SELECT 'pending'").execute();
        closing = tx.close({ timeout: 60 });
        throw new Error("callback failed");
      });
      expect(await outcome(failing)).toBe("callback failed");
      await closing;
      expect(log()).toEqual(Array(5).fill([BEGIN, "SELECT 'pending'", "ROLLBACK"]).flat());
    }));

  test("tx.close({ timeout }) waits for a savepoint, its RELEASE included", () =>
    scenario(async ({ sql, log }) => {
      const transaction = sql.begin(async tx => {
        const inside = parked();
        const savepoint = tx.savepoint(async sp => {
          await sp.unsafe("SELECT 'in savepoint'");
          inside.enter();
          await inside.gate;
        });
        await inside.entered;
        const closing = tx.close({ timeout: 60 });
        inside.go();
        await savepoint;
        await closing;
      });
      expect(await outcome(transaction)).toBe(closedCode);
      expect(log()).toEqual([BEGIN, "SAVEPOINT s0", "SELECT 'in savepoint'", "RELEASE SAVEPOINT s0", "ROLLBACK"]);
    }));

  test.each(["COMMIT", "ROLLBACK"])("tx.close() while %s is in flight sends nothing and waits for the answer", end =>
    scenario(async ({ sql, log, hold, options }) => {
      const held = hold(end);
      let handle!: Bun.TransactionSQL;
      const transaction = outcome(
        sql.begin(async tx => {
          handle = tx;
          await tx.unsafe("SELECT 'T1'");
          if (end === "ROLLBACK") throw new Error("t1 failed");
          return "t1";
        }),
      );
      await held.seen;
      let closed = false;
      const closing = handle.close().then(() => void (closed = true));
      // A round trip on another connection gives close() the time to settle.
      await using other = new SQL(options);
      await other.unsafe("SELECT 'ping'");
      expect(closed).toBe(false);
      held.answer();
      expect(await transaction).toBe(end === "ROLLBACK" ? "t1 failed" : "t1");
      await closing;
      expect(log()).toEqual([BEGIN, "SELECT 'T1'", end, "SELECT 'ping'"]);
    }),
  );

  // bun:test fails these if an identifier, a fragment or a query that nothing awaited is started or rejected.
  test.each<[string, (handle: any) => unknown, string[]]>([
    ["close()", handle => handle.close(), []],
    ["close({ timeout })", handle => handle.close({ timeout: 60 }), []],
    ["a dropped connection", handle => outcome(handle.unsafe("SELECT 'KILL'")), ["SELECT 'KILL'"]],
  ])("%s leaves alone what a handle made and never started", (_, end, sent) =>
    scenario(async ({ sql, log }) => {
      const makeAndDrop = (handle: any) =>
        void [handle.unsafe("SELECT 'unsafe'"), handle`SELECT 'tagged'`, handle("identifier"), handle`a = ${1}`];
      const reserved = await sql.reserve();
      makeAndDrop(reserved);
      await end(reserved);
      const transaction = sql.begin(async tx => {
        makeAndDrop(tx);
        await end(tx);
      });
      expect(await outcome(transaction)).toBe(closedCode);
      expect(log()).toEqual([...sent, BEGIN, ...(sent.length ? sent : ["ROLLBACK"])]);
    }),
  );

  test("a handle that ends while file() reads the file sends nothing", () =>
    scenario(async ({ sql, log, options }) => {
      using dir = tempDir("sql-handles-file", { "statement.sql": "SELECT 'file'" });
      const path = join(String(dir), "statement.sql");
      const reserved = await sql.reserve();
      const onReserved = outcome(reserved.file(path));
      reserved.release();
      let inTransaction!: Promise<unknown>;
      await sql.begin(async tx => {
        inTransaction = outcome(tx.file(path));
      });
      const closed = new SQL(options);
      const onClosedPool = outcome(closed.file(path));
      await closed.close();
      expect(await Promise.all([onReserved, inTransaction, onClosedPool])).toEqual([closedCode, endedCode, closedCode]);
      expect(log()).toEqual([BEGIN, "COMMIT"]);
    }));

  test("the queries of an array that a savepoint callback returns run ahead of RELEASE SAVEPOINT", () =>
    scenario(async ({ sql, log }) => {
      await sql.begin(tx => tx.savepoint(sp => [sp.unsafe("SELECT 'sp1'"), sp.unsafe("SELECT 'sp2'")]));
      expect(log()).toEqual([BEGIN, "SAVEPOINT s0", "SELECT 'sp1'", "SELECT 'sp2'", "RELEASE SAVEPOINT s0", "COMMIT"]);
    }));

  test("a statement that nothing awaits still runs when it goes out ahead of the end of its scope", () =>
    scenario(async ({ sql, log }) => {
      await sql.begin(async tx => {
        await tx.savepoint(async sp => {
          ["a", "b"].forEach(async item => void (await sp.unsafe(`SELECT 'savepoint ${item}'`)));
        });
        ["a", "b"].forEach(async item => void (await tx.unsafe(`SELECT 'transaction ${item}'`)));
      });
      expect(log()).toEqual([
        BEGIN,
        "SAVEPOINT s0",
        "SELECT 'savepoint a'",
        "SELECT 'savepoint b'",
        "RELEASE SAVEPOINT s0",
        "SELECT 'transaction a'",
        "SELECT 'transaction b'",
        "COMMIT",
      ]);
    }));

  test.each([
    { refused: "RELEASE SAVEPOINT s0", callbackFails: false },
    { refused: "ROLLBACK TO SAVEPOINT s0", callbackFails: true },
  ])(
    "a savepoint rejects with the error of the server when the server refuses $refused",
    ({ refused, callbackFails }) =>
      scenario(async ({ sql, log, refuse }) => {
        refuse(refused);
        const failure = new Error("savepoint failed");
        const result = await sql.begin(async tx => {
          let sp!: Bun.SavepointSQL;
          const savepoint = await errorOf(
            tx.savepoint(async handle => {
              sp = handle;
              await handle.unsafe("SELECT 'in savepoint'");
              if (callbackFails) throw failure;
            }),
          );
          const late = await outcome(sp.unsafe("SELECT 'late'"));
          await tx.unsafe("SELECT 'after'");
          return { savepoint: savepoint.message, cause: savepoint.cause, late };
        });
        expect(result).toEqual({
          savepoint: expect.stringContaining(`refused: ${refused}`),
          cause: callbackFails ? failure : undefined,
          late: endedCode,
        });
        expect(log()).toEqual([
          BEGIN,
          "SAVEPOINT s0",
          "SELECT 'in savepoint'",
          ...(callbackFails ? [] : ["RELEASE SAVEPOINT s0"]),
          "ROLLBACK TO SAVEPOINT s0",
          "SELECT 'after'",
          "COMMIT",
        ]);
      }),
  );

  test("a savepoint that fails while its transaction ends keeps the error of its callback", () =>
    scenario(async ({ sql, log }) => {
      const errors: string[] = [];
      for (const end of ["COMMIT", "ROLLBACK"]) {
        // The callback of the savepoint rejects this many microtasks after the one of the transaction settled.
        for (let turns = 0; turns < 8; turns++) {
          let savepoint!: Promise<string>;
          await outcome(
            sql.begin(async tx => {
              const inside = parked();
              savepoint = outcome(
                tx.savepoint(async () => {
                  inside.enter();
                  await inside.gate;
                  for (let i = 0; i < turns; i++) await null;
                  throw new Error("savepoint failed");
                }),
              );
              await inside.entered;
              inside.go();
              if (end === "ROLLBACK") throw new Error("transaction failed");
            }),
          );
          errors.push(await savepoint);
        }
      }
      expect(errors).toEqual(Array(16).fill("savepoint failed"));
      const sent = log();
      expect(
        sent.filter((text, i) => text.startsWith("ROLLBACK TO") && ["COMMIT", "ROLLBACK"].includes(sent[i - 1])),
      ).toEqual([]);
    }));

  test("a ROLLBACK that the server refuses keeps the error of the callback as cause", () =>
    scenario(async ({ sql, log, refuse }) => {
      refuse("ROLLBACK");
      const failure = new Error("callback failed");
      const err = await errorOf(
        sql.begin(async tx => {
          await tx.unsafe("SELECT 'T1'");
          throw failure;
        }),
      );
      expect(err).toBeInstanceOf(SQL.SQLError);
      expect({ message: err.message, cause: err.cause }).toEqual({
        message: expect.stringContaining("refused: ROLLBACK"),
        cause: failure,
      });
      expect(log()).toEqual([BEGIN, "SELECT 'T1'", "ROLLBACK"]);
    }));

  test.each(["ROLLBACK", "ROLLBACK TO SAVEPOINT s0"])(
    "a connection that drops at %s keeps the error of the callback as cause, on a copy of the error",
    rollback =>
      scenario(async ({ sql, drop }) => {
        drop(rollback);
        const failure = new Error("callback failed");
        let handle: any;
        const fail = async (scope: any) => {
          handle = scope;
          await scope.unsafe("SELECT 'T1'");
          throw failure;
        };
        let savepoint: Promise<any> | undefined;
        // begin() rejects at once, whatever its callback does with the error of the savepoint.
        const transaction = await errorOf(
          sql.begin(rollback === "ROLLBACK" ? fail : tx => (savepoint = errorOf(tx.savepoint(fail)))),
        );
        const withCause = savepoint ? await savepoint : transaction;
        const late = await errorOf(handle.unsafe("SELECT 'late'"));
        expect(withCause).toBeInstanceOf(SQL.SQLError);
        expect([transaction, withCause, late].map(({ code, cause }) => ({ code, cause }))).toEqual([
          { code: closedCode, cause: savepoint ? undefined : failure },
          { code: closedCode, cause: failure },
          { code: closedCode, cause: undefined },
        ]);
      }),
  );

  const work = (tx: any) => tx.unsafe("SELECT 'T1'").then(() => "done");
  const prepare = distributedEnd[0].at(-1)!;

  test.each([
    { scope: "begin()", decides: "COMMIT", run: (sql: SQL) => sql.begin(work) },
    { scope: "beginDistributed()", decides: prepare, run: (sql: SQL) => sql.beginDistributed("x", work) },
  ])("a connection that drops at $decides rejects $scope with that loss and no cause", ({ decides, run }) =>
    scenario(async ({ sql, drop }) => {
      drop(decides);
      const { code, cause } = await errorOf(run(sql));
      expect({ code, cause }).toEqual({ code: closedCode, cause: undefined });
    }),
  );

  describe("the client reads an answer and the goodbye of the server in one go", () => {
    test.each([
      { scope: "begin()", decides: "COMMIT", run: (sql: SQL) => sql.begin(work) },
      {
        scope: "begin() with an array",
        decides: "COMMIT",
        run: (sql: SQL) => sql.begin(tx => [work(tx)]).then(String),
      },
      {
        scope: "begin() on a reserved connection",
        decides: "COMMIT",
        run: (sql: SQL) => sql.reserve().then(reserved => reserved.begin(work)),
      },
      { scope: "beginDistributed()", decides: prepare, run: (sql: SQL) => sql.beginDistributed("x", work) },
    ])("$scope resolves: $decides was answered", ({ decides, run }) =>
      scenario(async ({ sql, log, leaveAfter }) => {
        leaveAfter(decides);
        expect(await outcome(run(sql))).toBe("done");
        expect(log().at(-1)).toBe(decides);
      }),
    );

    test("begin() rejects with the error that COMMIT was answered with", () =>
      scenario(async ({ sql, refuse, leaveAfter }) => {
        refuse("COMMIT");
        leaveAfter("COMMIT");
        expect((await errorOf(sql.begin(work))).message).toContain("refused: COMMIT");
      }));

    test.skipIf(entry.adapter !== "postgres")("begin() rejects: COMMIT was answered with the tag ROLLBACK", () =>
      scenario(async ({ sql, answerWithTag, leaveAfter }) => {
        answerWithTag("COMMIT", "ROLLBACK");
        leaveAfter("COMMIT");
        expect(await outcome(sql.begin(work))).toBe("ERR_POSTGRES_COMMIT_ROLLED_BACK");
      }),
    );

    test("begin() rejects with the error of its callback: ROLLBACK was answered", () =>
      scenario(async ({ sql, leaveAfter }) => {
        leaveAfter("ROLLBACK");
        const failure = new Error("callback failed");
        expect(
          await errorOf(
            sql.begin(async tx => {
              await work(tx);
              throw failure;
            }),
          ),
        ).toBe(failure);
      }));

    test.each(
      [
        { scope: "begin()", answered: BEGIN, run: (sql: SQL) => sql.begin(work) },
        { scope: "begin()", answered: "SELECT 'T1'", run: (sql: SQL) => sql.begin(work) },
        { scope: "begin()", answered: "RELEASE SAVEPOINT s0", run: (sql: SQL) => sql.begin(tx => tx.savepoint(work)) },
        { scope: "beginDistributed()", answered: "SELECT 'T1'", run: (sql: SQL) => sql.beginDistributed("x", work) },
        // XA END on MySQL: XA PREPARE is not handed over yet. PostgreSQL sends nothing ahead of PREPARE TRANSACTION.
        {
          scope: "beginDistributed()",
          answered: distributedEnd[0][0],
          run: (sql: SQL) => sql.beginDistributed("x", work),
        },
      ].filter(({ answered }) => answered !== prepare),
    )("$scope rejects with the goodbye: only $answered was answered", ({ answered, run }) =>
      scenario(async ({ sql, received, leaveAfter }) => {
        leaveAfter(answered);
        expect((await errorOf(run(sql))).message).toBe("goodbye");
        expect(received.at(-1)).toEqual({ conn: 0, sql: answered });
      }),
    );
  });

  test("a refused statement that is only started is nothing, what then(f) returns and what a handler throws is reported", () =>
    scenario(async ({ log, options }) => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const reported = [];
            const both = Promise.withResolvers();
            process.on("unhandledRejection", err => {
              if (reported.push(err.code ?? err.message) === 2) both.resolve();
            });
            const sql = new Bun.SQL(${JSON.stringify(options)});
            let ended;
            await sql.begin(async tx => {
              ended = tx;
              await tx.unsafe("SELECT 'T1'");
            });
            ended\`SELECT 'never ran'\`;
            ended\`SELECT 'never ran'\`.values();
            ended.unsafe("SELECT 'late'").execute();
            ended\`SELECT 'late'\`.execute();
            ended.unsafe("SELECT 'late'").finally(() => {});
            ended.unsafe("SELECT 'late'").then(() => {});
            ended.unsafe("SELECT 'late'").catch(() => { throw new Error("handler"); });
            await sql.unsafe("SELECT 'pool'");
            await both.promise;
            await new Promise(setImmediate);
            await sql.close();
            console.log(JSON.stringify(reported));
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout).sort()).toEqual([endedCode, "handler"].sort());
      expect(exitCode).toBe(0);
      expect(log()).toEqual([BEGIN, "SELECT 'T1'", "COMMIT", "SELECT 'pool'"]);
    }));
});

describe.concurrent("sqlite", () => {
  const closedCode = "ERR_SQLITE_CONNECTION_CLOSED";
  const endedCode = "ERR_SQLITE_INVALID_TRANSACTION_STATE";

  async function open(k = "id INTEGER PRIMARY KEY") {
    const db = new SQL("sqlite://:memory:");
    await db.unsafe(`CREATE TABLE k (${k})`);
    await db`INSERT INTO k VALUES (1), (2)`;
    await db`CREATE TRIGGER three BEFORE INSERT ON k WHEN new.id = 3 BEGIN SELECT RAISE(ROLLBACK, 'no three'); END`;
    await db`CREATE TABLE t (v TEXT)`;
    await db`INSERT INTO t VALUES ('seed')`;
    return db;
  }
  async function after(db: SQL) {
    const rows = await db`SELECT v FROM t ORDER BY rowid`;
    return { rows: rows.map((row: any) => row.v), next: await outcome(db.begin(async () => {})) };
  }
  const clean = { rows: ["seed"], next: "resolved" };

  test("close() rejects a begin() whose callback is still running, and the statements of that callback", async () => {
    const db = await open();
    const callback = parked();
    let late!: Promise<unknown[]>;
    const transaction = db.begin(async tx => {
      await tx`INSERT INTO t VALUES ('first')`;
      callback.enter();
      await callback.gate;
      late = Promise.all([tx`SELECT 1`, tx.unsafe("SELECT 1"), tx.savepoint(async () => {})].map(outcome));
    });
    await callback.entered;
    await db.close();
    expect(await outcome(transaction)).toBe(closedCode);
    callback.go();
    await callback.gate;
    expect(await late).toEqual([closedCode, closedCode, closedCode]);
  });

  test("a statement of an ended transaction or savepoint does not run, however it was made", async () => {
    await using db = await open();
    const made: PromiseLike<unknown>[] = [];
    const handles: any[] = [];
    const keep = (handle: any, name: string) => {
      handles.push(handle);
      made.push(handle.unsafe(`INSERT INTO t VALUES ('lazy ${name}')`));
    };
    await db.begin(async tx => {
      keep(tx, "committed");
      await tx.savepoint(async sp => keep(sp, "released"));
      await outcome(
        tx.savepoint(async sp => {
          keep(sp, "rolled back to");
          throw new Error("savepoint failed");
        }),
      );
      // The savepoints are over, the transaction is not.
      expect(await Promise.all(made.slice(1).map(outcome))).toEqual([endedCode, endedCode]);
    });
    await outcome(
      db.begin(async tx => {
        keep(tx, "rolled back");
        throw new Error("transaction failed");
      }),
    );
    for (const handle of handles) made.push(handle`INSERT INTO t VALUES ('late')`.values());
    expect(await Promise.all(made.map(outcome))).toEqual(Array(8).fill(endedCode));
    expect(await after(db)).toEqual(clean);
  });

  test("a failed COMMIT is rolled back: deferred foreign key", async () => {
    await using db = new SQL("sqlite://:memory:");
    await db`PRAGMA foreign_keys = ON`;
    await db`CREATE TABLE parent (id INTEGER PRIMARY KEY)`;
    await db`CREATE TABLE child (parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)`;
    const failed = await outcome(db.begin(tx => tx`INSERT INTO child VALUES (99)`));
    const next = await outcome(db.begin(tx => [tx`INSERT INTO parent VALUES (1)`, tx`INSERT INTO child VALUES (1)`]));
    expect({ failed, next, children: await db`SELECT parent_id FROM child` }).toEqual({
      failed: "SQLITE_CONSTRAINT_FOREIGNKEY",
      next: "resolved",
      children: [{ parent_id: 1 }],
    });
  });

  test("a failed COMMIT is rolled back: SQLITE_BUSY", async () => {
    using dir = tempDir("sql-handles-busy", {});
    const filename = join(String(dir), "busy.db");
    let failed: string;
    {
      await using writer = new SQL({ adapter: "sqlite", filename });
      await writer`CREATE TABLE t (v TEXT)`;
      {
        // The read lock of a second connection makes the COMMIT of the writer fail.
        using reader = new Database(filename);
        reader.run("BEGIN DEFERRED");
        reader.query("SELECT count(*) FROM t").get();
        failed = await outcome(writer.begin(tx => tx`INSERT INTO t VALUES ('in the failed transaction')`));
        reader.run("ROLLBACK");
      }
      await writer`INSERT INTO t VALUES ('later')`;
    }
    // The writer is closed. A write that was still inside an open transaction is not in the file.
    using file = new Database(filename, { readonly: true });
    expect({ failed, onDisk: file.query("SELECT v FROM t").values() }).toEqual({
      failed: "SQLITE_BUSY",
      onDisk: [["later"]],
    });
  });

  test("a write right after a failed COMMIT is kept", async () => {
    // An insert on the instance adds the missing parent row `hops` microtasks after the callback. Before COMMIT it
    // joins the transaction, and COMMIT succeeds. After the failed COMMIT a ROLLBACK that comes late would take it away.
    const outcomes: { begin: string; parents: number }[] = [];
    for (let hops = 0; hops <= 12; hops++) {
      await using db = new SQL("sqlite://:memory:");
      await db`PRAGMA foreign_keys = ON`;
      await db`CREATE TABLE parent (id INTEGER PRIMARY KEY)`;
      await db`CREATE TABLE child (parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)`;
      const inserted = Promise.withResolvers<unknown>();
      const begin = await outcome(
        db.begin(async tx => {
          await tx`INSERT INTO child VALUES (99)`;
          void (async () => {
            for (let i = 0; i < hops; i++) await null;
            inserted.resolve(db`INSERT INTO parent VALUES (99)`);
          })();
        }),
      );
      await inserted.promise;
      const [{ parents }] = await db`SELECT count(*) AS parents FROM parent`;
      outcomes.push({ begin, parents });
    }
    expect(outcomes.filter(({ parents }) => parents !== 1)).toEqual([]);
    expect(outcomes.map(({ begin }) => begin)).toContain("SQLITE_CONSTRAINT_FOREIGNKEY");
  });

  describe.each([
    {
      name: "INSERT OR ROLLBACK",
      conflict: "INSERT OR ROLLBACK INTO k VALUES (1)",
      code: "SQLITE_CONSTRAINT_PRIMARYKEY",
    },
    { name: "RAISE(ROLLBACK)", conflict: "INSERT INTO k VALUES (3)", code: "SQLITE_CONSTRAINT_TRIGGER" },
  ])("a transaction that $name rolled back", ({ conflict, code }) => {
    test.each<[string, (tx: any) => unknown, string]>([
      ["awaited", tx => tx.unsafe(conflict), code],
      ["in an array", tx => [tx.unsafe(conflict), tx`INSERT INTO t VALUES ('second')`], code],
      ["in a savepoint", tx => tx.savepoint((sp: any) => sp.unsafe(conflict)), code],
      [
        "caught by a callback that goes on",
        async tx => {
          await outcome(tx.unsafe(conflict));
          await tx`INSERT INTO t VALUES ('second')`;
        },
        endedCode,
      ],
      [
        "caught by a callback that closes",
        async tx => {
          await outcome(tx.unsafe(conflict));
          expect(await outcome(tx.close())).toBe("resolved");
        },
        closedCode,
      ],
    ])("%s: begin() rejects with the first error, and nothing runs in autocommit", async (_, body, expected) => {
      await using db = await open();
      const begin = await outcome(
        db.begin(async tx => {
          await tx`INSERT INTO t VALUES ('first')`;
          return body(tx);
        }),
      );
      expect({ begin, ...(await after(db)) }).toEqual({ begin: expected, ...clean });
    });
  });

  test("a full database: begin() rejects with SQLITE_FULL and no row is lost", async () => {
    await using db = new SQL("sqlite://:memory:");
    await db`CREATE TABLE live (id INTEGER PRIMARY KEY, payload TEXT)`;
    await db`CREATE TABLE archive (id INTEGER PRIMARY KEY, payload TEXT)`;
    const payload = Buffer.alloc(3000, "x").toString();
    for (let id = 1; id <= 40; id++) await db`INSERT INTO live VALUES (${id}, ${payload})`;
    const [{ page_count }] = await db`PRAGMA page_count`;
    await db.unsafe(`PRAGMA max_page_count = ${page_count + 6}`);
    const begin = await outcome(
      db.begin(tx => [
        ...Array.from({ length: 40 }, (_, i) => tx`INSERT INTO archive VALUES (${i + 1}, ${payload})`),
        tx`DELETE FROM live`,
      ]),
    );
    const [{ live }] = await db`SELECT count(*) AS live FROM live`;
    const [{ archive }] = await db`SELECT count(*) AS archive FROM archive`;
    expect({ begin, live, archive }).toEqual({ begin: "SQLITE_FULL", live: 40, archive: 0 });
  });

  test("a constraint error that ends only its statement leaves the transaction open", async () => {
    await using db = await open();
    await db.begin(async tx => {
      await tx`INSERT INTO t VALUES ('first')`;
      await outcome(tx`INSERT INTO k VALUES (1)`);
      await tx`INSERT INTO t VALUES ('second')`;
    });
    expect(await after(db)).toEqual({ rows: ["seed", "first", "second"], next: "resolved" });
  });

  test.each<[string, (tx: Bun.TransactionSQL) => Promise<void>, string]>([
    ["close({ timeout })", async tx => void (await tx.close({ timeout: 60 })), closedCode],
    [
      "close({ timeout }) after a query that nothing awaits",
      async tx => {
        tx`INSERT INTO t VALUES ('lazy')`;
        await tx.close({ timeout: 60 });
      },
      closedCode,
    ],
    [
      "close({ timeout }) after a query that is cancelled before it runs",
      async tx => {
        tx`INSERT INTO t VALUES ('cancelled')`.cancel();
        await tx.close({ timeout: 60 });
      },
      closedCode,
    ],
    ["close({ timeout }) that nobody awaits", async tx => void tx.close({ timeout: 60 }), closedCode],
    ["close() that nobody awaits", async tx => void tx.close(), closedCode],
    [
      "close() of a savepoint",
      async tx => void (await outcome(tx.savepoint(async sp => void (await sp.close())))),
      closedCode,
    ],
    [
      "close({ timeout }) and a callback that throws",
      async tx => {
        tx.close({ timeout: 60 });
        throw new Error("callback failed");
      },
      "callback failed",
    ],
  ])("%s rolls the transaction back", async (_, close, expected) => {
    await using db = await open();
    const begin = await outcome(
      db.begin(async tx => {
        await tx`INSERT INTO t VALUES ('first')`;
        await close(tx);
      }),
    );
    expect({ begin, ...(await after(db)) }).toEqual({ begin: expected, ...clean });
  });

  test("close() of a savepoint handle whose savepoint is over does nothing", async () => {
    await using db = await open();
    await db.begin(async tx => {
      let released!: Bun.SavepointSQL;
      await tx.savepoint(async sp => void (released = sp));
      await released.close();
      await tx`INSERT INTO t VALUES ('first')`;
    });
    expect(await after(db)).toEqual({ rows: ["seed", "first"], next: "resolved" });
  });

  // ROLLBACK TO SAVEPOINT works only for an open savepoint, so inside the callback it tells which name SAVEPOINT carried.
  test.each<[string, string, (tx: any, fn: (sp: any) => unknown) => Promise<unknown>]>([
    ['savepoint("audit", fn)', "s0_audit", (tx, fn) => tx.savepoint("audit", fn)],
    ["savepoint(fn)", "s0", (tx, fn) => tx.savepoint(fn)],
    ['savepoint(fn, "audit")', "s0_audit", (tx, fn) => tx.savepoint(fn, "audit")],
    ['savepoint("a-b c", fn)', "s0_a_b_c", (tx, fn) => tx.savepoint("a-b c", fn)],
    ["savepoint(fn, fn)", "s0", (tx, fn) => tx.savepoint(() => expect.unreachable(), fn)],
  ])("%s sends SAVEPOINT %s", async (_, name, call) => {
    await using db = await open();
    const names = ["s0", "s0_audit", "s0_a_b_c"];
    const probe = (sp: any) => Promise.all(names.map(name => outcome(sp.unsafe(`ROLLBACK TO SAVEPOINT ${name}`))));
    const answers = (await db.begin(tx => call(tx, probe))) as string[];
    expect(names.filter((_, i) => answers[i] === "resolved")).toEqual([name]);
  });

  test('savepoint("audit") without a function rejects', async () => {
    await using db = await open();
    expect(await errorOf(db.begin((tx: any) => tx.savepoint("audit")))).toMatchObject({
      code: "ERR_INVALID_ARG_VALUE",
      message: "The argument 'fn' must be a function. Received 'audit'",
    });
  });
});

describe.concurrent("every handle", () => {
  /** `sql`, `tx` and `sp` of one SQLite client. `reserved` is in sql-handles-servers.test.ts. */
  async function onEveryHandle(use: (handle: any, name: string) => unknown) {
    await using sql = new SQL("sqlite://:memory:");
    await use(sql, "sql");
    await sql.begin(async tx => {
      await use(tx, "tx");
      await tx.savepoint(sp => use(sp, "sp"));
    });
  }

  test("is an instance of SQL, and still a function", async () => {
    expect(Object.getOwnPropertyDescriptor(SQL, "prototype")).toEqual({
      value: SQL.prototype,
      writable: false,
      enumerable: false,
      configurable: false,
    });
    expect(Object.getOwnPropertyDescriptor(SQL.prototype, "constructor")).toEqual({
      value: SQL,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    expect(Object.getPrototypeOf(SQL.prototype)).toBe(Function.prototype);
    expect(Bun.sql instanceof SQL).toBe(true);
    await using withoutNew = (SQL as unknown as (url: string) => SQL)("sqlite://:memory:");
    expect(withoutNew instanceof SQL).toBe(true);
    await onEveryHandle(async handle => {
      expect(handle instanceof SQL).toBe(true);
      expect(handle.bind).toBe(Function.prototype.bind);
      const { unsafe } = handle;
      expect(await unsafe("SELECT 1 AS x")).toEqual([{ x: 1 }]);
    });
  });

  test("new on a subclass of SQL throws, a new.target with SQL.prototype is not a subclass", async () => {
    class Subclass extends SQL {}
    expect(() => new Subclass("sqlite://:memory:")).toThrow(
      new TypeError(
        "Bun.SQL cannot be subclassed. Its methods are own properties of the client, so a subclass cannot override them. Wrap the client instead.",
      ),
    );
    expect(() => Reflect.construct(SQL, ["sqlite://:memory:"], Object)).toThrow("Bun.SQL cannot be subclassed");
    await using proxied = new new Proxy(SQL, {})("sqlite://:memory:");
    await using bound = new (SQL.bind(null, "sqlite://:memory:"))();
    expect([proxied instanceof SQL, bound instanceof SQL]).toEqual([true, true]);
  });

  // The strings of a template object are SQL text. Only the engine and the helpers of the compilers make an array
  // with an own, non-enumerable `raw`: data cannot.
  const injected = "(0) UNION SELECT 'secret'";
  test.each<[string, () => any, "parameters" | "throws" | "text"]>([
    ["raw assigned", () => Object.assign([injected], { raw: [] }), "throws"],
    [
      "raw merged in from JSON",
      () => Object.assign([], JSON.parse(`{"0":${JSON.stringify(injected)},"raw":[]}`)),
      "throws",
    ],
    [
      "a frozen clone of a template object",
      () => Object.freeze(Object.assign([injected], { raw: [injected] })),
      "throws",
    ],
    [
      "raw inherited",
      () => Object.setPrototypeOf([injected], Object.create(Array.prototype, { raw: { value: [] } })),
      "parameters",
    ],
    ["raw that is not an array", () => Object.assign([injected], { raw: "x" }), "parameters"],
    ["raw defined like a compiler does", () => Object.defineProperty([injected], "raw", { value: [injected] }), "text"],
    ["a template object passed on", () => (strings => strings)`(0) UNION SELECT 'secret'`, "text"],
  ])("an array with %s", async (_, make, expected) => {
    await onEveryHandle(async handle => {
      if (expected === "throws") {
        expect(thrownBy(() => handle(make()))).toMatchObject({
          code: "ERR_INVALID_ARG_VALUE",
          message: expect.stringContaining("has an enumerable 'raw' property, so it is not a template object"),
        });
        return;
      }
      const rows = await handle`SELECT 'public' AS v WHERE 1 IN ${handle(make())}`.values();
      expect(rows).toEqual(expected === "text" ? [["secret"]] : []);
    });
  });

  test("an identifier with a NUL byte throws where it is made", async () => {
    await onEveryHandle(handle => {
      expect(thrownBy(() => handle("a\0b"))).toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
    });
  });

  test("unsafe() and file() read the array of values once, in the call", async () => {
    using dir = tempDir("sql-handles-values", { "statement.sql": "SELECT ? AS a, ? AS b" });
    await onEveryHandle(async handle => {
      for (const make of [
        (values: unknown[]) => handle.unsafe("SELECT ? AS a, ? AS b", values),
        (values: unknown[]) => handle.file(join(String(dir), "statement.sql"), values),
      ]) {
        const values = [1, "a"];
        const query = make(values);
        values[0] = 2;
        values.length = 1;
        expect(await query).toEqual([{ a: 1, b: "a" }]);
      }
    });
  });

  test("file() is a lazy Query", async () => {
    using dir = tempDir("sql-handles-file", { "statement.sql": "INSERT INTO t VALUES (?) RETURNING v" });
    const path = join(String(dir), "statement.sql");
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (v TEXT)`;
    const Query = sql`SELECT 1`.constructor;
    // bun:test fails this test if the file that does not exist is reported: nothing reads it.
    const never = [sql.file(path, ["never awaited"]), sql.file(join(String(dir), "missing.sql"))];
    expect(never.map(query => query instanceof Query)).toEqual([true, true]);
    expect(await sql.file(path, ["values"]).values()).toEqual([["values"]]);
    expect(await sql.file(path, ["raw"]).raw()).toEqual([[Buffer.from("raw")]]);
    expect(await sql.file(path, ["objects"])).toEqual([{ v: "objects" }]);
    expect(await outcome(sql.file(join(String(dir), "missing.sql")))).toBe("ENOENT");
    const cancelled = sql.file(path, ["cancelled while the file is read"]).execute();
    cancelled.cancel();
    expect(await outcome(cancelled)).toBe("ERR_SQLITE_QUERY_CANCELLED");
    expect(await sql`SELECT v FROM t`.values()).toEqual([["values"], ["raw"], ["objects"]]);
  });

  test("json() is the text that is bound", async () => {
    await onEveryHandle(async handle => {
      expect(handle.json({ a: [1, "b"] })).toBe('{"a":[1,"b"]}');
      expect(await handle`SELECT ${handle.json("text")} AS v`).toEqual([{ v: '"text"' }]);
    });
    expect(Bun.sql.json).toBeFunction();
  });
});

describe("the default client called with new", () => {
  const sql = Bun.sql as unknown as typeof SQL;

  test.each<[string, string | URL, any, object]>([
    ["sqlite", "sqlite://:memory:", { safeIntegers: true }, { adapter: "sqlite", safeIntegers: true }],
    ["postgres", "postgres://u:p@h:5432/db", { max: 3, tls: true }, { adapter: "postgres", max: 3, sslMode: 2 }],
    [
      "a URL object",
      new URL("postgres://u:p@h:5432/db"),
      { hostname: "other" },
      { adapter: "postgres", hostname: "other" },
    ],
    ["mysql", "mysql://u:p@h:3306/db", { max: 3 }, { adapter: "mysql", max: 3 }],
  ])("new sql(url, options) applies the options: %s", async (_, url, options, expected) => {
    await using fromDefaultClient = new sql(url, options);
    await using fromClass = new SQL(url, options);
    expect(fromDefaultClient.options).toMatchObject(expected);
    expect(fromDefaultClient.options).toEqual(fromClass.options);
  });

  test("new sql(url, options) rejects an invalid option, new sql(url) has the defaults", async () => {
    expect(() => new sql("postgres://u:p@h:5432/db", { max: 0 })).toThrow(
      expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_VALUE" }),
    );
    await using fromUrl = new sql("postgres://u:p@h:5432/db");
    expect(fromUrl.options).toMatchObject({ adapter: "postgres", hostname: "h", max: 10 });
    await using fromPostgres = new (Bun.postgres as unknown as typeof SQL)("postgres://u:p@h:5432/db", { max: 3 });
    expect(fromPostgres.options).toMatchObject({ adapter: "postgres", hostname: "h", max: 3 });
  });

  test("a SQLite client opened with { readonly: true } refuses a write", async () => {
    using dir = tempDir("sql-handles-readonly", {});
    const url = `sqlite://${join(String(dir), "app.db")}`;
    {
      await using setup = new SQL(url);
      await setup`CREATE TABLE t (id INTEGER)`;
    }
    await using db = new sql(url, { readonly: true });
    expect(await outcome(db`INSERT INTO t VALUES (1)`)).toBe("SQLITE_READONLY");
  });
});

// Not concurrent: they count the objects of the heap, or replace a method of every query.
describe("what a handle keeps", () => {
  // heapStats() counts a query as a Promise.
  const liveQueries = () => (Bun.gc(true), heapStats().objectTypeCounts.Promise ?? 0);

  test("a transaction and a savepoint do not keep what never started", async () => {
    await using sql = new SQL("sqlite://:memory:");
    const neverStarted: ((handle: any) => unknown)[] = [
      handle => void handle("a"),
      handle => void handle`a = ${1}`,
      handle => void handle.unsafe("a = 1"),
      handle => handle`SELECT 1 AS ${handle("a")} WHERE ${handle`1 = 1`}`,
      // its text cannot be built
      handle => outcome(handle`SELECT ${handle({ a: 1 })}`),
      handle => void handle`SELECT 1`.cancel(),
    ];
    const perHandle = 20;
    const kept = await sql.begin(tx =>
      tx.savepoint(async sp => {
        const before = liveQueries();
        for (const handle of [tx, sp]) {
          for (let i = 0; i < perHandle; i++) {
            for (const make of neverStarted) await make(handle);
          }
        }
        return liveQueries() - before;
      }),
    );
    // Seven such objects, `perHandle` times, on two handles: 280. One kind alone is 40.
    expect(kept).toBeLessThan(2 * perHandle);
  });

  test("a query that outlives its transaction does not keep the result of begin()", async () => {
    await using sql = new SQL("sqlite://:memory:");
    const queries: unknown[] = [];
    const results: WeakRef<object>[] = [];
    for (let i = 0; i < 50; i++) {
      results.push(
        new WeakRef(
          await sql.begin(async tx => {
            queries.push(tx`SELECT 1`);
            return { i };
          }),
        ),
      );
    }
    // A WeakRef keeps its target alive until the job that made it ends.
    await new Promise<void>(resolve => setImmediate(resolve));
    Bun.gc(true);
    expect(results.filter(result => result.deref() !== undefined).length).toBeLessThan(10);
    expect(queries.length).toBe(50);
  });

  test.each(adapters)("$adapter: close() cancels no statement that begin() or savepoint() sent itself", entry =>
    withServer(entry, async ({ sql, log, hold }) => {
      const prototype = Object.getPrototypeOf(sql`SELECT 1`);
      const cancel = prototype.cancel;
      let cancelled = 0;
      prototype.cancel = function () {
        cancelled++;
        return cancel.call(this);
      };
      try {
        const held = hold("SAVEPOINT s0");
        const transaction = sql.begin(async tx => {
          const savepoint = outcome(tx.savepoint(async () => {}));
          await held.seen;
          const closing = tx.close();
          held.answer();
          await closing;
          await savepoint;
        });
        expect(await outcome(transaction)).toBe(entry.closedCode);
        expect({ cancelled, log: log() }).toEqual({ cancelled: 0, log: [entry.BEGIN, "SAVEPOINT s0", "ROLLBACK"] });
      } finally {
        prototype.cancel = cancel;
      }
    }),
  );
});
