// Prints what path_open stores on a new descriptor, and what later hostcalls answer, as one JSON object.
// It uses only the part of node:wasi that Node.js has: `node wasi-path-open-fixture.mjs <dir>` prints the reference.
// <dir> holds file.txt, write.txt and dir/a.txt. On POSIX it also holds a FIFO named fifo with "fifo data\n" in it.
import { WASI } from "node:wasi";

const root = process.argv[2];
const posix = process.platform !== "win32";

const RIGHTS = [
  "FD_DATASYNC",
  "FD_READ",
  "FD_SEEK",
  "FD_FDSTAT_SET_FLAGS",
  "FD_SYNC",
  "FD_TELL",
  "FD_WRITE",
  "FD_ADVISE",
  "FD_ALLOCATE",
  "PATH_CREATE_DIRECTORY",
  "PATH_CREATE_FILE",
  "PATH_LINK_SOURCE",
  "PATH_LINK_TARGET",
  "PATH_OPEN",
  "FD_READDIR",
  "PATH_READLINK",
  "PATH_RENAME_SOURCE",
  "PATH_RENAME_TARGET",
  "PATH_FILESTAT_GET",
  "PATH_FILESTAT_SET_SIZE",
  "PATH_FILESTAT_SET_TIMES",
  "FD_FILESTAT_GET",
  "FD_FILESTAT_SET_SIZE",
  "FD_FILESTAT_SET_TIMES",
  "PATH_SYMLINK",
  "PATH_REMOVE_DIRECTORY",
  "PATH_UNLINK_FILE",
  "POLL_FD_READWRITE",
  "SOCK_SHUTDOWN",
  "SOCK_ACCEPT",
];
const FILETYPES = { 2: "character_device", 3: "directory", 4: "regular_file", 6: "socket_stream" };
const O_CREAT = 1;
const O_DIRECTORY = 2;
const O_TRUNC = 8;
const FDFLAG_APPEND = 1;
const FDFLAG_SYNC = 16;
const WHENCE_CUR = 1;

// "FD_READ|FD_SEEK" to the bits, and the bits to the names. "-" is no right.
const toBits = text => {
  if (text === "-") return 0n;
  return text.split("|").reduce((all, name) => {
    if (!RIGHTS.includes(name)) throw new Error(`${name} is not a right`);
    return all | (1n << BigInt(RIGHTS.indexOf(name)));
  }, 0n);
};
const toNames = value => {
  const set = [];
  for (let bit = 0n; bit < 64n; bit++) if (value & (1n << bit)) set.push(RIGHTS[Number(bit)] ?? `bit ${bit}`);
  return set.join("|") || "-";
};

const wasi = new WASI({ version: "preview1", preopens: posix ? { "/d": root, "/dev": "/dev" } : { "/d": root } });
// (module (memory (export "memory") 1) (func (export "_start")))
const wasm = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 19, 2, 6, 109, 101, 109, 111, 114, 121,
  2, 0, 6, 95, 115, 116, 97, 114, 116, 0, 0, 10, 4, 1, 2, 0, 11,
]);
const instance = new WebAssembly.Instance(new WebAssembly.Module(wasm), {});
wasi.start(instance);

const memory = Buffer.from(instance.exports.memory.buffer);
const view = new DataView(instance.exports.memory.buffer);
const { path_open, fd_fdstat_get, fd_fdstat_set_rights, fd_seek, fd_tell, fd_read } = wasi.wasiImport;
const rootFd = 3;
const devFd = 4;
const pathPtr = 1024;
const fdPtr = 1536;
const statPtr = 2048;
const offsetPtr = 3072;
const iovsPtr = 3584;
const nreadPtr = 3600;
const bufPtr = 4096;

// The new descriptor, or the errno as a string.
const open = (dirfd, guestPath, asked, { oflags = 0, fdflags = 0 } = {}) => {
  const [base, inheriting] = asked.split(" / ");
  const len = memory.write(guestPath, pathPtr);
  const errno = path_open(dirfd, 0, pathPtr, len, oflags, toBits(base), toBits(inheriting), fdflags, fdPtr);
  return errno === 0 ? view.getUint32(fdPtr, true) : `errno ${errno}`;
};
// "<file type> <base rights> / <inheriting rights>" of a descriptor.
const fdstat = fd => {
  if (typeof fd !== "number") return fd;
  const errno = fd_fdstat_get(fd, statPtr);
  if (errno !== 0) return `fd_fdstat_get errno ${errno}`;
  const filetype = view.getUint8(statPtr);
  const base = toNames(view.getBigUint64(statPtr + 8, true));
  const inheriting = toNames(view.getBigUint64(statPtr + 16, true));
  return `${FILETYPES[filetype] ?? filetype} ${base} / ${inheriting}`;
};

const rows = {};
const mixed = "FD_READ|FD_SEEK|FD_TELL|FD_READDIR / -";
rows[`regular file, asked ${mixed}`] = fdstat(open(rootFd, "file.txt", mixed));
rows["regular file, asked - / -"] = fdstat(open(rootFd, "file.txt", "- / -"));
rows["regular file, asked FD_READ / FD_READ|FD_WRITE"] = fdstat(open(rootFd, "file.txt", "FD_READ / FD_READ|FD_WRITE"));
rows[`directory, asked ${mixed}`] = fdstat(open(rootFd, "dir", mixed, { oflags: O_DIRECTORY }));
rows[`directory without O_DIRECTORY, asked ${mixed}`] = fdstat(open(rootFd, "dir", mixed));
rows["new file with O_CREAT, asked FD_READ|FD_WRITE|PATH_OPEN|FD_READDIR / -"] = fdstat(
  open(rootFd, "new.txt", "FD_READ|FD_WRITE|PATH_OPEN|FD_READDIR / -", { oflags: O_CREAT }),
);
rows["regular file with O_CREAT|O_TRUNC, asked FD_WRITE / -"] = fdstat(
  open(rootFd, "write.txt", "FD_WRITE / -", { oflags: O_CREAT | O_TRUNC }),
);
rows["regular file with FDFLAG_APPEND, asked FD_WRITE / -"] = fdstat(
  open(rootFd, "write.txt", "FD_WRITE / -", { fdflags: FDFLAG_APPEND }),
);
rows["regular file with FDFLAG_SYNC, asked FD_WRITE / -"] = fdstat(
  open(rootFd, "write.txt", "FD_WRITE / -", { fdflags: FDFLAG_SYNC }),
);
rows["regular file with O_DIRECTORY, asked FD_READDIR / -"] = fdstat(
  open(rootFd, "file.txt", "FD_READDIR / -", { oflags: O_DIRECTORY }),
);

if (posix) {
  const special = "FD_READ|FD_SEEK|FD_TELL|FD_FILESTAT_GET / FD_READ";
  const fifo = open(rootFd, "fifo", special);
  rows[`FIFO, asked ${special}`] = fdstat(fifo);
  // lseek(fd, 0, SEEK_CUR) and ftell() of a libc, then a read.
  const seek = fd_seek(fifo, 0n, WHENCE_CUR, offsetPtr);
  const tell = fd_tell(fifo, offsetPtr);
  view.setUint32(iovsPtr, bufPtr, true);
  view.setUint32(iovsPtr + 4, 64, true);
  const read = fd_read(fifo, iovsPtr, 1, nreadPtr);
  const data = read === 0 ? memory.toString("latin1", bufPtr, bufPtr + view.getUint32(nreadPtr, true)) : "";
  rows["that FIFO: fd_seek, fd_tell, fd_read"] = `${seek}, ${tell}, ${read} ${JSON.stringify(data)}`;
  rows[`/dev/null, asked ${special}`] = fdstat(open(devFd, "null", special));
}

// A descriptor opens paths only when it asked for PATH_OPEN and its file type has that right.
const file = open(rootFd, "file.txt", "FD_READ / -");
rows["regular file, asked FD_READ / -"] = fdstat(file);
rows['path_open(that regular file, "."), asked FD_READ|FD_WRITE / -'] = fdstat(open(file, ".", "FD_READ|FD_WRITE / -"));
const dirWithout = open(rootFd, "dir", "FD_READDIR / FD_READ", { oflags: O_DIRECTORY });
rows["directory, asked FD_READDIR / FD_READ"] = fdstat(dirWithout);
rows['path_open(that directory, "a.txt"), asked FD_READ / -'] = fdstat(open(dirWithout, "a.txt", "FD_READ / -"));
const dirWith = open(rootFd, "dir", "PATH_OPEN|FD_READDIR / FD_READ", { oflags: O_DIRECTORY });
rows["directory, asked PATH_OPEN|FD_READDIR / FD_READ"] = fdstat(dirWith);
rows['path_open(that directory with PATH_OPEN, "a.txt"), asked FD_READ / -'] = fdstat(
  open(dirWith, "a.txt", "FD_READ / -"),
);

// fd_fdstat_set_rights cannot add a right that the mask removed.
const masked = open(rootFd, "file.txt", "FD_READ|FD_SEEK|PATH_OPEN|FD_READDIR / FD_READ");
rows["regular file, asked FD_READ|FD_SEEK|PATH_OPEN|FD_READDIR / FD_READ"] = fdstat(masked);
for (const asked of ["FD_READ|FD_READDIR / -", "FD_READ|PATH_OPEN / -", "FD_READ / FD_READ", "FD_READ / -"]) {
  const [base, inheriting] = asked.split(" / ");
  const errno = fd_fdstat_set_rights(masked, toBits(base), toBits(inheriting));
  rows[`fd_fdstat_set_rights(that regular file, ${asked})`] = `${errno}, then ${fdstat(masked)}`;
}

console.log(JSON.stringify(rows, null, 2));
