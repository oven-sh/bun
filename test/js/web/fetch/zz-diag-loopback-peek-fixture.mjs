// After send() on a loopback TCP socket returns, is the byte already readable on the peer? (Winsock through bun:ffi.)
import { dlopen, ptr } from "bun:ffi";
const { symbols: w } = dlopen("ws2_32.dll", {
  WSAStartup: { args: ["u16", "ptr"], returns: "i32" },
  socket: { args: ["i32", "i32", "i32"], returns: "u64" },
  bind: { args: ["u64", "ptr", "i32"], returns: "i32" },
  listen: { args: ["u64", "i32"], returns: "i32" },
  getsockname: { args: ["u64", "ptr", "ptr"], returns: "i32" },
  connect: { args: ["u64", "ptr", "i32"], returns: "i32" },
  accept: { args: ["u64", "ptr", "ptr"], returns: "u64" },
  send: { args: ["u64", "ptr", "i32", "i32"], returns: "i32" },
  recv: { args: ["u64", "ptr", "i32", "i32"], returns: "i32" },
  ioctlsocket: { args: ["u64", "i32", "ptr"], returns: "i32" },
  setsockopt: { args: ["u64", "i32", "i32", "ptr", "i32"], returns: "i32" },
});
const rounds = Number(process.argv[2] ?? 200000);
w.WSAStartup(0x0202, ptr(new Uint8Array(512)));
const addr = new Uint8Array(16);
addr[0] = 2;
addr.set([127, 0, 0, 1], 4);
const len = new Int32Array([16]);
const l = w.socket(2, 1, 6);
if (w.bind(l, ptr(addr), 16) || w.listen(l, 1) || w.getsockname(l, ptr(addr), ptr(len))) throw new Error("listen");
const a = w.socket(2, 1, 6);
if (w.connect(a, ptr(addr), 16)) throw new Error("connect");
const b = w.accept(l, null, null);
const one = new Int32Array([1]);
w.setsockopt(a, 6, 1, ptr(one), 4); // TCP_NODELAY
w.ioctlsocket(b, -2147195266, ptr(one)); // FIONBIO
const byte = new Uint8Array([33]),
  got = new Uint8Array(1);
let late = 0,
  worst = 0;
const delays = [];
for (let i = 0; i < rounds; i++) {
  if (w.send(a, ptr(byte), 1, 0) !== 1) throw new Error("send");
  if (w.recv(b, ptr(got), 1, 2) !== 1) {
    // MSG_PEEK
    late++;
    const t = performance.now();
    while (w.recv(b, ptr(got), 1, 2) !== 1);
    const d = performance.now() - t;
    delays.push(d);
    if (d > worst) worst = d;
  }
  if (w.recv(b, ptr(got), 1, 0) !== 1) throw new Error("recv");
}
delays.sort((x, y) => x - y);
console.log(
  `PEEK rounds ${rounds}, byte not there right after send(): ${late}; then it took median ${(delays[delays.length >> 1] ?? 0).toFixed(3)} ms, worst ${worst.toFixed(3)} ms`,
);
