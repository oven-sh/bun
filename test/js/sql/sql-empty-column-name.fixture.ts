// For each job of the JSON array in argv, in order: serves one result set from a mock server that ignores the statement
// text, and prints the job without its `names`, plus the decoded `rows`. In its own process because a failure kills it.
import { SQL } from "bun";
import {
  listeningServer,
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

type Job = { protocol: "simple" | "prepared"; names: string[] };

const PG_TEXT_OID = 25;

async function postgresServer(names: string[]) {
  const values = names.map((_, i) => `v${i}`);
  const rowDescription = pgRowDescription(names.map(name => ({ name, typeOid: PG_TEXT_OID })));
  const resultRows = Buffer.concat([pgDataRow(values.map(v => Buffer.from(v))), pgCommandComplete("SELECT 1")]);
  return listeningServer(socket => {
    socket.on("error", () => {});
    let startup = true;
    let buffered = Buffer.alloc(0);
    socket.on("data", (data: Buffer) => {
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

const jobs: Job[] = JSON.parse(process.argv[2]);
for (const { names, ...job } of jobs) {
  const { server, port } = await postgresServer(names);
  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1 });
    const query = sql`select 1`;
    const rows = await (job.protocol === "simple" ? query.simple() : query);
    console.log(JSON.stringify({ ...job, rows }));
  } finally {
    server.close();
  }
}
