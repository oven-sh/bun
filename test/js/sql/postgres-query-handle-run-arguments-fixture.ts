// Calls the native query handle's run() with too few arguments and prints
// what it threw. Driven by postgres-query-handle-run-arguments.test.ts.
import { SQL } from "bun";

// Nothing here needs an answer from a server. The peer only accepts the dial,
// because the pool creates the native connection object when it dials.
const accepted = Promise.withResolvers<void>();
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { open: () => accepted.resolve(), data() {} },
});
const sql = new SQL(`postgres://user@127.0.0.1:${listener.port}/db`, { max: 1 });
const query: any = sql`select 1`;
query.execute();
await accepted.promise;

const internal = (description: string) =>
  query[Object.getOwnPropertySymbols(query).find(symbol => symbol.description === description)!];
const handle = internal("handle");
const connection = internal("adapter").connections[0].connection;

const args = { "run()": [], "run(connection)": [connection] }[process.argv[2]]!;
let outcome: unknown = "returned";
try {
  handle.run(...args);
} catch (error: any) {
  outcome = { name: error.name, message: error.message };
}
console.log(JSON.stringify(outcome));
process.exit(0);
