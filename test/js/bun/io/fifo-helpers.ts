import { mkfifo } from "mkfifo";
import fs from "node:fs";
import { join } from "node:path";

const { O_NONBLOCK, O_RDONLY, O_WRONLY } = fs.constants;

/** Makes a FIFO in `dir` and opens both ends, non-blocking. */
export function openFifo(dir: string) {
  const path = join(dir, "fifo");
  mkfifo(path);
  const reader = fs.openSync(path, O_RDONLY | O_NONBLOCK);
  const writer = fs.openSync(path, O_WRONLY | O_NONBLOCK);
  const open = new Set([reader, writer]);
  const close = (fd: number) => void (open.delete(fd) && fs.closeSync(fd));
  return { path, reader, writer, close, [Symbol.dispose]: () => [...open].forEach(close) };
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

/** Linux: resolves when this process has asked epoll to tell it when `fd` is readable or writable. */
export async function untilWatched(fd: number) {
  const inode = fs.fstatSync(fd).ino;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const name of fs.readdirSync("/proc/self/fdinfo")) {
      let info = "";
      try {
        info = fs.readFileSync("/proc/self/fdinfo/" + name, "utf8");
      } catch {}
      for (const [, events, ino] of info.matchAll(/^tfd:.* events:\s*([0-9a-f]+) .* ino:([0-9a-f]+)/gm)) {
        // EPOLLIN | EPOLLOUT: a one-shot entry that has fired has neither.
        if (parseInt(ino, 16) === inode && parseInt(events, 16) & 0b101) return;
      }
    }
    await Bun.sleep(1);
  }
  throw new Error(`nothing waits for fd ${fd}`);
}
