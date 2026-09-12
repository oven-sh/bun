// Spawned by sql-empty-column-name.test.ts. Takes a JSON array of jobs on the
// command line and, for each one in order, serves one result set from an
// in-process mock server, queries it with Bun.SQL and prints one line of JSON:
// the job without its `names`, plus the decoded `rows`. One process runs many
// jobs because a debug build pays most of a second to start up and
// milliseconds per job. It is still a separate process because the bug under
// test takes the whole process down: a crash shows up as a truncated list of
// lines plus a signal, not as a dead test runner.
//
// A job is `{ adapter: "postgres" | "mysql", protocol: "simple" | "prepared",
// names: string[], ...rest }`; `rest` is echoed back untouched. Every column
// holds the text value "v<index>". The mock servers ignore the statement text;
// the result set they return is defined entirely by the names.
//
// All wire bytes come from ./wire-frames.ts.

import { SQL } from "bun";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlColumnDefinition,
  mysqlHandshakeV10,
  mysqlLenencInt,
  mysqlLenencStr,
  mysqlOkPacket,
  mysqlRawPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
  mysqlTextResultSet,
  pgAuthenticationOk,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgParameterDescription,
  pgParseComplete,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

type Job = { adapter: "postgres" | "mysql"; protocol: "simple" | "prepared"; names: string[] };

const PG_TEXT_OID = 25;
const COM_QUERY = 0x03;
const COM_STMT_PREPARE = 0x16;
const COM_STMT_EXECUTE = 0x17;
const COM_STMT_CLOSE = 0x19;
const MYSQL_TYPE_VAR_STRING = 0xfd;

const valuesFor = (names: string[]) => names.map((_, i) => `v${i}`);

async function postgresServer(names: string[]) {
  const values = valuesFor(names);
  const rowDescription = pgRowDescription(names.map(name => ({ name, typeOid: PG_TEXT_OID })));
  const resultRows = Buffer.concat([pgDataRow(values.map(v => Buffer.from(v))), pgCommandComplete("SELECT 1")]);
  return listeningServer(socket => {
    socket.on("error", () => {});
    let startup = true;
    let buffered = Buffer.alloc(0);
    socket.on("data", data => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
        return;
      }
      const out: Buffer[] = [];
      buffered = pgReadFrontendMessages(Buffer.concat([buffered, data]), type => {
        switch (String.fromCharCode(type)) {
          case "Q": // simple query
            out.push(rowDescription, resultRows, pgReadyForQuery());
            break;
          case "P": // Parse
            out.push(pgParseComplete());
            break;
          case "D": // Describe (statement)
            out.push(pgParameterDescription([]), rowDescription);
            break;
          case "B": // Bind
            out.push(pgBindComplete());
            break;
          case "E": // Execute
            out.push(resultRows);
            break;
          case "S": // Sync
            out.push(pgReadyForQuery());
            break;
        }
      });
      if (out.length) socket.write(Buffer.concat(out));
    });
  });
}

async function mysqlServer(names: string[]) {
  const values = valuesFor(names);
  const columns = names.map(name => ({ name, type: MYSQL_TYPE_VAR_STRING }));
  const columnDefinitions = (firstSeq: number) =>
    Buffer.concat(columns.map((column, i) => mysqlColumnDefinition(firstSeq + i, column)));
  // Binary protocol row: 0x00 header, NULL bitmap with a 2-bit offset, then
  // one string<lenenc> per VAR_STRING column.
  const binaryRow = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.alloc(Math.floor((names.length + 7 + 2) / 8)),
    ...values.map(v => mysqlLenencStr(v)),
  ]);
  return listeningServer(socket => {
    socket.on("error", () => {});
    socket.write(mysqlHandshakeV10());
    let authed = false;
    let buffered = Buffer.alloc(0);
    socket.on("data", data => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, data]), (seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(seq + 1));
          return;
        }
        if (mysqlAckSessionSetup(socket, payload)) return;
        switch (payload[0]) {
          case COM_QUERY:
            socket.write(mysqlTextResultSet(1, columns, [values]));
            break;
          case COM_STMT_PREPARE:
            socket.write(Buffer.concat([mysqlStmtPrepareOk(1, 1, names.length, 0), columnDefinitions(2)]));
            break;
          case COM_STMT_EXECUTE:
            socket.write(
              Buffer.concat([
                mysqlRawPacket(1, mysqlLenencInt(names.length)),
                columnDefinitions(2),
                mysqlRawPacket(2 + names.length, binaryRow),
                mysqlOkPacket(3 + names.length, 0xfe),
              ]),
            );
            break;
          case COM_STMT_CLOSE:
            break; // no response
          default: // COM_QUIT
            socket.end();
        }
      });
    });
  });
}

const jobs: Job[] = JSON.parse(process.argv[2]);
for (const { names, ...job } of jobs) {
  const { server, port } = job.adapter === "postgres" ? await postgresServer(names) : await mysqlServer(names);
  try {
    await using sql = new SQL({ url: `${job.adapter}://u@127.0.0.1:${port}/db`, max: 1 });
    const query = sql`select 1`;
    const rows = await (job.protocol === "simple" ? query.simple() : query);
    console.log(JSON.stringify({ ...job, rows }));
  } finally {
    server.close();
  }
}
