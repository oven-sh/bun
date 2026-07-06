// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

// Bun never negotiates CLIENT_LOCAL_FILES, so a compliant server answers LOAD DATA LOCAL
// INFILE with an ERR packet. A server that ignores the capability flags answers with a LOCAL
// INFILE request (0xFB) instead, and MySQLConnection.handle_result_set used to read that 0xFB
// as a length-encoded column count of 251: the query then waited for 251 column definitions
// that never arrive, wedging it and every query queued behind it on that pooled connection
// forever, with no error and no timeout.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import {
  listeningServer,
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
  /** true once the mock answered a LOAD DATA query with a 0xFB LOCAL INFILE request */
  sentLocalInfileRequest: () => boolean;
  /** true once the client ended the refused file transfer with the protocol-mandated empty packet */
  sawEmptyFilePacket: () => boolean;
};

// Answers every LOAD DATA query (COM_QUERY or COM_STMT_EXECUTE) with a LOCAL INFILE request,
// every other query with a one-row result set, and the client's empty file packet with an OK.
async function localInfileServer(): Promise<Mock> {
  let sentLocalInfileRequest = false;
  let sawEmptyFilePacket = false;

  const { server, port } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
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
          sawEmptyFilePacket = true;
          socket.write(mysqlOkPacket(seq + 1));
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
            sentLocalInfileRequest = true;
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
    sentLocalInfileRequest: () => sentLocalInfileRequest,
    sawEmptyFilePacket: () => sawEmptyFilePacket,
  };
}

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

test("MySQL: a LOCAL INFILE request fails the query instead of wedging the connection", async () => {
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
    expect({
      sentLocalInfileRequest: mock.sentLocalInfileRequest(),
      sawEmptyFilePacket: mock.sawEmptyFilePacket(),
    }).toEqual({
      sentLocalInfileRequest: true,
      sawEmptyFilePacket: true,
    });
    expect(exitCode).toBe(0);
  } finally {
    await mock.close();
  }
});

test("MySQL: a LOCAL INFILE request to a prepared statement fails the query", async () => {
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
    expect({
      sentLocalInfileRequest: mock.sentLocalInfileRequest(),
      sawEmptyFilePacket: mock.sawEmptyFilePacket(),
    }).toEqual({
      sentLocalInfileRequest: true,
      sawEmptyFilePacket: true,
    });
    expect(exitCode).toBe(0);
  } finally {
    await mock.close();
  }
});
