/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * Before a WASI hostcall does anything else, Node checks every range of guest
 * memory that its arguments name, and answers EOVERFLOW for one that is out of
 * bounds: https://github.com/nodejs/node/blob/v26.3.0/src/node_wasi.cc#L22-L27
 *
 * The expected values are those of Node v27.0.0-alpha.0.1.0. Where Bun or an
 * older Node answers something else on purpose, the line that says so is next
 * to the case.
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { WASI } from "node:wasi";

const isBun = typeof Bun !== "undefined";
// Before nodejs/node#66636, Node answers EINVAL for a pointer at or above 2 GiB in the hostcalls that take an i64.
const readsHighPointers = isBun || Number(process.versions.node.split(".")[0]) >= 27;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "node-wasi-guest-memory-"));
const stdio = fs.openSync(path.join(root, "stdio"), "w+");
after(() => {
  fs.closeSync(stdio);
  fs.rmSync(root, { recursive: true, force: true });
});

const uleb = n => {
  const bytes = [];
  do {
    bytes.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0));
    n >>>= 7;
  } while (n);
  return bytes;
};
const sleb = n => {
  const bytes = [];
  for (;;) {
    const byte = n & 0x7f;
    n >>= 7;
    if ((n === 0 && !(byte & 0x40)) || (n === -1 && byte & 0x40)) return [...bytes, byte];
    bytes.push(byte | 0x80);
  }
};
const wasmName = string => [...uleb(string.length), ...Buffer.from(string)];
const wasmVec = items => [...uleb(items.length), ...items.flat()];
const wasmSection = (id, bytes) => [id, ...uleb(bytes.length), ...bytes];
const i32Const = n => [0x41, ...sleb(n)];
const f64Const = n => [0x44, ...new Uint8Array(new Float64Array([n]).buffer)];
const wasmCall = index => [0x10, ...uleb(index)];
const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0];
const WASM_TYPES = { i: 0x7f, I: 0x7e, d: 0x7c };

// A wasm guest that imports `imports` from WASI ({ name: parameters }, "i" for an i32, "I" for an i64 and "d" for
// an f64, each returning an i32) and exports, under the same names, functions that pass their arguments straight
// to the import. Calling through those hands the host what a compiled guest does: an i32 arrives as a signed number.
// `start` is the body of _start, and `data` is copied to address 0 of its memory of `pages` pages.
function wasiGuest(imports, { start = [], data = [], pages = 1 } = {}) {
  const names = Object.keys(imports);
  const types = names.map(name => [0x60, ...wasmVec([...imports[name]].map(c => [WASM_TYPES[c]])), 1, 0x7f]);
  const trampolines = names.map((name, index) => {
    const body = [0, ...[...imports[name]].flatMap((_, local) => [0x20, local]), ...wasmCall(index), 0x0b];
    return [...uleb(body.length), ...body];
  });
  const startBody = [0, ...start, 0x0b];
  return new Uint8Array([
    ...WASM_HEADER,
    ...wasmSection(1, wasmVec([...types, [0x60, 0, 0]])),
    ...wasmSection(
      2,
      wasmVec(names.map((name, i) => [...wasmName("wasi_snapshot_preview1"), ...wasmName(name), 0, i])),
    ),
    ...wasmSection(3, wasmVec([...names.map((_, i) => [i]), [names.length]])),
    ...wasmSection(5, [1, 0, ...uleb(pages)]),
    ...wasmSection(
      7,
      wasmVec([
        ...names.map((name, i) => [...wasmName(name), 0, names.length + i]),
        [...wasmName("_start"), 0, names.length * 2],
        [...wasmName("memory"), 2, 0],
      ]),
    ),
    ...wasmSection(10, wasmVec([...trampolines, [...uleb(startBody.length), ...startBody]])),
    ...wasmSection(11, wasmVec([[0, ...i32Const(0), 0x0b, ...uleb(data.length), ...data]])),
  ]);
}

const WASI_EBADF = 8;
const WASI_EINVAL = 28;
const WASI_EOVERFLOW = 61;
const PAGE = 65536;
const STDIN = 0;
const STDOUT = 1;
const DIR = 3; // the preopened directory
const FILE = 4; // file.txt, opened by the guest
// Where the valid calls below point: path strings, two iovecs and the 4 bytes the first one names, one clock
// subscription, and scratch space for what the host writes.
const STRINGS = ["file.txt", "link", "mkdir", "rmdir", "unlink.txt", "rename.txt", "renamed", "linked", "symlinked"];
const str = string => [1024 + 32 * STRINGS.indexOf(string), string.length];
const IOVEC = 2048;
const DATA = 2080;
const SUBSCRIPTION = 2112;
const OUT = 4096;
const OUT2 = 4160;
const BUF = 8192;
// One valid call of each hostcall that is handed guest memory, then what its arguments name:
// [pointer argument, bytes per element] or [pointer argument, bytes per element, count argument].
// prettier-ignore
const GUEST_MEMORY = {
  args_get: [[OUT, BUF], [0, 2 * 4], [1, "argv0\0b\0".length]],
  args_sizes_get: [[OUT, OUT2], [0, 4], [1, 4]],
  clock_res_get: [[1, OUT], [1, 8]],
  clock_time_get: [[1, 0n, OUT], [2, 8]],
  environ_get: [[OUT, BUF], [0, 1 * 4], [1, "K=v\0".length]],
  environ_sizes_get: [[OUT, OUT2], [0, 4], [1, 4]],
  fd_fdstat_get: [[FILE, OUT], [1, 24]],
  fd_filestat_get: [[FILE, OUT], [1, 64]],
  fd_pread: [[FILE, IOVEC, 1, 0n, OUT], [1, 8, 2], [4, 4]],
  fd_prestat_dir_name: [[DIR, BUF, "/sandbox".length], [1, 1, 2]],
  fd_prestat_get: [[DIR, OUT], [1, 8]],
  fd_pwrite: [[FILE, IOVEC, 1, 0n, OUT], [1, 8, 2], [4, 4]],
  fd_read: [[STDIN, IOVEC, 1, OUT], [1, 8, 2], [3, 4]],
  fd_readdir: [[DIR, BUF, 256, 0n, OUT], [1, 1, 2], [4, 4]],
  fd_seek: [[FILE, 3n, 0, OUT], [3, 8]],
  fd_tell: [[FILE, OUT], [1, 8]],
  fd_write: [[STDOUT, IOVEC, 1, OUT], [1, 8, 2], [3, 4]],
  path_create_directory: [[DIR, ...str("mkdir")], [1, 1, 2]],
  path_filestat_get: [[DIR, 0, ...str("file.txt"), OUT], [2, 1, 3], [4, 64]],
  path_filestat_set_times: [[DIR, 0, ...str("file.txt"), 0n, 0n, 0], [2, 1, 3]],
  path_link: [[DIR, 0, ...str("file.txt"), DIR, ...str("linked")], [2, 1, 3], [5, 1, 6]],
  path_open: [[DIR, 0, ...str("file.txt"), 0, 2n, 0n, 0, OUT], [2, 1, 3], [8, 4]],
  path_readlink: [[DIR, ...str("link"), BUF, 64, OUT], [1, 1, 2], [3, 1, 4], [5, 4]],
  path_remove_directory: [[DIR, ...str("rmdir")], [1, 1, 2]],
  path_rename: [[DIR, ...str("rename.txt"), DIR, ...str("renamed")], [1, 1, 2], [4, 1, 5]],
  path_symlink: [[...str("file.txt"), DIR, ...str("symlinked")], [0, 1, 1], [3, 1, 4]],
  path_unlink_file: [[DIR, ...str("unlink.txt")], [1, 1, 2]],
  poll_oneoff: [[SUBSCRIPTION, BUF, 1, OUT], [0, 48, 2], [1, 32, 2], [3, 4]],
  random_get: [[BUF, 16], [0, 1, 1]],
};
const SIGNATURES = Object.fromEntries(
  Object.entries(GUEST_MEMORY).map(([hostcall, [args]]) => [
    hostcall,
    args.map(arg => (typeof arg === "bigint" ? "I" : "i")).join(""),
  ]),
);
const IOVEC_HOSTCALLS = ["fd_pread", "fd_pwrite", "fd_read", "fd_write"];
// The arguments that are descriptors. A hostcall that is not listed takes none, or one as its first argument.
const DESCRIPTORS = { path_link: [0, 4], path_rename: [0, 3], path_symlink: [2] };
const NO_DESCRIPTOR = ["args_get", "args_sizes_get", "environ_get", "environ_sizes_get", "poll_oneoff", "random_get"];
// An argument that is not memory and that Node refuses with EINVAL: an offset of 2 ** 63 or more, a whence that
// does not exist, both ways to set one time.
const REFUSED = { fd_pread: [3, -1n], fd_pwrite: [3, -1n], fd_seek: [2, 9], path_filestat_set_times: [6, 1 | 2] };

// A directory for the guest, a WASI that has it as descriptor 3, and a guest of `pages` pages whose memory holds
// what the valid calls point at, `base` bytes above where the constants say.
function makeGuest(name, { pages = 1, base = 0, signatures = SIGNATURES } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "file.txt"), "0123456789");
  fs.writeFileSync(path.join(dir, "unlink.txt"), "");
  fs.writeFileSync(path.join(dir, "rename.txt"), "");
  fs.mkdirSync(path.join(dir, "rmdir"));
  fs.symlinkSync("file.txt", path.join(dir, "link"));

  // Only in Bun: everything a hostcall does besides answering, which is host fs calls and hooks, in order.
  const did = [];
  let wasi;
  if (isBun) {
    const { bindings } = new WASI({});
    const countedFs = new Proxy(bindings.fs, {
      get: (target, key) =>
        typeof target[key] !== "function" ? target[key] : (...args) => (did.push(key), target[key](...args)),
    });
    wasi = new WASI({
      args: ["argv0", "b"],
      env: { K: "v" },
      preopens: { "/sandbox": dir },
      bindings: { ...bindings, fs: countedFs },
      sendStdout: bytes => did.push(`stdout ${Buffer.from(bytes)}`),
      getStdin: () => (did.push("stdin"), Buffer.from("in")),
      sleep: () => did.push("sleep"),
    });
  } else {
    const options = { args: ["argv0", "b"], env: { K: "v" }, preopens: { "/sandbox": dir } };
    wasi = new WASI({ version: "preview1", ...options, stdin: stdio, stdout: stdio, stderr: stdio });
  }
  const module = new WebAssembly.Module(wasiGuest(signatures, { pages }));
  const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: wasi.wasiImport });
  wasi.start(instance);
  const guest = instance.exports;
  // The pages that the calls point into. A Buffer of all of a memory above 2 GiB is more than Node allows.
  const bytes = Buffer.from(guest.memory.buffer, base, PAGE);
  for (const string of STRINGS) bytes.write(string, str(string)[0]);
  bytes.writeUInt32LE(base + DATA, IOVEC);
  bytes.writeUInt32LE(4, IOVEC + 4);
  bytes.write("data", DATA);
  bytes.writeUInt32LE(1, SUBSCRIPTION + 16); // a monotonic clock that has already fired
  const rights = BigInt(2 | 4 | 32 | 64 | (1 << 21)); // read, seek, tell, write, filestat_get
  assert.strictEqual(guest.path_open(DIR, 0, base + str("file.txt")[0], "file.txt".length, 0, rights, 0n, 0, OUT), 0);
  assert.strictEqual(Buffer.from(guest.memory.buffer, OUT, 4).readUInt32LE(0), FILE);

  const listing = () => fs.readdirSync(dir).sort().join(" ");
  const descriptors = () =>
    isBun ? JSON.stringify([...wasi.FD_MAP].map(([fd, entry]) => [fd, String(entry.offset)])) : "";
  // What one call answered, and what it did: whether it wrote guest memory or changed the directory, and in Bun the
  // host fs calls and hooks it made and whether a descriptor changed.
  const observe = (hostcall, args) => {
    did.length = 0;
    const memoryBefore = Buffer.from(bytes);
    const listingBefore = listing();
    const descriptorsBefore = descriptors();
    let answer;
    try {
      answer = guest[hostcall](...args);
    } catch (e) {
      answer = `threw ${e.constructor.name}`;
    }
    return {
      answer,
      wrote: !memoryBefore.equals(bytes),
      listed: listing() !== listingBefore,
      did: did.join(" "),
      moved: descriptors() !== descriptorsBefore,
    };
  };
  return { guest, bytes, observe };
}

// Each way to move one range of a valid call: [what, arguments, bytes to move first, whether it still fits].
function* movedRanges(args, [pointer, bytes, count]) {
  const n = count === undefined ? 1 : args[count];
  const size = bytes * n;
  const at = (to, more) => Object.assign([...args], { [pointer]: to }, more);
  yield ["ends at the end of memory", at(PAGE - size), [args[pointer], PAGE - size, size], true];
  yield ["ends one byte past the end", at(PAGE - size + 1), null, false];
  yield ["starts at the end", at(PAGE), null, false];
  yield ["starts past the end", at(PAGE + 4096), null, false];
  yield ["pointer 0x80000000", at(0x80000000), null, false];
  yield ["pointer 0xffffffff", at(0xffffffff), null, false];
  if (count !== undefined) {
    yield ["one element too many", at(PAGE - size, { [count]: n + 1 }), null, false];
    yield ["count 0x7fffffff", at(args[pointer], { [count]: 0x7fffffff }), null, false];
    yield ["count 0xffffffff", at(args[pointer], { [count]: 0xffffffff }), null, false];
    // Of elements of 8, 32 or 48 bytes, this many are a multiple of 2 ** 32 bytes: nodejs/node#66849.
    yield ["count 0x20000000", at(PAGE - size, { [count]: 0x20000000 }), null, false];
    yield ["empty, on the last byte", at(PAGE - 1, { [count]: 0 }), null, "empty"];
    yield ["empty, at the end", at(PAGE, { [count]: 0 }), null, "empty at the end"];
    yield ["empty, one byte past the end", at(PAGE + 1, { [count]: 0 }), null, false];
  }
}
// The same for the buf and len of the iovec at IOVEC: [what, buf, len, whether it still fits].
const MOVED_IOVECS = [
  ["iovec ends at the end of memory", PAGE - 4, 4, true],
  ["iovec ends one byte past the end", PAGE - 3, 4, false],
  ["iovec starts at the end", PAGE, 4, false],
  ["iovec buf 0x80000000", 0x80000000, 4, false],
  ["iovec len reaches past the end", DATA, PAGE, false],
  ["iovec len 0xffffffff", DATA, 0xffffffff, false],
  ["empty iovec on the last byte", PAGE - 1, 0, "empty"],
  ["empty iovec at the end", PAGE, 0, "empty at the end"],
  ["empty iovec one byte past the end", PAGE + 1, 0, false],
];

test("a hostcall answers EOVERFLOW for guest memory that is out of bounds, before it does anything else", () => {
  const { bytes, observe } = makeGuest("matrix");
  const rejected = { answer: WASI_EOVERFLOW, wrote: false, listed: false, did: "", moved: false };
  const unexpected = [];
  const valid = {};
  for (const [hostcall, [args, ...ranges]] of Object.entries(GUEST_MEMORY)) {
    const first = observe(hostcall, args).answer;
    if (first !== 0) unexpected.push([hostcall, "valid call", first]);
    // From the second time on, a call that creates or removes something answers that it is there or gone, so the
    // same call then answers and does the same thing every time.
    const again = observe(hostcall, args);
    valid[hostcall] = again.did;
    const pristine = Buffer.from(bytes);
    const check = (what, probe, fits) => {
      // An empty range at the end of memory: Node answers EOVERFLOW, and Bun takes it as memory.fill does. A guest
      // whose buffer ends where its memory ends reads into such a range when the buffer is full.
      if (fits === "empty at the end") fits = isBun ? "empty" : false;
      let ok;
      if (fits === "empty") ok = typeof probe.answer === "number" && probe.answer !== WASI_EOVERFLOW;
      else if (fits === true) ok = probe.answer === again.answer && probe.did === again.did;
      else ok = isDeepStrictEqual(probe, rejected);
      if (!ok) unexpected.push([hostcall, what, probe]);
      pristine.copy(bytes);
    };
    for (const range of ranges) {
      // uvwasi reads one byte past a path that ends where memory ends, and Node dies of it.
      const isPath =
        hostcall.startsWith("path_") && range[1] === 1 && !(hostcall === "path_readlink" && range[0] === 3);
      for (const [what, moved, copy, fits] of movedRanges(args, range)) {
        if (!isBun && isPath && fits === true) continue;
        // Node multiplies in 32 bits, takes these elements of 8, 32 or 48 bytes as no bytes, and dies of reading them.
        if (!isBun && what === "count 0x20000000" && range[1] !== 1) continue;
        if (!readsHighPointers && /0x80000000|0xffffffff/.test(what) && SIGNATURES[hostcall].includes("I")) continue;
        if (copy) bytes.copyWithin(copy[1], copy[0], copy[0] + copy[2]);
        check(`argument ${range[0]} ${what}`, observe(hostcall, moved), fits);
      }
    }
    // A descriptor that is not open, a clock that does not exist and an argument that Node refuses do not hide
    // memory that is out of bounds: Node looks at the memory first.
    const refusals = (NO_DESCRIPTOR.includes(hostcall) ? [] : (DESCRIPTORS[hostcall] ?? [0])).map(d => [d, 99]);
    if (REFUSED[hostcall]) refusals.push(REFUSED[hostcall]);
    for (const [argument, value] of refusals) {
      for (const [pointer, size, count] of ranges) {
        const onePast = PAGE - size * (count === undefined ? 1 : args[count]) + 1;
        check(
          `argument ${pointer} ends one byte past the end, argument ${argument} is ${value}`,
          observe(hostcall, Object.assign([...args], { [argument]: value, [pointer]: onePast })),
          false,
        );
      }
    }
    if (IOVEC_HOSTCALLS.includes(hostcall)) {
      for (const [what, buf, len, fits] of MOVED_IOVECS) {
        bytes.writeUInt32LE(buf, IOVEC);
        bytes.writeUInt32LE(len, IOVEC + 4);
        bytes.copyWithin(PAGE - 4, DATA, DATA + 4);
        check(what, observe(hostcall, args), fits);
      }
      bytes.writeUInt32LE(PAGE - 3, IOVEC + 8);
      bytes.writeUInt32LE(4, IOVEC + 12);
      check("the second of two iovecs ends one byte past the end", observe(hostcall, args.with(2, 2)), false);
      for (const [argument, value] of refusals) {
        bytes.writeUInt32LE(PAGE - 3, IOVEC);
        const probe = observe(hostcall, args.with(argument, value));
        check(`iovec ends one byte past the end, argument ${argument} is ${value}`, probe, false);
      }
    }
  }
  // An empty link target does not hide a new path that is out of bounds, and does not come before the descriptor.
  const [, , fd, newPath, newPathLen] = GUEST_MEMORY.path_symlink[0];
  const emptyTarget = [
    observe("path_symlink", [PAGE - 1, 0, fd, PAGE - newPathLen + 1, newPathLen]).answer,
    observe("path_symlink", [PAGE - 1, 0, 99, newPath, newPathLen]).answer,
  ];
  assert.deepStrictEqual({ unexpected, emptyTarget }, { unexpected: [], emptyTarget: [WASI_EOVERFLOW, WASI_EBADF] });
  // The record of what a call did is not empty for the valid calls that the rows above compare with.
  if (isBun) {
    const { fd_pread, fd_pwrite, fd_read, fd_write } = valid;
    assert.deepStrictEqual(
      { fd_pread, fd_pwrite, fd_read, fd_write: fd_write.split(" ")[0] },
      { fd_pread: "readSync", fd_pwrite: "writeSync", fd_read: "stdin", fd_write: "stdout" },
    );
  }
});

(readsHighPointers ? test : test.skip)("a valid call whose pointers are above 2 GiB answers as one below", () => {
  const base = 2 ** 31; // the last page of the guest's memory
  const { observe } = makeGuest("high", { pages: base / PAGE + 1, base });
  const answers = {};
  for (const [hostcall, [args, ...ranges]] of Object.entries(GUEST_MEMORY)) {
    const high = [...args];
    for (const [pointer] of ranges) high[pointer] += base;
    answers[hostcall] = observe(hostcall, high).answer;
  }
  assert.deepStrictEqual(answers, Object.fromEntries(Object.keys(GUEST_MEMORY).map(hostcall => [hostcall, 0])));
});

test("an import declared with another type where a pointer or a count goes gets EINVAL", () => {
  const signatures = {
    ...SIGNATURES,
    fd_fdstat_get: "iI",
    random_get: "Ii",
    fd_write: "iiIi",
    path_create_directory: "idi",
    fd_prestat_dir_name: "iid",
    poll_oneoff: "diii",
  };
  const { guest, bytes, observe } = makeGuest("wrong-type", { signatures });
  // A name at 200: that is where a pointer of 2 ** 32 + 200 points when it is cut to 32 bits.
  bytes.write("made", 200);
  const created = () => fs.readdirSync(path.join(root, "wrong-type")).includes("made");

  assert.deepStrictEqual(
    {
      i64: [guest.fd_fdstat_get(STDOUT, 0n), guest.random_get(0n, 4), guest.fd_write(STDOUT, 0, 0n, OUT)],
      f64: [
        guest.path_create_directory(DIR, 2 ** 32 + 200, "made".length),
        guest.path_create_directory(DIR, 200.5, "made".length),
        guest.path_create_directory(DIR, NaN, "made".length),
        guest.fd_prestat_dir_name(DIR, BUF, 8.5),
        observe("poll_oneoff", [NaN, BUF, 1, OUT]),
      ],
      // An f64 that is a u32 is a pointer: this one is out of bounds, and 200 is not.
      u32: [guest.path_create_directory(DIR, 2 ** 31 + 200, "made".length), created()],
      created: [guest.path_create_directory(DIR, 200, "made".length), created()],
    },
    {
      i64: [WASI_EINVAL, WASI_EINVAL, WASI_EINVAL],
      f64: [
        WASI_EINVAL,
        WASI_EINVAL,
        WASI_EINVAL,
        WASI_EINVAL,
        { answer: WASI_EINVAL, wrote: false, listed: false, did: "", moved: false },
      ],
      u32: [WASI_EOVERFLOW, false],
      created: [0, true],
    },
  );
});

// Only in Bun: Node.js does not run a .wasm file, and when Node.js runs this file it must not spawn itself again.
if (isBun) {
  const { bunEnv, bunExe, isLinux, nodeExeAtLeast } = await import("harness");

  test("bun guest.wasm: out-of-bounds iovecs give the guest EOVERFLOW and print nothing on the host", async () => {
    // _start makes four calls with one page of memory and exits with the sum of what they answered. fd_write with
    // an iovec whose buf is past the end, an iovec array that is past the end, and an iovec whose len reaches past
    // the end. Then poll_oneoff with NaN where its import declares the pointer to the subscriptions as an f64.
    const data = Buffer.alloc(64);
    data.writeUInt32LE(70000, 48);
    data.writeUInt32LE(10, 52);
    data.writeUInt32LE(65530, 56);
    data.writeUInt32LE(4096, 60);
    const fdWrite = (iovs, iovsLen) => [
      ...i32Const(2),
      ...i32Const(iovs),
      ...i32Const(iovsLen),
      ...i32Const(128),
      ...wasmCall(0),
    ];
    const pollOneoff = [...f64Const(NaN), ...i32Const(4096), ...i32Const(1), ...i32Const(128), ...wasmCall(2)];
    const add = 0x6a;
    const drop = 0x1a;
    // prettier-ignore
    const start = [...fdWrite(48, 1), ...fdWrite(65534, 1), add, ...fdWrite(56, 1), add, ...pollOneoff, add, ...wasmCall(1), drop];
    const wasm = path.join(root, "guest.wasm");
    fs.writeFileSync(
      wasm,
      wasiGuest({ fd_write: "iiii", proc_exit: "i", poll_oneoff: "diii" }, { start, data: [...data] }),
    );

    await using proc = Bun.spawn({ cmd: [bunExe(), wasm], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    assert.deepStrictEqual(
      { stdout, stderr, exitCode },
      { stdout: "", stderr: "", exitCode: 3 * WASI_EOVERFLOW + WASI_EINVAL },
    );
  });

  // The answers above were read from Node v26.3.0 and v27.0.0-alpha.0.1.0, on Linux.
  const node = isLinux ? nodeExeAtLeast("26.3.0") : null;
  (node ? test : test.skip)("all tests pass in Node.js", async () => {
    // A direct run, not `node --test`: the runner mode forks a second node process per file. node:test still exits
    // non-zero on any failure.
    await using proc = Bun.spawn({
      cmd: [node, "--no-warnings", fileURLToPath(import.meta.url)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
  });
}
