// Diagnostic, not for merging: is a loopback TCP segment in the peer's receive buffer when send() returns?
import { dlopen, ptr } from "bun:ffi";
import { expect, test } from "bun:test";
import { isWindows } from "harness";

test.skipIf(!isWindows)("loopback: bytes readable at the peer right after send()", () => {
  const sock = isWindows ? "u64" : "i32";
  const { symbols: c } = dlopen(isWindows ? "ws2_32.dll" : "libc.so.6", {
    socket: { args: ["i32", "i32", "i32"], returns: sock },
    bind: { args: [sock, "ptr", "i32"], returns: "i32" },
    listen: { args: [sock, "i32"], returns: "i32" },
    getsockname: { args: [sock, "ptr", "ptr"], returns: "i32" },
    connect: { args: [sock, "ptr", "i32"], returns: "i32" },
    accept: { args: [sock, "ptr", "ptr"], returns: sock },
    send: { args: [sock, "ptr", isWindows ? "i32" : "u64", "i32"], returns: isWindows ? "i32" : "i64" },
    recv: { args: [sock, "ptr", isWindows ? "i32" : "u64", "i32"], returns: isWindows ? "i32" : "i64" },
    [isWindows ? "ioctlsocket" : "ioctl"]: { args: [sock, isWindows ? "i32" : "u64", "ptr"], returns: "i32" },
    ...(isWindows ? { WSAStartup: { args: ["u16", "ptr"], returns: "i32" } } : {}),
  } as any) as any;
  if (isWindows) c.WSAStartup(0x0202, ptr(new Uint8Array(1024)));
  const FIONREAD = isWindows ? 0x4004667f : 0x541b;
  const ioctl = isWindows ? c.ioctlsocket : c.ioctl;

  const addr = new Uint8Array(16);
  addr[0] = 2; // AF_INET, little endian
  addr.set([127, 0, 0, 1], 4);
  const len = new Int32Array([16]);
  const listener = c.socket(2, 1, 0);
  const steps = [c.bind(listener, ptr(addr), 16), c.listen(listener, 1), c.getsockname(listener, ptr(addr), ptr(len))];
  const a = c.socket(2, 1, 0);
  steps.push(c.connect(a, ptr(addr), 16));
  const b = c.accept(listener, null, null);

  const bytes = new Uint8Array(64).fill(33);
  const into = new Uint8Array(64);
  const readable = new Uint32Array(1);
  const rounds = 200_000;
  let late = 0;
  let mostSpins = 0;
  for (let i = 0; i < rounds; i++) {
    if (Number(c.send(a, ptr(bytes), 64, 0)) !== 64) throw new Error("send");
    ioctl(b, FIONREAD, ptr(readable));
    if (readable[0] !== 64) {
      late++;
      let spins = 0;
      do {
        spins++;
        ioctl(b, FIONREAD, ptr(readable));
      } while (readable[0] !== 64);
      mostSpins = Math.max(mostSpins, spins);
    }
    if (Number(c.recv(b, ptr(into), 64, 0)) !== 64) throw new Error("recv");
  }
  expect(
    `setup ${steps.join(",")}; of ${rounds} sends, ${late} were not readable at once (most polls until they were: ${mostSpins})`,
  ).toBe("");
});
