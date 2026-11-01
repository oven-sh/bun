import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExeOfReportedVersion, tempDir } from "harness";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { ReadStream, isatty } from "node:tty";

test("process.binding('tty_wrap')", () => {
  const tty_wrap: any = process.binding("tty_wrap");

  expect(tty_wrap).toBeDefined();
  expect(tty_wrap).toHaveProperty("TTY");
  expect(tty_wrap).toHaveProperty("isTTY");

  const tty = tty_wrap.TTY;

  expect(tty).toHaveProperty("prototype");

  const tty_prototype = tty.prototype;

  expect(tty_prototype).toHaveProperty("getWindowSize");
  expect(tty_prototype).toHaveProperty("setRawMode");

  const tty_isTTY = tty_wrap.isTTY;

  expect(tty_isTTY(0)).toBe(isatty(0));
  expect(tty_isTTY(1)).toBe(isatty(1));
  expect(tty_isTTY(2)).toBe(isatty(2));

  expect(tty_isTTY(9999999)).toBe(false);

  expect(() => tty()).toThrow(TypeError);

  if (isatty(0)) {
    expect(() => new tty(0)).not.toThrow();

    const array = [-1, -1];

    expect(() => tty_prototype.getWindowSize.call(array, 0)).toThrow(TypeError);
    const ttywrapper = new tty(0);

    // As Node: 0, or a negative libuv errno that leaves the array alone.
    const err = ttywrapper.getWindowSize(array);
    expect(err).toBeNumber();

    if (err === 0) {
      expect(array[0]).toBeNumber();
      expect(array[0]).toBeGreaterThanOrEqual(0);
      expect(array[1]).toBeNumber();
      expect(array[1]).toBeGreaterThanOrEqual(0);
    } else {
      expect(err).toBeLessThan(0);
      expect(array[0]).toBe(-1);
      expect(array[1]).toBe(-1);
    }
  } else {
    console.warn("warn: Skipping tty tests because stdin is not a tty");
  }

  // Like Node's TTYWrap, an fd uv_tty_init rejects (a regular file) does not
  // throw: the error lands on the ctx object and the handle comes back closed.
  using dir = tempDir("tty-wrap", { "file.txt": "not a tty" });
  const fd = openSync(join(String(dir), "file.txt"), "r");
  try {
    const ctx: { code?: string; syscall?: string; message?: string; errno?: number } = {};
    const handle = new tty(fd, ctx);
    // libuv's uv_tty_init finds no console handle on Windows (EBADF) and refuses a file elsewhere (EINVAL).
    expect(ctx).toEqual(
      isWindows
        ? { errno: -4083, code: "EBADF", syscall: "uv_tty_init", message: "bad file descriptor" }
        : { errno: -22, code: "EINVAL", syscall: "uv_tty_init", message: "invalid argument" },
    );
    // A handle that was never open: UV_EINVAL from readStart() and from fd, as in Node.
    const UV_EINVAL = isWindows ? -4071 : -22;
    expect([handle.readStart(), handle.fd]).toEqual([UV_EINVAL, UV_EINVAL]);
    expect(() => new ReadStream(fd)).toThrow(expect.objectContaining({ code: "ERR_TTY_INIT_FAILED" }));
  } finally {
    closeSync(fd);
  }
});

// Bun's handle has a part of the names of Node's. This is the part that it leaves out, and why.
// Node must have exactly the names of inBun and these, so a new name of Node goes into the handle or into this list.
const onlyInNode = [
  // AsyncWrap: Bun has no async id to reset, no provider type and no context frame.
  "asyncReset",
  "getAsyncContextFrameForDebuggingOnly",
  "getProviderType",
  // StreamBase: net.Socket writes a terminal through writeBuffer() alone, and does not shut one down.
  "_externalStream",
  "isStreamBase",
  "shutdown",
  "useUserBuffer",
  "writeAsciiString",
  "writeLatin1String",
  "writeUcs2String",
  "writeUtf8String",
  "writev",
  // LibuvStreamWrap, since v26.12: it answers false for what is no TCP socket and no pipe.
  "hasPendingRead",
];
const inBun = [
  "bytesRead",
  "bytesWritten",
  "close",
  "fd",
  "getAsyncId",
  "getWindowSize",
  "hasRef",
  "onread",
  "readStart",
  "readStop",
  "ref",
  "setBlocking",
  "setRawMode",
  "unref",
  "writeBuffer",
  "writeQueueSize",
];
// Node answers a WriteWrap for a write that waits, and calls the oncomplete of that. Bun's handle calls this one function of its own.
const onlyInBun = ["onwritecomplete"];
// Not compared: the numbers that lib/tty.js of Node reads from the binding since v26.8. https://github.com/oven-sh/bun/pull/47318 gives them to Bun.
const modeConstant = /^UV_TTY_MODE_/;
const namesFixture = `
  const binding = process.binding("tty_wrap");
  const members = new Set();
  for (let proto = binding.TTY.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) if (name !== "constructor") members.add(name);
  }
  console.log(JSON.stringify({ binding: Object.getOwnPropertyNames(binding).sort(), members: [...members].sort() }));
`;

// The names of Node change between its versions: Node is asked where it is the version that Bun says it is.
describe.each([
  ["bun", bunExe(), [...inBun, ...onlyInBun].sort()],
  ["node", nodeExeOfReportedVersion(), [...inBun, ...onlyInNode].sort()],
] as const)("the names of the tty_wrap binding and of its handle (%s)", (name, runtime, members) => {
  test.skipIf(!runtime)("are the ones that are listed", async () => {
    await using proc = Bun.spawn({ cmd: [runtime!, "-e", namesFixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    let names: { binding: string[]; members: string[] };
    try {
      names = JSON.parse(stdout);
    } catch {
      throw new Error(`${name} printed no names: ${JSON.stringify({ stdout, stderr, exitCode })}`);
    }
    expect({ binding: names.binding.filter(other => !modeConstant.test(other)), members: names.members }).toEqual({
      binding: ["TTY", "isTTY"],
      members: [...members],
    });
    expect(exitCode).toBe(0);
  });
});
