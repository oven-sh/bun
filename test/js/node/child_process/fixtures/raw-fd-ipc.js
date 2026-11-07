// Sends a descriptor over a Node-style IPC channel the way a hostname router
// does: one JSON line `{"cmd":"NODE_HANDLE","type":"fd"}` with the fd attached
// as SCM_RIGHTS. Struct layouts are for 64-bit Linux.
import { dlopen, ptr } from "bun:ffi";

export function rawFdIpc(libcPath) {
  const { symbols: libc } = dlopen(libcPath, {
    socketpair: { args: ["i32", "i32", "i32", "ptr"], returns: "i32" },
    pipe: { args: ["ptr"], returns: "i32" },
    sendmsg: { args: ["i32", "ptr", "i32"], returns: "i64" },
    poll: { args: ["ptr", "u32", "i32"], returns: "i32" },
    read: { args: ["i32", "ptr", "u64"], returns: "i64" },
    close: { args: ["i32"], returns: "i32" },
  });

  function pair(fn, ...args) {
    const fds = new Int32Array(2);
    if (fn(...args, ptr(fds)) !== 0) throw new Error("pipe/socketpair failed");
    return [fds[0], fds[1]];
  }

  return {
    close: fd => libc.close(fd),
    pipe: () => pair(libc.pipe),
    // AF_UNIX, SOCK_STREAM
    socketpair: () => pair(libc.socketpair, 1, 1, 0),

    sendFd(sock, fd, msg) {
      const line = Buffer.from(JSON.stringify({ cmd: "NODE_HANDLE", type: "fd", msg, key: null }) + "\n");
      const iov = new BigUint64Array([BigInt(ptr(line)), BigInt(line.length)]);
      // struct cmsghdr { size_t len; int level; int type; } + one int; SOL_SOCKET = 1, SCM_RIGHTS = 1
      const control = new DataView(new ArrayBuffer(24));
      control.setBigUint64(0, 20n, true);
      control.setInt32(8, 1, true);
      control.setInt32(12, 1, true);
      control.setInt32(16, fd, true);
      // struct msghdr { name; namelen; iov; iovlen; control; controllen; flags }
      const msghdr = new BigUint64Array([0n, 0n, BigInt(ptr(iov)), 1n, BigInt(ptr(control)), 24n, 0n]);
      const sent = libc.sendmsg(sock, ptr(msghdr), 0);
      if (Number(sent) !== line.length) throw new Error(`sendmsg sent ${sent} of ${line.length}`);
    },

    // Resolves "closed" once every copy of the pipe's write end is closed, or
    // "open" if one is still held after `ms`.
    async writeEndState(readFd, ms) {
      // struct pollfd { int fd; short events; short revents; }, POLLIN = 1
      const pfd = new Int32Array([readFd, 1]);
      const buf = new Uint8Array(1);
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (libc.poll(ptr(pfd), 1, 0) > 0 && Number(libc.read(readFd, ptr(buf), 1)) === 0) return "closed";
        await Bun.sleep(1);
      }
      return "open";
    },
  };
}
