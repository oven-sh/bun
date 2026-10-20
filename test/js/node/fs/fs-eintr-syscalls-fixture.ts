// Run by fs-eintr-syscalls.test.ts, in an empty directory, under its shim.
// A row works in "fault-<function>=<errno>[,...]-<row>". The shim fails the
// first call of each named libc function there with that errno and writes
// "<directory> <function>" to $FS_FAULT_LOG.
import fs from "node:fs";
import module from "node:module";
import os from "node:os";
import path from "node:path";

const { EAGAIN, EINTR, EIO, ENOSPC, ENOTSUP } = os.constants.errno;
// ENOTSUPP. The kernel has it, the table of errno names in bun does not.
const ENOTSUPP = 524;

const log = process.env.FS_FAULT_LOG!;
const text = Buffer.alloc(10000, "0123456789").toString();
// macOS clones a file of more than 128 KB. fetch uses sendfile for one of 32 KB or more.
// The numbers from 0 up have no period, so bytes from a wrong offset show.
const large = Array.from({ length: 40_000 }, (_, i) => i).join(" ");
const out: Record<string, unknown> = {};

function fileIn(dir: string, content = text) {
  const file = path.join(dir, "file.txt");
  fs.writeFileSync(file, content);
  return file;
}

/** The libc functions that the shim failed in the directory `name`. */
function shimLog(name: string) {
  const prefix = name + " ";
  return fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
}

async function row(name: string, faults: Record<string, number>, fn: (dir: string) => unknown) {
  const armed = Object.entries(faults).map(([libcFunction, errno]) => `${libcFunction}=${errno}`);
  const dir = path.resolve(`fault-${armed.join(",")}-${name}`);
  fs.mkdirSync(dir);
  const inDir = (p: unknown) => (typeof p === "string" ? path.relative(dir, p) : undefined);
  let result;
  try {
    result = await fn(dir);
  } catch (e: any) {
    result = { code: e.code, errno: e.errno, syscall: e.syscall, path: inDir(e.path), dest: inDir(e.dest) };
  }
  out[name] = { result, shim: shimLog(path.basename(dir)) };
}

function sync(dir: string, method: "fsyncSync" | "fdatasyncSync") {
  const fd = fs.openSync(fileIn(dir), "r+");
  try {
    fs[method](fd);
  } finally {
    fs.closeSync(fd);
  }
  return "synced";
}

/** Copies a file in `dir` with `copy`. True if the copy has the content. */
function copied(dir: string, copy: (from: string, to: string) => unknown, content = text) {
  const to = path.join(dir, "copy.txt");
  const done = copy(fileIn(dir, content), to);
  const same = () => fs.readFileSync(to, "utf8") === content;
  return done instanceof Promise ? done.then(same) : same();
}

function contentLength(request: Buffer) {
  const head = request.toString("latin1", 0, request.indexOf("\r\n\r\n"));
  return Number(/^content-length: (\d+)/im.exec(head)?.[1]);
}

/**
 * Uploads `body` with fetch to a socket that keeps every byte of the request.
 * True if Content-Length and the bytes after the head are exactly `expected`.
 */
async function uploaded(body: Blob, expected: string) {
  const { promise, resolve } = Promise.withResolvers<Buffer>();
  using server = Bun.listen<{ request: Buffer; answered: boolean }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { request: Buffer.alloc(0), answered: false };
      },
      data(socket, chunk) {
        const state = socket.data;
        state.request = Buffer.concat([state.request, chunk]);
        const head = state.request.indexOf("\r\n\r\n");
        if (state.answered || head === -1) return;
        if (state.request.length - head - 4 < contentLength(state.request)) return;
        state.answered = true;
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      },
      // The client closes after the answer. Every byte that it sent has arrived by then.
      close(socket) {
        resolve(socket.data.request);
      },
    },
  });
  const response = await fetch(`http://127.0.0.1:${server.port}/`, { method: "POST", body });
  await response.arrayBuffer();
  const request = await promise;
  const sent = request.subarray(request.indexOf("\r\n\r\n") + 4);
  const length = contentLength(request);
  return (length === expected.length && sent.toString() === expected) || { contentLength: length, sent: sent.length };
}

const uploadedFile = (dir: string) => uploaded(Bun.file(fileIn(dir, large)), large);
const uploadedSlice = (dir: string) => uploaded(Bun.file(fileIn(dir, large)).slice(10, 110), large.slice(10, 110));

const modes = {
  async interrupted() {
    await row("unlinkSync", { unlink: EINTR }, dir => {
      fs.unlinkSync(fileIn(dir));
      return fs.readdirSync(dir);
    });
    await row("unlink", { unlink: EINTR }, async dir => {
      await fs.promises.unlink(fileIn(dir));
      return fs.readdirSync(dir);
    });
    await row("rmdirSync", { rmdir: EINTR }, dir => {
      fs.mkdirSync(path.join(dir, "sub"));
      fs.rmdirSync(path.join(dir, "sub"));
      return fs.readdirSync(dir);
    });
    await row("rmdir", { rmdir: EINTR }, async dir => {
      fs.mkdirSync(path.join(dir, "sub"));
      await fs.promises.rmdir(path.join(dir, "sub"));
      return fs.readdirSync(dir);
    });
    await row("linkSync", { link: EINTR }, dir => {
      const file = fileIn(dir);
      fs.linkSync(file, path.join(dir, "link.txt"));
      return fs.statSync(file).nlink;
    });
    await row("truncateSync", { truncate: EINTR }, dir => {
      const file = fileIn(dir);
      fs.truncateSync(file, 4);
      return fs.readFileSync(file, "utf8");
    });
    await row("fsyncSync", { fsync: EINTR }, dir => sync(dir, "fsyncSync"));
    await row("fdatasyncSync", { fdatasync: EINTR }, dir => sync(dir, "fdatasyncSync"));
    await row("mkdtempSync", { mkdtemp: EINTR }, dir => path.basename(fs.mkdtempSync(path.join(dir, "tmp-"))).length);
    await row("existsSync", { access: EINTR }, dir => fs.existsSync(fileIn(dir)));
    await row("accessSync", { access: EINTR }, dir => fs.accessSync(fileIn(dir)) ?? "accessible");
    await row("which", { stat: EINTR }, dir => {
      const tool = path.join(dir, "tool");
      fs.writeFileSync(tool, "#!/bin/sh\n", { mode: 0o755 });
      return Bun.which("tool", { PATH: dir }) === tool;
    });
    // The cache directory is the real path of the one it was given.
    await row("compileCacheDir", { realpath: EINTR }, dir => {
      fs.mkdirSync(path.join(dir, "real"));
      fs.symlinkSync("real", path.join(dir, "link"));
      module.enableCompileCache({ directory: path.join(dir, "link"), portable: true });
      return module.getCompileCacheDir()!.startsWith(path.join(dir, "real") + path.sep);
    });
  },

  async interruptedCopy() {
    await row("cpSync", { copy_file_range: EINTR }, dir => copied(dir, fs.cpSync));
    await row("cpSyncEmpty", { copy_file_range: EINTR }, dir => {
      const copy = path.join(dir, "copy.txt");
      fs.cpSync(fileIn(dir, ""), copy);
      return fs.readFileSync(copy, "utf8");
    });
    await row("cp", { copy_file_range: EINTR }, dir => copied(dir, fs.promises.cp));
    await row("copyFileSync", { copy_file_range: EINTR }, dir => copied(dir, fs.copyFileSync));
    await row("bunWrite", { copy_file_range: EINTR }, async dir => {
      const copy = path.join(dir, "copy.txt");
      const written = await Bun.write(Bun.file(copy), Bun.file(fileIn(dir)));
      return { written, same: fs.readFileSync(copy, "utf8") === text };
    });
    await row("bunWriteToDevice", { sendfile: EINTR }, dir => {
      const device = Bun.file("/dev/null");
      // Bun.write uses sendfile once it knows that the destination is not a regular file.
      void device.size;
      return Bun.write(device, Bun.file(fileIn(dir)));
    });
    await row("bunWriteFifo", { splice: EINTR }, async dir => {
      const [from, to] = [path.join(dir, "from.fifo"), path.join(dir, "to.fifo")];
      if (Bun.spawnSync({ cmd: ["mkfifo", from, to] }).exitCode !== 0) throw new Error("mkfifo failed");
      // O_RDWR on a FIFO does not wait for the other end.
      const writer = fs.openSync(from, fs.constants.O_RDWR);
      const reader = fs.openSync(to, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
      fs.writeSync(writer, "0123456789");
      const destination = Bun.file(to);
      // Bun.write uses splice once it knows that both ends are FIFOs.
      void destination.size;
      let outcome: { written: number } | { error: Error } | undefined;
      const copy = Bun.write(destination, Bun.file(from)).then(
        written => (outcome = { written }),
        error => (outcome = { error }),
      );
      // The bytes arrive once Bun.write has both FIFOs open. Then the source can end.
      const bytes = Buffer.alloc(16);
      let received = 0;
      while (!outcome && received === 0) {
        try {
          received = fs.readSync(reader, bytes, 0, bytes.length, null);
        } catch (e: any) {
          if (e.code !== "EAGAIN") throw e;
        }
        await new Promise(resolve => setImmediate(resolve));
      }
      fs.closeSync(writer);
      await copy;
      fs.closeSync(reader);
      if ("error" in outcome!) throw outcome.error;
      return { written: outcome!.written, received: bytes.toString("utf8", 0, received) };
    });
    await row("fetchFile", { sendfile: EINTR }, uploadedFile);
    await row("fetchFileSlice", { sendfile: EINTR }, uploadedSlice);
    // No call fails here. The shim cuts each sendfile to 7777 bytes, so the upload takes many calls.
    await row("fetchFileInParts", { sendfile_most: 7777 }, uploadedFile);
  },

  // The shim answers the FICLONE after the one it fails with success. It clones nothing.
  async cloned() {
    const clone = (dir: string, copy: (from: string, to: string) => unknown) => {
      const done = copy(fileIn(dir), path.join(dir, "copy.txt"));
      return done instanceof Promise ? done.then(() => "cloned") : "cloned";
    };
    const forced = (from: string, to: string) => fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE_FORCE);
    await row("forced", { ioctl_ficlone: EINTR }, dir => clone(dir, forced));
    await row("copyFileSync", { ioctl_ficlone: EINTR }, dir => clone(dir, fs.copyFileSync));
    await row("cpSync", { ioctl_ficlone: EINTR }, dir => clone(dir, fs.cpSync));
    await row("cp", { ioctl_ficlone: EINTR }, dir => clone(dir, fs.promises.cp));
    await row("last", { ioctl_ficlone: EINTR }, dir => clone(dir, fs.copyFileSync));
  },

  async failed() {
    await row("copyFileSync", { copy_file_range: ENOSPC }, dir => copied(dir, fs.copyFileSync));
    await row("cpSync", { copy_file_range: ENOSPC }, dir => copied(dir, fs.cpSync));
    await row("bunWrite", { copy_file_range: ENOSPC }, dir =>
      Bun.write(Bun.file(path.join(dir, "copy.txt")), Bun.file(fileIn(dir))),
    );
    await row("unlinkSync", { unlink: ENOTSUPP }, dir => fs.unlinkSync(fileIn(dir)));
    await row("accessSync", { access: ENOTSUPP }, dir => fs.accessSync(fileIn(dir)));
    await row("fetchFile", { sendfile: EIO }, dir => uploadedFile(dir).catch(error => error.code));
  },

  async darwin() {
    const forced = (from: string, to: string) => fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE_FORCE);
    await row("existsSync", { faccessat: EINTR }, dir => fs.existsSync(fileIn(dir)));
    await row("accessSync", { access: EINTR }, dir => fs.accessSync(fileIn(dir)) ?? "accessible");
    await row("cloneForced", { clonefile: EINTR }, dir => copied(dir, forced));
    await row("copyFileSync", { clonefile: EINTR, copyfile: EINTR }, dir => copied(dir, fs.copyFileSync, large));
    await row("cpSync", { clonefile: EINTR, copyfile: EINTR }, dir => copied(dir, fs.cpSync, large));
    await row("copyFileWithoutClone", { clonefile: ENOTSUP, copyfile: EINTR }, dir =>
      copied(dir, fs.copyFileSync, large),
    );
    await row("bunWriteWithoutClone", { clonefile: ENOTSUP, fcopyfile: EINTR }, dir =>
      copied(dir, (from, to) => Bun.write(Bun.file(to), Bun.file(from))),
    );
    await row("fetchFile", { sendfile: EINTR }, uploadedFile);
    await row("fetchFileSlice", { sendfile: EINTR }, uploadedSlice);
    await row("fetchFileAfterSomeBytes", { sendfile_some: EINTR }, uploadedFile);
    await row("fetchFileBufferFull", { sendfile_sent: EAGAIN }, uploadedFile);
    await row("fetchFileEmptySlice", { sendfile: EINTR }, dir =>
      uploaded(Bun.file(fileIn(dir, large)).slice(1000, 1000), ""),
    );
  },

  async darwinFailed() {
    await row("fetchFile", { sendfile: EIO }, dir => uploadedFile(dir).catch(error => error.code));
  },
};

await modes[process.argv[2] as keyof typeof modes]();
console.log(JSON.stringify(out));
