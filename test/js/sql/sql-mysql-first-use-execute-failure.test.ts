// A prepared statement goes out in two steps: COM_STMT_PREPARE, and then, when
// the server has answered, COM_STMT_EXECUTE with the bound parameters. On the
// first use of a statement text the second step runs later, from the request
// queue, and not from the call that started the query. When that step failed on
// the client (a parameter that throws while it is serialized, a parameter too
// large for one packet), the query left the queue and its promise never
// settled. The same query on an already prepared statement rejected, because
// there the step runs inside the call that started it.
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlColumnDefinition,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlStmtPrepareOk,
} from "./wire-frames";

const thrown = new Error("boom from toJSON");

// Each parameter makes the execute step fail before it writes anything.
const failures: [name: string, parameter: () => unknown, reason: unknown][] = [
  [
    "a parameter whose toJSON throws",
    () => ({
      toJSON() {
        throw thrown;
      },
    }),
    thrown,
  ],
  [
    "a parameter too large for one packet",
    () => Buffer.alloc(0xffffff, 0x41),
    expect.objectContaining({ code: "ERR_MYSQL_OVERFLOW" }),
  ],
];

// `next` waits behind `query` on the same connection. When it resolves, `query`
// is out of the queue. A query that never settles is "pending" at that point,
// so the test fails on the assertion and not on a timeout.
async function outcomeOf(query: Promise<unknown>, next: Promise<unknown>) {
  let outcome: unknown = "pending";
  query.then(
    () => (outcome = "resolved"),
    reason => (outcome = { rejected: reason }),
  );
  const rows = await next;
  return { outcome, next: rows };
}

// close() with no timeout waits for every query to settle. With a query that
// never settles it waits for ever, so the tests close with a bound.
const closeTimeout = { timeout: 1 };

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  test.each(failures)(
    "%s rejects the query on the first use of a statement and on the next use",
    async (_name, parameter, reason) => {
      await container.ready;
      const sql = new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
      try {
        const [{ id }] = await sql`SELECT CONNECTION_ID() AS id`;
        const query = () => sql`SELECT ${parameter()} AS v`;
        const connectionId = () => sql`SELECT CONNECTION_ID() AS id`;

        // The connection is new, so the statement is not prepared yet.
        const firstUse = await outcomeOf(query(), connectionId());
        // The first use prepared the statement.
        const nextUse = await outcomeOf(query(), connectionId());

        expect({ firstUse, nextUse }).toEqual({
          firstUse: { outcome: { rejected: reason }, next: [{ id }] },
          nextUse: { outcome: { rejected: reason }, next: [{ id }] },
        });
      } finally {
        await sql.close(closeTimeout);
      }
    },
  );
});

describe("mysql (mock server)", () => {
  const commands: Record<number, string> = { 0x03: "COM_QUERY", 0x16: "COM_STMT_PREPARE", 0x17: "COM_STMT_EXECUTE" };

  // Prepares every statement with one parameter and no columns, answers every
  // COM_QUERY with OK, and records the commands it receives.
  async function mockServer() {
    const received: string[] = [];
    const { port, server } = await listeningServer(socket => {
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
          if (mysqlAckSessionSetup(socket, payload)) return;
          const command = commands[payload[0]];
          received.push(command ?? `0x${payload[0].toString(16)}`);
          if (command === "COM_STMT_PREPARE") {
            socket.write(
              Buffer.concat([mysqlStmtPrepareOk(1, 1, 0, 1), mysqlColumnDefinition(2, { name: "?", type: 0xfd })]),
            );
          } else if (command === "COM_QUERY") {
            socket.write(mysqlOkPacket(1));
          } else {
            socket.end();
          }
        });
      });
      socket.on("error", () => {});
    });
    return { port, server, received };
  }

  test.each(failures)("%s rejects the query and sends no COM_STMT_EXECUTE", async (_name, parameter, reason) => {
    const { port, server, received } = await mockServer();
    const sql = new SQL({ url: `mysql://root@127.0.0.1:${port}/db`, max: 1 });
    try {
      const query = () => sql.unsafe("SELECT ?", [parameter()]);
      // A query with no parameters goes out as COM_QUERY.
      const simple = () => sql.unsafe("SELECT 1");

      const firstUse = await outcomeOf(query(), simple());
      const nextUse = await outcomeOf(query(), simple());

      expect({ firstUse: firstUse.outcome, nextUse: nextUse.outcome, received }).toEqual({
        firstUse: { rejected: reason },
        nextUse: { rejected: reason },
        // One COM_STMT_PREPARE: the first use failed after the prepare, and
        // the next use found the statement prepared.
        received: ["COM_STMT_PREPARE", "COM_QUERY", "COM_QUERY"],
      });
    } finally {
      await sql.close(closeTimeout);
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
