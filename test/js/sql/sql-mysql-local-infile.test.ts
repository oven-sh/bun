// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

// Bun never negotiates CLIENT_LOCAL_FILES, so only a server that ignores the capability flags
// answers a query with a LOCAL INFILE request (0xFB). It has to fail that query and leave the
// pooled connection usable.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import {
  listeningServer,
  MYSQL_SERVER_MORE_RESULTS_EXISTS,
  MYSQL_SERVER_STATUS_AUTOCOMMIT,
  mysqlHandshakeV10,
  mysqlLocalInfileRequest,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
  mysqlTextResultSet,
} from "./wire-frames";

const COM_QUERY = 0x03;
const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const MYSQL_TYPE_VAR_STRING = 0xfd;

type Mock = {
  port: number;
  close: () => Promise<void>;
  /** sequence ids of the mock's 0xFB request and of the empty packet the client answered it with */
  exchange: () => { localInfileRequest: number | null; emptyFilePacket: number | null };
};

// Answers every LOAD DATA query (COM_QUERY or COM_STMT_EXECUTE) with a LOCAL INFILE request,
// every other query with a one-row result set, and the client's empty file packet with an OK.
// `moreResults` makes that OK the first half of a multi-statement batch: it sets
// SERVER_MORE_RESULTS_EXISTS and the next statement's result set follows immediately.
async function localInfileServer({ moreResults = false } = {}): Promise<Mock> {
  let localInfileRequest: number | null = null;
  let emptyFilePacket: number | null = null;

  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    let trailingResultSetSeq: number | null = null;
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(seq + 1));
          return;
        }
        // A command packet always carries at least its command byte, so an empty payload is
        // the end-of-file marker that terminates a LOCAL INFILE transfer.
        if (payload.length === 0) {
          emptyFilePacket = seq;
          if (moreResults) {
            socket.write(
              mysqlOkPacket(seq + 1, 0x00, MYSQL_SERVER_STATUS_AUTOCOMMIT | MYSQL_SERVER_MORE_RESULTS_EXISTS),
            );
            trailingResultSetSeq = seq + 2;
            return;
          }
          socket.write(mysqlOkPacket(seq + 1));
          return;
        }
        // Running the batch's second statement takes the server a moment, so its result set only
        // goes out once the client has sent something else: a client that moved on sees the result
        // set land on that next query instead.
        if (trailingResultSetSeq !== null) {
          socket.write(
            mysqlTextResultSet(
              trailingResultSetSeq,
              [{ name: "v", type: MYSQL_TYPE_VAR_STRING }],
              [["trailing-result-set"]],
            ),
          );
          trailingResultSetSeq = null;
          return;
        }
        const command = payload[0];
        if (command === COM_STMT_PREPARE) {
          socket.write(mysqlStmtPrepareOk(seq + 1, 1, 0, 0));
          return;
        }
        if (command === COM_QUERY || command === COM_STMT_EXECUTE) {
          // COM_STMT_EXECUTE carries no SQL, so the prepared LOAD DATA is recognized by being
          // the only statement this mock ever prepares.
          const isLoadData =
            command === COM_STMT_EXECUTE || payload.subarray(1).toString("utf-8").startsWith("LOAD DATA");
          if (isLoadData) {
            localInfileRequest = seq + 1;
            socket.write(mysqlLocalInfileRequest(seq + 1, "/tmp/bun-local-infile-does-not-exist.csv"));
            return;
          }
          socket.write(mysqlTextResultSet(seq + 1, [{ name: "v", type: MYSQL_TYPE_VAR_STRING }], [["still-usable"]]));
          return;
        }
        socket.end();
      });
    });
    socket.on("error", () => {});
  });

  return {
    port,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
    exchange: () => ({ localInfileRequest, emptyFilePacket }),
  };
}

// A LOCAL INFILE request is the server's 1st packet in answer to the command (sequence id 1), and
// the empty packet that ends the file transfer continues that sequence. A real server rejects any
// other sequence id.
const refusedTransfer = { localInfileRequest: 1, emptyFilePacket: 2 };

// A wedged query never settles, so the fixtures bound every await on one shared deadline and
// report "pending" for whatever the wedge swallowed. Nothing waits for it on a fixed build.
const outcomeHelper = /* js */ `
  const deadline = Bun.sleep(3000).then(() => "pending");
  const outcome = promise =>
    Promise.race([
      promise.then(
        value => ({ status: "fulfilled", value }),
        reason => ({ status: "rejected", code: reason?.code, message: reason?.message }),
      ),
      deadline,
    ]);
`;

async function runFixture(port: number, fixture: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture.replaceAll("__PORT__", String(port))],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode };
}

const localInfileRejection = {
  status: "rejected",
  code: "ERR_MYSQL_LOCAL_INFILE_NOT_SUPPORTED",
  message: "LOAD DATA LOCAL INFILE is not supported",
};

const connectionDropped = {
  status: "rejected",
  code: "ERR_MYSQL_LOCAL_INFILE_NOT_SUPPORTED",
  message: "Connection closed",
};

test.concurrent("MySQL: a LOCAL INFILE request fails the query instead of wedging the connection", async () => {
  const mock = await localInfileServer();
  try {
    const { stdout, stderr, exitCode, signalCode } = await runFixture(
      mock.port,
      /* js */ `
        const { SQL } = require("bun");
        ${outcomeHelper}
        const sql = new SQL({ url: "mysql://root@127.0.0.1:__PORT__/db", max: 1 });

        const loadData = sql.unsafe("LOAD DATA LOCAL INFILE 'x.csv' INTO TABLE t");
        // Queued behind the LOAD DATA on the single pooled connection.
        const queued = sql.unsafe("SELECT 'still-usable' AS v");

        console.log(JSON.stringify({
          loadData: await outcome(loadData),
          queued: await outcome(queued),
          closed: await outcome(sql.close()),
        }));
        process.exit(0);
      `,
    );

    expect({ stderr, stdout, signalCode }).toEqual({
      stderr: expect.any(String),
      stdout: expect.stringMatching(/^\{.*\}$/),
      signalCode: null,
    });
    expect(JSON.parse(stdout)).toEqual({
      loadData: localInfileRejection,
      queued: { status: "fulfilled", value: [{ v: "still-usable" }] },
      closed: { status: "fulfilled" },
    });
    expect(mock.exchange()).toEqual(refusedTransfer);
    expect(exitCode).toBe(0);
  } finally {
    await mock.close();
  }
});

test.concurrent("MySQL: a LOCAL INFILE request to a prepared statement fails the query", async () => {
  const mock = await localInfileServer();
  try {
    const { stdout, stderr, exitCode, signalCode } = await runFixture(
      mock.port,
      /* js */ `
        const { SQL } = require("bun");
        ${outcomeHelper}
        const sql = new SQL({ url: "mysql://root@127.0.0.1:__PORT__/db", max: 1 });

        // A tagged template with no parameters still goes through COM_STMT_PREPARE / COM_STMT_EXECUTE.
        const loadData = sql\`LOAD DATA LOCAL INFILE 'x.csv' INTO TABLE t\`;

        console.log(JSON.stringify({
          loadData: await outcome(loadData),
          reused: await outcome(sql.unsafe("SELECT 'still-usable' AS v")),
          closed: await outcome(sql.close()),
        }));
        process.exit(0);
      `,
    );

    expect({ stderr, stdout, signalCode }).toEqual({
      stderr: expect.any(String),
      stdout: expect.stringMatching(/^\{.*\}$/),
      signalCode: null,
    });
    expect(JSON.parse(stdout)).toEqual({
      loadData: localInfileRejection,
      reused: { status: "fulfilled", value: [{ v: "still-usable" }] },
      closed: { status: "fulfilled" },
    });
    expect(mock.exchange()).toEqual(refusedTransfer);
    expect(exitCode).toBe(0);
  } finally {
    await mock.close();
  }
});

test.concurrent("MySQL: a LOCAL INFILE request inside a statement batch fails the connection", async () => {
  const mock = await localInfileServer({ moreResults: true });
  try {
    const { stdout, stderr, exitCode, signalCode } = await runFixture(
      mock.port,
      /* js */ `
        const { SQL } = require("bun");
        ${outcomeHelper}
        const sql = new SQL({ url: "mysql://root@127.0.0.1:__PORT__/db", max: 1 });

        // The OK for the refused file carries SERVER_MORE_RESULTS_EXISTS, so the result set of the
        // batch's second statement still arrives. It belongs to no query now that this one failed.
        const loadData = sql.unsafe("LOAD DATA LOCAL INFILE 'x.csv' INTO TABLE t; SELECT 2");
        const queued = sql.unsafe("SELECT 'still-usable' AS v");

        console.log(JSON.stringify({
          loadData: await outcome(loadData),
          queued: await outcome(queued),
        }));
        process.exit(0);
      `,
    );

    expect({ stderr, stdout, signalCode }).toEqual({
      stderr: expect.any(String),
      stdout: expect.stringMatching(/^\{.*\}$/),
      signalCode: null,
    });
    // The connection is dropped, so the queued query runs on a fresh one and gets its own rows:
    // it never sees the trailing result set that the batch's second statement produced.
    expect(JSON.parse(stdout)).toEqual({
      loadData: connectionDropped,
      queued: { status: "fulfilled", value: [{ v: "still-usable" }] },
    });
    expect(mock.exchange()).toEqual(refusedTransfer);
    expect(exitCode).toBe(0);
  } finally {
    await mock.close();
  }
});
