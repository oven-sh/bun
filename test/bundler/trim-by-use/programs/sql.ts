function message(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.write(type, 0, "latin1");
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}

function int16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeInt16BE(value);
  return bytes;
}

function int32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value);
  return bytes;
}

const readyForQuery = message("Z", Buffer.from("I"));
const textColumn = (name: string) =>
  Buffer.concat([Buffer.from(name + "\0"), int32(0), int16(0), int32(25), int16(-1), int32(-1), int16(0)]);
const textValue = (value: string) => Buffer.concat([int32(Buffer.byteLength(value)), Buffer.from(value)]);

const server = Bun.listen<{ started: boolean }>({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open(socket) {
      socket.data = { started: false };
    },
    data(socket, bytes) {
      if (!socket.data.started) {
        socket.data.started = true;
        socket.write(
          Buffer.concat([
            message("R", int32(0)),
            message("S", Buffer.from("server_version\x0016.0\0")),
            message("K", Buffer.concat([int32(1), int32(2)])),
            readyForQuery,
          ]),
        );
        return;
      }
      for (let at = 0; at < bytes.length; at += 1 + bytes.readInt32BE(at + 1)) {
        if (String.fromCharCode(bytes[at]!) !== "Q") continue;
        const query = bytes.toString("utf8", at + 5, at + bytes.readInt32BE(at + 1));
        socket.write(
          Buffer.concat([
            message("T", Buffer.concat([int16(2), textColumn("asked"), textColumn("answer")])),
            message("D", Buffer.concat([int16(2), textValue(query), textValue("forty-two")])),
            message("C", Buffer.from("SELECT 1\0")),
            readyForQuery,
          ]),
        );
      }
    },
  },
});

const sql = new Bun.SQL({
  adapter: "postgres",
  hostname: "127.0.0.1",
  port: server.port,
  username: "someone",
  database: "somewhere",
  tls: false,
  max: 1,
});
console.log(JSON.stringify(await sql`select the answer`.simple()));
await sql.close();
server.stop(true);

const closedPort = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
const port = closedPort.port;
closedPort.stop(true);
const mysql = new Bun.SQL({
  adapter: "mysql",
  hostname: "127.0.0.1",
  port,
  username: "someone",
  database: "somewhere",
  tls: false,
  max: 1,
  connectionTimeout: 2,
});
console.log(
  await mysql`select 1`.then(
    () => "answered",
    (error: Error & { code?: string }) => `${error.name} ${error.code}`,
  ),
);
await mysql.close();
