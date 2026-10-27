// A scripted DNS server on 127.0.0.1, on one port for UDP and TCP.
import dgram from "node:dgram";
import { once } from "node:events";
import net from "node:net";

export const TYPE = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  NAPTR: 35,
  ANY: 255,
  CAA: 257,
} as const;

export const RCODE = { NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 } as const;

export function u16(...values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((value, i) => out.writeUInt16BE(value, i * 2));
  return out;
}

export function u32(...values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => out.writeUInt32BE(value, i * 4));
  return out;
}

/** A length byte, then the bytes. */
export function text(value: string | Buffer): Buffer {
  const bytes = Buffer.from(value);
  return Buffer.concat([Buffer.from([bytes.length]), bytes]);
}

/** Labels are split at dots, so a label that holds a dot has to be given as an array element. */
export function name(value: string | (string | Buffer)[]): Buffer {
  const labels = typeof value === "string" ? value.split(".").filter(Boolean) : value;
  return Buffer.concat([...labels.map(text), Buffer.from([0])]);
}

export function record(owner: string | Buffer, type: number, ttl: number, data: Buffer, dnsClass = 1): Buffer {
  return Buffer.concat([
    typeof owner === "string" ? name(owner) : owner,
    u16(type, dnsClass),
    u32(ttl),
    u16(data.length),
    data,
  ]);
}

export const a = (owner: string | Buffer, ttl: number, address: string) =>
  record(owner, TYPE.A, ttl, Buffer.from(address.split(".").map(Number)));

/** `address` is the 32 hex digits. */
export const aaaa = (owner: string | Buffer, ttl: number, address: string) =>
  record(owner, TYPE.AAAA, ttl, Buffer.from(address, "hex"));

export const cname = (owner: string | Buffer, ttl: number, target: string) =>
  record(owner, TYPE.CNAME, ttl, name(target));

/** A compression pointer to the name of the question. */
export const QUESTION_NAME = Buffer.from([0xc0, 0x0c]);

export interface Query {
  transport: "udp" | "tcp";
  message: Buffer;
  id: number;
  flags: number;
  name: string;
  type: number;
  /** The question section as it was sent. */
  question: Buffer;
  /** How many queries came before this one. */
  index: number;
  /** The address it came from. */
  from: string;
}

export interface Reply {
  rcode?: number;
  truncated?: boolean;
  id?: number;
  question?: Buffer;
  answers?: Buffer[];
  authority?: Buffer[];
  additional?: Buffer[];
}

/** A `Buffer` is sent as it is, several are sent one after the other, and nothing is sent for `undefined`. */
type Answer = Reply | Buffer | Buffer[] | "hang up" | undefined;
export type Handler = (query: Query) => Answer | Promise<Answer>;

export function encode(query: Query, reply: Reply): Buffer {
  const { answers = [], authority = [], additional = [] } = reply;
  return Buffer.concat([
    u16(
      reply.id ?? query.id,
      0x8180 | (reply.truncated ? 0x0200 : 0) | (reply.rcode ?? 0),
      1,
      answers.length,
      authority.length,
      additional.length,
    ),
    reply.question ?? query.question,
    ...answers,
    ...authority,
    ...additional,
  ]);
}

export function parse(message: Buffer, transport: Query["transport"], index: number, from: string): Query {
  const labels: string[] = [];
  let offset = 12;
  while (message[offset]) {
    labels.push(message.toString("latin1", offset + 1, offset + 1 + message[offset]));
    offset += message[offset] + 1;
  }
  return {
    transport,
    message,
    id: message.readUInt16BE(0),
    flags: message.readUInt16BE(2),
    name: labels.join("."),
    type: message.readUInt16BE(offset + 1),
    question: message.subarray(12, offset + 5),
    index,
    from,
  };
}

export interface DnsServer extends AsyncDisposable {
  port: number;
  /** For `setServers()`. */
  address: string;
  queries: Query[];
  connections: number;
}

export async function dnsServer(handler: Handler): Promise<DnsServer> {
  const queries: Query[] = [];
  const sockets = new Set<net.Socket>();

  async function answer(
    message: Buffer,
    transport: Query["transport"],
    from: string,
    send: (reply: Buffer) => void,
    hangUp?: () => void,
  ) {
    const query = parse(message, transport, queries.length, from);
    queries.push(query);
    const reply = await handler(query);
    if (reply === undefined) return;
    if (reply === "hang up") return hangUp?.();
    for (const part of Array.isArray(reply) ? reply : [reply]) {
      send(Buffer.isBuffer(part) ? part : encode(query, part));
    }
  }

  // The system only promises that the port was free for UDP.
  for (let attempt = 0; ; attempt++) {
    const udp = dgram.createSocket("udp4");
    udp.bind(0, "127.0.0.1");
    await once(udp, "listening");
    const { port } = udp.address();
    let isClosed = false;
    /** What went wrong with the UDP socket, for the test that owns the server to fail with. */
    let failure: Error | undefined;

    const server: DnsServer = {
      port,
      address: `127.0.0.1:${port}`,
      queries,
      connections: 0,
      async [Symbol.asyncDispose]() {
        isClosed = true;
        for (const socket of sockets) socket.destroy();
        const closed = [once(udp, "close"), once(tcp, "close")];
        udp.close();
        tcp.close();
        await Promise.all(closed);
        if (failure) throw failure;
      },
    };

    const tcp = net.createServer(socket => {
      server.connections++;
      sockets.add(socket);
      let pending = Buffer.alloc(0);
      socket.on("data", chunk => {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 2 && pending.length >= 2 + pending.readUInt16BE(0)) {
          const length = pending.readUInt16BE(0);
          const message = pending.subarray(2, 2 + length);
          pending = pending.subarray(2 + length);
          answer(
            message,
            "tcp",
            socket.remoteAddress!,
            reply => socket.write(Buffer.concat([u16(reply.length), reply])),
            () => socket.destroy(),
          ).catch(error => (failure ??= error));
        }
      });
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
    });

    try {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      tcp.once("error", reject);
      tcp.listen(port, "127.0.0.1", resolve);
      await promise;
    } catch (error) {
      udp.close();
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE" && attempt < 32) continue;
      throw error;
    }

    // That a reply found its socket closed is reported on this one, on Linux: as an error event, or as the failure of
    // the next reply, which is then not sent.
    const isAboutAnEarlierReply = (error: Error) => (error as NodeJS.ErrnoException).code === "ECONNREFUSED";
    udp.on("error", error => {
      if (!isAboutAnEarlierReply(error)) failure ??= error;
    });
    const send = (reply: Buffer, from: dgram.RemoteInfo) =>
      new Promise<void>(resolve => {
        if (isClosed) return resolve();
        udp.send(reply, from.port, from.address, error => {
          if (error && !isClosed && isAboutAnEarlierReply(error)) return resolve(send(reply, from));
          if (error && !isClosed) failure ??= error;
          resolve();
        });
      });
    let sent = Promise.resolve();
    udp.on("message", (message, from) => {
      answer(message, "udp", from.address, reply => {
        sent = sent.then(() => send(reply, from));
      }).catch(error => (failure ??= error));
    });
    return server;
  }
}
