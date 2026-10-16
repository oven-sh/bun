// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.
//
// Invariant: after ErrorResponse rejects the current request it stays queued
// until ReadyForQuery; DataRow / CommandComplete / EmptyQueryResponse /
// CloseComplete arriving in that window must be consumed and discarded, never
// routed to the released request.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// the fixture is a debug+ASan subprocess; allow headroom for its startup
test("postgres: DataRow arriving after ErrorResponse is discarded, not routed to the rejected query", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "postgres-error-then-datarow.fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 25_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: stdout.trim().split(/\r?\n/),
    exitCode,
    signalCode: proc.signalCode,
    // not asserted (ASan/debug builds emit benign notes); included so the
    // panic/ASan report shows up in the diff when the fixture dies
    stderr,
  }).toEqual({
    stdout: ["FIRST ERR_POSTGRES_SERVER_ERROR", 'SECOND [{"b":"ok"}]'],
    exitCode: 0,
    signalCode: null,
    stderr: expect.any(String),
  });
}, 30_000);

test("postgres: a failing simple query leaves an unrelated cached prepared statement in place", async () => {
  const wireFrames = JSON.stringify(path.join(import.meta.dir, "wire-frames.ts"));
  const script = `
    import { SQL } from "bun";
    import {
      listeningServer,
      pgAuthenticationOk,
      pgBindComplete,
      pgErrorResponse,
      pgParameterDescription,
      pgParseComplete,
      pgRaw,
      pgReadFrontendMessages,
      pgReadyForQuery,
    } from ${wireFrames};

    const parses = [];
    const { port, server } = await listeningServer(socket => {
      let startup = true;
      let buffered = Buffer.alloc(0);
      socket.on("data", data => {
        if (startup) {
          startup = false;
          socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
          return;
        }
        buffered = Buffer.concat([buffered, data]);
        const out = [];
        buffered = pgReadFrontendMessages(buffered, (type, body) => {
          switch (String.fromCharCode(type)) {
            case "P":
              parses.push(body.subarray(0, body.indexOf(0)).toString("latin1"));
              out.push(pgParseComplete());
              break;
            case "D":
              out.push(pgParameterDescription([]), pgRaw("n", Buffer.alloc(0)));
              break;
            case "B":
              out.push(pgBindComplete());
              break;
            case "E":
              out.push(pgRaw("I", Buffer.alloc(0)));
              break;
            case "S":
              out.push(pgReadyForQuery());
              break;
            case "Q":
              out.push(pgErrorResponse({ S: "ERROR", C: "42601", M: "syntax error" }), pgReadyForQuery());
              break;
          }
        });
        if (out.length) socket.write(Buffer.concat(out));
      });
      socket.on("error", () => {});
    });

    const sql = new SQL({ url: "postgres://u@127.0.0.1:" + port + "/db", max: 1, idleTimeout: 5, connectionTimeout: 5 });
    const first = await sql\`\`;
    const failed = await sql.unsafe("x").then(
      () => "resolved",
      e => e.code,
    );
    const second = await sql\`\`;
    const third = await sql\`\`;
    console.log(JSON.stringify({ first, failed, second, third, parses }));
    await sql.close({ timeout: 0 });
    await new Promise(resolve => server.close(() => resolve()));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 25_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: stdout.trim(),
    exitCode,
    signalCode: proc.signalCode,
    stderr,
  }).toEqual({
    stdout: JSON.stringify({ first: [], failed: "ERR_POSTGRES_SYNTAX_ERROR", second: [], third: [], parses: ["P$0"] }),
    exitCode: 0,
    signalCode: null,
    stderr: expect.any(String),
  });
}, 30_000);
