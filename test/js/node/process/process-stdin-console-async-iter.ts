import { existsSync } from "node:fs";
import { dlopen, FFIType } from "bun:ffi";
// @ts-ignore
const bunFs = Bun.fs();

if (!process.stdin.isTTY) throw new Error("stdin is not TTY");

if (process.argv[2] === "RAW") process.stdin.setRawMode(true);

const DYN_SUFFIX = "so";
const HELPERS_DIR = bunFs.realpathSync(import.meta.dir + `/../../../helpers`);
const LIB_RAW_MODE_PATH = `${HELPERS_DIR}/libRawModeTest.${DYN_SUFFIX}`;
if (!existsSync(LIB_RAW_MODE_PATH)) {
  throw new Error("Failed to build libRawModeTest helper");
}

const libRawModeTest = dlopen(LIB_RAW_MODE_PATH, {
  tty_is_raw: {
    args: [FFIType.int],
    returns: FFIType.int,
  },
  tty_is_raw_async_io: {
    args: [FFIType.int],
    returns: FFIType.int,
  },
  isatty: {
    args: [FFIType.int],
    returns: FFIType.int,
  },
});

const checkIsRaw = function checkIsRaw(fd: number = 0) {
  if (typeof fd !== "number") throw new Error("fd must be a number");
  if (fd < 0) throw new Error("fd must be a number >= 0");
  return !!libRawModeTest.symbols.tty_is_raw(fd);
};

const checkIsRawAsyncIo = function checkIsRaw(fd: number = 0) {
  if (typeof fd !== "number") throw new Error("fd must be a number");
  if (fd < 0) throw new Error("fd must be a number >= 0");
  return !!libRawModeTest.symbols.tty_is_raw_async_io(fd);
};

const responses = [] as string[];

responses.push(checkIsRaw() ? (checkIsRawAsyncIo() ? "ASYNC_IO" : "RAW") : "NOT_RAW");

for await (const line of console) {
  await Bun.sleep(500);
  responses.push(checkIsRaw() ? (checkIsRawAsyncIo() ? "ASYNC_IO" : "RAW") : "NOT_RAW");
  break;
}

responses.push(checkIsRaw() ? (checkIsRawAsyncIo() ? "ASYNC_IO" : "RAW") : "NOT_RAW");

const writer = Bun.stdout.writer();
writer.write(responses.join(" "));
// @ts-ignore
writer.flush(true);
writer.end();
