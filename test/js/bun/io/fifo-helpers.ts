import fs from "node:fs";

const { O_NONBLOCK, O_RDONLY, O_WRONLY } = fs.constants;

/** Both ends of the FIFO at `path`, non-blocking. */
export function openFifo(path: string) {
  const open = new Set<number>();
  const reader = fs.openSync(path, O_RDONLY | O_NONBLOCK);
  const writer = fs.openSync(path, O_WRONLY | O_NONBLOCK);
  open.add(reader).add(writer);
  const close = (fd: number) => void (open.delete(fd) && fs.closeSync(fd));
  return {
    reader,
    writer,
    inode: fs.fstatSync(reader).ino,
    close,
    [Symbol.dispose]: () => [...open].forEach(close),
  };
}

function untilEAGAIN(step: () => number) {
  let total = 0;
  try {
    for (let n; (n = step());) total += n;
  } catch (e: any) {
    if (e.code !== "EAGAIN") throw e;
  }
  return total;
}

/** Writes until the pipe is full. Returns how much that was. */
export function fill(writer: number) {
  const page = Buffer.alloc(4096, "x");
  return untilEAGAIN(() => fs.writeSync(writer, page));
}

/** Reads until the pipe is empty. Returns how much that was. */
export function drain(reader: number) {
  const buffer = Buffer.alloc(65536);
  return untilEAGAIN(() => fs.readSync(reader, buffer));
}

/** Reads until `promise` settles. Returns how much that was. */
export async function drainUntil(reader: number, promise: Promise<unknown>) {
  let settled = false;
  promise.finally(() => (settled = true)).catch(() => {});
  let total = 0;
  while (!settled) {
    total += drain(reader);
    await Bun.sleep(1);
  }
  return total + drain(reader);
}

/** Linux: how many times this process has asked epoll to tell it when the file is readable or writable. */
export function countWaits(inode: number) {
  let count = 0;
  for (const fd of fs.readdirSync("/proc/self/fdinfo")) {
    let info = "";
    try {
      info = fs.readFileSync("/proc/self/fdinfo/" + fd, "utf8");
    } catch {}
    for (const [, events, ino] of info.matchAll(/^tfd:.* events:\s*([0-9a-f]+) .* ino:([0-9a-f]+)/gm)) {
      // EPOLLIN | EPOLLOUT: a one-shot entry that has fired has neither.
      if (parseInt(ino, 16) === inode && parseInt(events, 16) & 0b101) count++;
    }
  }
  return count;
}

/** Linux: `countWaits` once it is `count`, or after 3 seconds. */
export async function untilWaits(inode: number, count: number) {
  const deadline = performance.now() + 3000;
  while (countWaits(inode) !== count && performance.now() < deadline) await Bun.sleep(1);
  return countWaits(inode);
}
