// After the connection reaches Connected with no in-flight requests the
// poll_ref keepalive is Inactive. PostgresSQLQuery.do_run used to ref it
// before any validation; when the run then failed synchronously (here: a
// boxed Boolean binding is rejected by the Postgres type mapper inside
// Signature::generate) none of the error returns unref'd it, so the event
// loop stayed pinned and the process hung.
//
// The fixture prints "rejected:<code>" once the query has been rejected,
// unrefs the mock-server handles and then falls through. With no pending
// work it must exit on its own (exit code 0, no signal).

import net from "node:net";

function pkt(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

const authenticationOk = pkt("R", Buffer.from([0, 0, 0, 0]));
const readyForQuery = pkt("Z", Buffer.from("I"));

const server = net.createServer(socket => {
  socket.unref();
  let startup = true;
  socket.on("data", () => {
    if (startup) {
      startup = false;
      socket.write(Buffer.concat([authenticationOk, readyForQuery]));
    }
  });
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
server.unref();
const port = (server.address() as net.AddressInfo).port;

const sql = new Bun.SQL({
  url: `postgres://u@127.0.0.1:${port}/db`,
  max: 1,
  idleTimeout: 0,
  maxLifetime: 0,
  connectionTimeout: 30,
});

await sql.connect();

// sql.connect() resolves from the onconnect microtask, which runs inside the
// native on_data handler. That handler unconditionally re-derives poll_ref
// from the request queue right before returning, so the leak is only visible
// once do_run runs on a later turn where no on_data epilogue follows it.
await new Promise<void>(resolve => setImmediate(resolve));

// new Boolean(...) is a cell whose JSType is BooleanObject; the Postgres
// binding type mapper rejects it synchronously inside Signature::generate,
// so run() throws before the request is ever enqueued.
const err = await sql`SELECT ${new Boolean(true)}`.catch(e => e);
console.log("rejected:" + (err?.code ?? err?.name ?? String(err)));
