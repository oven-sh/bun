// A scripted stand-in for mDNSResponder. libsystem_dnssd connects to $DNSSD_UDS_PATH when it is set.
//
//   bun mdnsresponder-fixture.ts <socket path> <answers JSON> <client script>
//
// Runs the client script in a child Bun, answers its queries from `answers`, and after the client has
// gone prints every request it made as one line of JSON. The client's own stdout comes first.
import { dlopen, ptr } from "bun:ffi";
import { closeSync, writeSync } from "node:fs";

export type Answer = {
  rrtype: number;
  /** An IPv4 or IPv6 address as bytes, or any other rdata. */
  rdata?: number[];
  /** Defaults to kDNSServiceFlagsAdd. */
  flags?: number;
  error?: number;
  ifindex?: number;
  ttl?: number;
};
/** Keyed by `${name} ${rrtype}`. A query with no entry gets kDNSServiceErr_NoSuchRecord. */
export type Answers = Record<string, Answer[]>;

const [socketPath, answersJSON, clientScript] = process.argv.slice(2);
const answers: Answers = JSON.parse(answersJSON);

const { symbols: libc } = dlopen("libSystem.B.dylib", {
  socket: { args: ["i32", "i32", "i32"], returns: "i32" },
  bind: { args: ["i32", "ptr", "u32"], returns: "i32" },
  listen: { args: ["i32", "i32"], returns: "i32" },
  accept: { args: ["i32", "ptr", "ptr"], returns: "i32" },
  poll: { args: ["ptr", "u32", "i32"], returns: "i32" },
  recvmsg: { args: ["i32", "ptr", "i32"], returns: "i64" },
});

const AF_UNIX = 1;
const SOCK_STREAM = 1;
const SOL_SOCKET = 0xffff;
const SCM_RIGHTS = 1;
const POLLIN = 1;

const HEADER_SIZE = 28;
const IPC_FLAGS_TRAILING_TLVS = 2;
const ops = { 1: "connection", 8: "query", 15: "addrinfo", 63: "cancel" } as const;
const QUERY_REPLY = 68;
const ADDRINFO_REPLY = 72;

const FLAGS_ADD = 0x2;
const ERR_NO_SUCH_RECORD = -65554;
const ERR_UNSUPPORTED = -65544;
const TYPE_A = 1;
const TYPE_AAAA = 28;

function check(rc: number, what: string) {
  if (rc < 0) throw new Error(`${what} failed`);
  return rc;
}

function listenOn(path: string) {
  const pathBytes = Buffer.from(path);
  if (pathBytes.length >= 104) throw new Error(`socket path is too long for sun_path: ${path}`);
  const addr = new Uint8Array(106);
  addr[0] = addr.length;
  addr[1] = AF_UNIX;
  addr.set(pathBytes, 2);
  const fd = check(libc.socket(AF_UNIX, SOCK_STREAM, 0), "socket");
  check(libc.bind(fd, ptr(addr), addr.length), "bind");
  check(libc.listen(fd, 8), "listen");
  return fd;
}

/** One recvmsg(): the bytes read (empty at EOF) and any descriptors that came with them. */
function receive(fd: number) {
  const data = new Uint8Array(4096);
  const control = new Uint8Array(64);
  const iov = new BigUint64Array([BigInt(ptr(data)), BigInt(data.length)]);
  const msg = new DataView(new ArrayBuffer(48));
  msg.setBigUint64(16, BigInt(ptr(iov)), true);
  msg.setInt32(24, 1, true);
  msg.setBigUint64(32, BigInt(ptr(control)), true);
  msg.setUint32(40, control.length, true);
  const n = Number(libc.recvmsg(fd, ptr(new Uint8Array(msg.buffer)), 0));
  const fds: number[] = [];
  const cmsg = new DataView(control.buffer);
  if (msg.getUint32(40, true) >= 16 && cmsg.getInt32(4, true) === SOL_SOCKET && cmsg.getInt32(8, true) === SCM_RIGHTS) {
    for (let at = 12; at + 4 <= cmsg.getUint32(0, true); at += 4) fds.push(cmsg.getInt32(at, true));
  }
  return { bytes: Buffer.from(data.subarray(0, Math.max(n, 0))), fds };
}

function reply(op: number, context: Buffer, name: string, qtype: number) {
  const fullname = Buffer.from((name.endsWith(".") ? name : name + ".") + "\0");
  const list = answers[`${name} ${qtype}`] ?? [{ rrtype: qtype, error: ERR_NO_SUCH_RECORD }];
  return list.map(({ rrtype, rdata = [], flags = FLAGS_ADD, error = 0, ifindex = 0, ttl = 60 }) => {
    const body = Buffer.alloc(12 + fullname.length + 6 + rdata.length + 4);
    body.writeUInt32BE(flags, 0);
    body.writeUInt32BE(ifindex, 4);
    body.writeInt32BE(error, 8);
    let at = 12 + fullname.copy(body, 12);
    at = body.writeUInt16BE(rrtype, at);
    at = body.writeUInt16BE(1, at);
    at = body.writeUInt16BE(rdata.length, at);
    at += Buffer.from(rdata).copy(body, at);
    body.writeUInt32BE(ttl, at);
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(body.length, 4);
    header.writeUInt32BE(op, 12);
    context.copy(header, 16);
    return Buffer.concat([header, body]);
  });
}

function cstring(data: Buffer, at: number) {
  const end = data.indexOf(0, at);
  return { value: data.toString("latin1", at, end), next: end + 1 };
}

function tlvs(data: Buffer, at: number) {
  const out: Record<number, number[]> = {};
  while (at + 4 <= data.length) {
    const length = data.readUInt16BE(at + 2);
    out[data.readUInt16BE(at)] = [...data.subarray(at + 4, at + 4 + length)];
    at += 4 + length;
  }
  return out;
}

const requests: object[] = [];

function handle(conn: number, header: Buffer, data: Buffer, errorFds: number[]) {
  const op = header.readUInt32BE(12);
  const context = header.subarray(16, 24);
  const hasTLVs = (header.readUInt32BE(8) & IPC_FLAGS_TRAILING_TLVS) !== 0;
  const status = Buffer.alloc(4);

  if (ops[op] === "connection") {
    writeSync(conn, status);
    return;
  }
  if (ops[op] === "cancel") return;

  // Byte 0 is the empty control path that marks a request whose status goes to a descriptor of its own.
  const flags = data.readUInt32BE(1);
  const ifindex = data.readUInt32BE(5);
  const replies: Buffer[] = [];
  if (ops[op] === "query") {
    const { value: name, next } = cstring(data, 9);
    const rrtype = data.readUInt16BE(next);
    requests.push({ op: "query", name, rrtype, flags, ifindex, tlvs: hasTLVs ? tlvs(data, next + 4) : {} });
    replies.push(...reply(QUERY_REPLY, context, name, rrtype));
  } else if (ops[op] === "addrinfo") {
    const protocol = data.readUInt32BE(9);
    const { value: name, next } = cstring(data, 13);
    requests.push({ op: "addrinfo", name, protocol, flags, ifindex, tlvs: hasTLVs ? tlvs(data, next) : {} });
    if (protocol & 2) replies.push(...reply(ADDRINFO_REPLY, context, name, TYPE_AAAA));
    if (protocol & 1) replies.push(...reply(ADDRINFO_REPLY, context, name, TYPE_A));
  } else {
    requests.push({ op });
    status.writeInt32BE(ERR_UNSUPPORTED);
  }

  const errorFd = errorFds.shift()!;
  writeSync(errorFd, status);
  closeSync(errorFd);
  if (replies.length) writeSync(conn, Buffer.concat(replies));
}

const listener = listenOn(socketPath);
const client = Bun.spawn({
  cmd: [process.execPath, "-e", clientScript],
  env: { ...process.env, DNSSD_UDS_PATH: socketPath },
  stdio: ["ignore", "inherit", "inherit", "pipe"],
});
// Only the client holds the other end, so this becomes readable when the client is gone.
const clientGone = client.stdio[3] as number;

const conns = new Map<number, { pending: Buffer; errorFds: number[] }>();
serving: while (true) {
  const fds = [clientGone, listener, ...conns.keys()];
  const pollfds = new DataView(new ArrayBuffer(fds.length * 8));
  fds.forEach((fd, i) => {
    pollfds.setInt32(i * 8, fd, true);
    pollfds.setInt16(i * 8 + 4, POLLIN, true);
  });
  check(libc.poll(ptr(new Uint8Array(pollfds.buffer)), fds.length, -1), "poll");
  for (let i = 0; i < fds.length; i++) {
    if (pollfds.getInt16(i * 8 + 6, true) === 0) continue;
    const fd = fds[i];
    if (fd === clientGone) break serving;
    if (fd === listener) {
      conns.set(check(libc.accept(listener, null, null), "accept"), { pending: Buffer.alloc(0), errorFds: [] });
      continue;
    }
    const conn = conns.get(fd)!;
    const { bytes, fds: passed } = receive(fd);
    if (bytes.length === 0) {
      closeSync(fd);
      conns.delete(fd);
      continue;
    }
    conn.errorFds.push(...passed);
    conn.pending = Buffer.concat([conn.pending, bytes]);
    while (conn.pending.length >= HEADER_SIZE) {
      const size = HEADER_SIZE + conn.pending.readUInt32BE(4);
      if (conn.pending.length < size) break;
      handle(fd, conn.pending.subarray(0, HEADER_SIZE), conn.pending.subarray(HEADER_SIZE, size), conn.errorFds);
      conn.pending = conn.pending.subarray(size);
    }
  }
}

console.log(JSON.stringify(requests));
process.exitCode = await client.exited;
