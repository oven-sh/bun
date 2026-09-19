// A MySQL connection unrefs the event loop once it has nothing in flight.
// Enqueueing a query on it has to ref the loop again, otherwise a script whose
// next query lands on an idle pool connection (after sql.begin(), after
// reserve() + release(), or simply on a later event loop turn) exits with code
// 0 while that query is still pending. Each scenario runs in its own process
// because the test runner keeps the event loop alive on its own; see the
// fixture for what each scenario sets up. The scenarios run against a mock
// server (everywhere, including platforms without docker) and against a real
// one.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, describeWithContainer, normalizeBunSnapshot } from "harness";
import type { Socket } from "node:net";
import path from "path";
import { listeningServer, mysqlHandshakeV10, mysqlOkPacket, mysqlReadPackets, mysqlTextResultSet } from "./wire-frames";

const fixture = path.join(import.meta.dir, "sql-mysql-query-on-idle-connection-fixture.ts");
const scenarios = ["begin", "reserve", "turn"];

const COM_QUERY = 0x03;
const MYSQL_TYPE_LONGLONG = 0x08;

// Answers the handshake and every text-protocol query (a result set for
// selects, OK for BEGIN/COMMIT), and, like a real server would, answers a
// query that calls sleep() late.
async function mockServer() {
  return await listeningServer((socket: Socket) => {
    let buffered = Buffer.alloc(0);
    let authenticated = false;
    socket.on("error", () => {});
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authenticated) {
          authenticated = true;
          socket.write(mysqlOkPacket(seq + 1));
          return;
        }
        if (payload[0] !== COM_QUERY) {
          socket.end();
          return;
        }
        const query = payload.subarray(1).toString().toLowerCase();
        const reply = query.startsWith("select")
          ? mysqlTextResultSet(1, [{ name: "x", type: MYSQL_TYPE_LONGLONG }], [["2"]])
          : mysqlOkPacket(1);
        if (!query.includes("sleep(")) {
          socket.write(reply);
          return;
        }
        setTimeout(() => {
          if (!socket.destroyed) socket.write(reply);
        }, 200);
      });
    });
  });
}

async function expectFixtureToFinish(url: string, scenario: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture, scenario],
    env: { ...bunEnv, MYSQL_URL: url },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr.split(/\r?\n/).filter(line => line && !line.startsWith("WARNING: ASAN interferes"))).toEqual([]);
  expect(normalizeBunSnapshot(stdout)).toBe("first step done\nsecond query done: 2");
  expect(exitCode).toBe(0);
}

describe.concurrent("against a mock server", () => {
  test.each(scenarios)("the process stays alive for a query issued after %s", async scenario => {
    const { server, port } = await mockServer();
    try {
      await expectFixtureToFinish(`mysql://root@127.0.0.1:${port}/db`, scenario);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describeWithContainer("against mysql", { image: "mysql_plain", concurrent: true }, container => {
  test.each(scenarios)("the process stays alive for a query issued after %s", async scenario => {
    await container.ready;
    await expectFixtureToFinish(`mysql://root@${container.host}:${container.port}/bun_sql_test`, scenario);
  });
});
