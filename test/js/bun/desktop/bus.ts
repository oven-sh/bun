import { tempDir } from "harness";
import { join } from "node:path";

/** The first complete type of a signature. */
function first(signature: string): string {
  if (signature[0] === "a") return "a" + first(signature.slice(1));
  let [depth, end] = [0, 0];
  do depth += +"({".includes(signature[end]) - +")}".includes(signature[end]);
  while ((end++, depth));
  return signature.slice(0, end);
}

function split(signature: string): string[] {
  return signature ? [first(signature), ...split(signature.slice(first(signature).length))] : [];
}

const numbers = {
  y: [1, "UInt8"],
  n: [2, "Int16LE"],
  q: [2, "UInt16LE"],
  b: [4, "UInt32LE"],
  i: [4, "Int32LE"],
  u: [4, "UInt32LE"],
  h: [4, "UInt32LE"],
  x: [8, "BigInt64LE"],
  t: [8, "BigUInt64LE"],
  d: [8, "DoubleLE"],
} as any;
const alignment = (type: string) =>
  numbers[type[0]]?.[0] ?? ("gv".includes(type[0]) ? 1 : "({".includes(type[0]) ? 8 : 4);

/** A variant is `[signature, value]`, a dictionary an object, and a structure an array. */
function write(out: number[], type: string, value: any) {
  while (out.length % alignment(type)) out.push(0);
  if (numbers[type]) {
    const bytes: any = Buffer.alloc(numbers[type][0]);
    bytes["write" + numbers[type][1]]("xt".includes(type) ? BigInt(value) : +value);
    out.push(...bytes);
  } else if ("sog".includes(type)) {
    write(out, type === "g" ? "y" : "u", Buffer.byteLength(value));
    out.push(...Buffer.from(value), 0);
  } else if (type === "v") {
    write(out, "g", value[0]);
    write(out, value[0], value[1]);
  } else if (type[0] === "a") {
    const lengthAt = out.push(0, 0, 0, 0) - 4;
    while (out.length % alignment(type.slice(1))) out.push(0);
    const start = out.length;
    for (const it of type[1] === "{" ? Object.entries(value) : value) write(out, type.slice(1), it);
    out.splice(lengthAt, 4, ...new Uint8Array(new Uint32Array([out.length - start]).buffer));
  } else {
    split(type.slice(1, -1)).forEach((it, index) => write(out, it, value[index]));
  }
  return out;
}

/** A variant is what it contains. */
function read(from: { bytes: any; at: number }, type: string): any {
  from.at += -from.at & (alignment(type) - 1);
  if (numbers[type]) {
    const value = from.bytes["read" + numbers[type][1]]((from.at += numbers[type][0]) - numbers[type][0]);
    return type === "b" ? !!value : Number(value);
  }
  if ("sog".includes(type)) {
    const length = read(from, type === "g" ? "y" : "u");
    return from.bytes.toString("utf8", from.at, (from.at += length + 1) - 1);
  }
  if (type === "v") return read(from, read(from, "g"));
  if (type[0] !== "a") return split(type.slice(1, -1)).map(it => read(from, it));
  const [length, all] = [read(from, "u"), [] as any[]];
  from.at += -from.at & (alignment(type.slice(1)) - 1);
  for (const end = from.at + length; from.at < end;) all.push(read(from, type.slice(1)));
  return type[1] === "{" ? Object.fromEntries(all) : all;
}

const [CALL, RETURN, ERROR, SIGNAL] = [1, 2, 3, 4];
type Peer = { socket: Bun.Socket<Peer>; name: string; unread: Buffer; hasBegun: boolean };
export type Heard = { from: Peer; name: string; path: string; body: any[] };
type Typed = [signature: string, ...values: any[]];

/** The bus of a session, and every service on it: `services` answers calls by `interface.member`. */
export function openBus(services: Record<string, (call: Heard) => Typed | void>) {
  const dir = tempDir("bus", {});
  const address = "unix:path=" + join(String(dir), "socket");
  const [peers, log, pending] = [new Set<Peer>(), [] as Heard[], new Map<number, PromiseWithResolvers<any[]>>()];
  let [serial, names] = [0, 0];

  function send(to: Peer, kind: number, fields: Record<number, [string, any]>, [signature, ...values]: Typed) {
    const body = split(signature).reduce((out, type, index) => write(out, type, values[index]), [] as number[]);
    const all = Object.entries({ ...fields, 7: ["s", ":1.0"], 8: ["g", signature] });
    const header = write([], "(yyyyuua(yv))", [0x6c, kind, 0, 1, body.length, ++serial, all]);
    to.socket.write(Buffer.from([...header, ...Array(-header.length & 7).fill(0), ...body]));
    return serial;
  }

  const named = (path: string, name: string): Record<number, [string, any]> => {
    const dot = name.lastIndexOf(".");
    return { 1: ["o", path], 2: ["s", name.slice(0, dot)], 3: ["s", name.slice(dot + 1)] };
  };

  function handle(from: Peer, bytes: Buffer) {
    const cursor = { bytes, at: 0 };
    const [, kind, flags, , , number, list] = read(cursor, "(yyyyuua(yv))");
    const fields = Object.fromEntries(list);
    cursor.bytes = bytes.subarray(cursor.at + (-cursor.at & 7));
    cursor.at = 0;
    const body = split(fields[8] ?? "").map(it => read(cursor, it));
    if (kind === RETURN) return pending.get(fields[5])?.resolve(body);
    if (kind === ERROR) return pending.get(fields[5])?.reject(new Error(fields[4]));
    const heard = { from, name: `${fields[2]}.${fields[3]}`, path: fields[1], body };
    log.push(heard);
    if (kind !== CALL) return;
    const service = heard.name === "org.freedesktop.DBus.Hello" ? (): Typed => ["s", from.name] : services[heard.name];
    const answer = service && (service(heard) ?? [""]);
    if (flags & 1) return;
    if (answer) send(from, RETURN, { 5: ["u", number] }, answer);
    else
      send(from, ERROR, { 4: ["s", "org.freedesktop.DBus.Error.ServiceUnknown"], 5: ["u", number] }, ["s", heard.name]);
  }

  const server = Bun.listen<Peer>({
    unix: address.slice(10),
    socket: {
      open: socket =>
        void peers.add((socket.data = { socket, name: ":1." + ++names, unread: Buffer.alloc(0), hasBegun: false })),
      close: socket => void peers.delete(socket.data),
      data(socket, chunk) {
        const peer = socket.data;
        let unread = Buffer.concat([peer.unread, chunk]);
        for (let end; !peer.hasBegun && (end = unread.indexOf("\r\n")) >= 0; unread = unread.subarray(end + 2)) {
          const line = unread.toString("latin1", 0, end);
          peer.hasBegun = line === "BEGIN";
          if (!peer.hasBegun)
            socket.write(line.includes("AUTH") ? "OK 0123456789abcdef0123456789abcdef\r\n" : "AGREE_UNIX_FD\r\n");
        }
        while (peer.hasBegun && unread.length >= 16) {
          const length = ((16 + unread.readUInt32LE(12) + 7) & ~7) + unread.readUInt32LE(4);
          if (unread.length < length) break;
          handle(peer, unread.subarray(0, length));
          unread = unread.subarray(length);
        }
        peer.unread = unread;
      },
    },
  });

  return {
    address,
    env: { DBUS_SESSION_BUS_ADDRESS: address, DBUS_SYSTEM_BUS_ADDRESS: address },
    /** The calls and signals since the last time whose names start with one of these. */
    take: (...starts: string[]) => log.splice(0).filter(it => starts.some(start => it.name.startsWith(start))),
    find: (name: string) => log.find(it => it.name === name),
    signal: (to: Peer, path: string, name: string, ...body: Typed) => void send(to, SIGNAL, named(path, name), body),
    call(to: Peer, path: string, name: string, ...body: Typed) {
      const answer = Promise.withResolvers<any[]>();
      pending.set(send(to, CALL, named(path, name), body), answer);
      return answer.promise;
    },
    [Symbol.dispose]() {
      server.stop(true);
      dir[Symbol.dispose]();
    },
  };
}
