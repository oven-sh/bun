// TEMPORARY: this file records what NtCreateFile does on the Windows lanes of CI
// and fails on purpose so that the record is printed. It is removed before this
// pull request leaves draft.
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const GENERIC_WRITE = 0x40000000;
const DELETE = 0x00010000;
const READ_CONTROL = 0x00020000;
const SYNCHRONIZE = 0x00100000;
const FILE_LIST_DIRECTORY = 0x0001;
const FILE_TRAVERSE = 0x0020;
const FILE_READ_ATTRIBUTES = 0x0080;

const FILE_OPEN = 1;
const FILE_CREATE = 2;
const FILE_OPEN_IF = 3;
const FILE_OVERWRITE_IF = 5;

const FILE_DIRECTORY_FILE = 0x00000001;
const FILE_SYNCHRONOUS_IO_NONALERT = 0x00000020;
const FILE_OPEN_FOR_BACKUP_INTENT = 0x00004000;
const FILE_OPEN_REPARSE_POINT = 0x00200000;

const OBJ_DONT_REPARSE = 0x1000;

const FILE_ACCESS = (GENERIC_WRITE | SYNCHRONIZE | READ_CONTROL) >>> 0;
const FILE_ACCESS_ATTRS = (FILE_ACCESS | FILE_READ_ATTRIBUTES) >>> 0;
const DIR_ACCESS = FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE | READ_CONTROL;
const ATTRS_ACCESS = FILE_READ_ATTRIBUTES | SYNCHRONIZE;
const SYNC = FILE_SYNCHRONOUS_IO_NONALERT;
const DIR_OPTIONS = FILE_DIRECTORY_FILE | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_FOR_BACKUP_INTENT;

const hex = (n: number) => "0x" + (n >>> 0).toString(16).padStart(8, "0");

test.skipIf(!isWindows)("NtCreateFile below a directory handle: OBJ_DONT_REPARSE and FILE_OPEN_REPARSE_POINT", () => {
  const { dlopen, FFIType, ptr } = require("bun:ffi");
  const k32 = dlopen("kernel32.dll", {
    CreateFileW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u64],
      returns: FFIType.u64,
    },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    GetLastError: { args: [], returns: FFIType.u32 },
  }).symbols;
  const nt = dlopen("ntdll.dll", {
    NtCreateFile: {
      args: [
        FFIType.ptr,
        FFIType.u32,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.u32,
        FFIType.u32,
        FFIType.u32,
        FFIType.u32,
        FFIType.ptr,
        FFIType.u32,
      ],
      returns: FFIType.i32,
    },
    NtQueryInformationFile: {
      args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32],
      returns: FFIType.i32,
    },
    NtQueryVolumeInformationFile: {
      args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32],
      returns: FFIType.i32,
    },
    RtlNtStatusToDosError: { args: [FFIType.u32], returns: FFIType.u32 },
  }).symbols;

  const openRoot = (path: string): bigint => {
    const wide = Buffer.from(path + "\0", "utf16le");
    // OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS
    const handle = BigInt(k32.CreateFileW(ptr(wide), DIR_ACCESS, 7, null, 3, 0x02000000, 0n));
    if (handle === 0xffffffffffffffffn) throw new Error(`CreateFileW(${path}) gle=${k32.GetLastError()}`);
    return handle;
  };

  // FileBasicInformation, then FileAttributeTagInformation.
  const describeHandle = (handle: bigint) => {
    const io = Buffer.alloc(16);
    const basic = Buffer.alloc(40);
    const basicStatus = nt.NtQueryInformationFile(handle, ptr(io), ptr(basic), 40, 4) >>> 0;
    const tag = Buffer.alloc(8);
    const tagStatus = nt.NtQueryInformationFile(handle, ptr(io), ptr(tag), 8, 35) >>> 0;
    return {
      basic: basicStatus === 0 ? hex(basic.readUInt32LE(32)) : "status " + hex(basicStatus),
      tag: tagStatus === 0 ? hex(tag.readUInt32LE(4)) : "status " + hex(tagStatus),
    };
  };

  // FileFsDeviceInformation.
  const device = (handle: bigint) => {
    const io = Buffer.alloc(16);
    const info = Buffer.alloc(8);
    const status = nt.NtQueryVolumeInformationFile(handle, ptr(io), ptr(info), 8, 4) >>> 0;
    return status === 0
      ? { type: hex(info.readUInt32LE(0)), characteristics: hex(info.readUInt32LE(4)) }
      : "status " + hex(status);
  };

  type Open = { access: number; disposition: number; options: number; attributes?: number };
  const ntOpen = (root: bigint, name: string, open: Open) => {
    const nameBuf = Buffer.from(name, "utf16le");
    const unicodeString = Buffer.alloc(16);
    unicodeString.writeUInt16LE(nameBuf.length, 0);
    unicodeString.writeUInt16LE(nameBuf.length, 2);
    unicodeString.writeBigUInt64LE(BigInt(ptr(nameBuf)), 8);
    const objectAttributes = Buffer.alloc(48);
    objectAttributes.writeUInt32LE(48, 0);
    objectAttributes.writeBigUInt64LE(root, 8);
    objectAttributes.writeBigUInt64LE(BigInt(ptr(unicodeString)), 16);
    objectAttributes.writeUInt32LE(open.attributes ?? 0, 24);
    const io = Buffer.alloc(16);
    const handleOut = Buffer.alloc(8);
    const status =
      nt.NtCreateFile(
        ptr(handleOut),
        open.access >>> 0,
        ptr(objectAttributes),
        ptr(io),
        null,
        0x80,
        7,
        open.disposition,
        open.options,
        null,
        0,
      ) >>> 0;
    const result: Record<string, unknown> = { status: hex(status) };
    if (status === 0) {
      const handle = handleOut.readBigUInt64LE(0);
      result.information = Number(io.readBigUInt64LE(8));
      if ((open.access & FILE_READ_ATTRIBUTES) !== 0) result.handle = describeHandle(handle);
      k32.CloseHandle(handle);
    } else {
      result.win32 = nt.RtlNtStatusToDosError(status);
    }
    return result;
  };

  const canSymlink = (() => {
    using probe = tempDir("nt-probe-symlink", { target: "" });
    try {
      symlinkSync(join(String(probe), "target"), join(String(probe), "link"), "file");
      return true;
    } catch {
      return false;
    }
  })();

  using dir = tempDir("nt-probe", {
    "victim/keep.txt": "KEEP",
    "out/real/keep.txt": "KEEP",
    "out/file.txt": "FILE",
  });
  const rootPath = realpathSync(String(dir));
  const out = join(rootPath, "out");
  const victim = join(rootPath, "victim");
  symlinkSync(victim, join(out, "shared"), "junction");
  symlinkSync(join(rootPath, "outside"), join(out, "dangling"), "junction");
  if (canSymlink) {
    symlinkSync(join(victim, "keep.txt"), join(out, "cfg"), "file");
    symlinkSync(victim, join(out, "dlink"), "dir");
  }

  const record: Record<string, unknown> = { canSymlink };
  const probe = (name: string, run: () => unknown) => {
    try {
      record[name] = run();
    } catch (error) {
      record[name] = "threw: " + String(error);
    }
  };
  const isLink = (name: string) => {
    try {
      return lstatSync(join(out, name)).isSymbolicLink();
    } catch (error) {
      return String(error);
    }
  };
  // What the probe left outside `out`, then removed again, and whether the links are still links.
  const outside = () => {
    const seen = {
      victim: readdirSync(victim),
      keep: readFileSync(join(victim, "keep.txt"), "utf8"),
      outside: existsSync(join(rootPath, "outside")),
      links: ["shared", "dangling", ...(canSymlink ? ["cfg", "dlink"] : [])].map(isLink).join(","),
    };
    for (const name of seen.victim) if (name !== "keep.txt") rmSync(join(victim, name), { recursive: true });
    if (seen.keep !== "KEEP") writeFileSync(join(victim, "keep.txt"), "KEEP");
    rmSync(join(rootPath, "outside"), { recursive: true, force: true });
    return seen;
  };

  const run = (label: string, rootSpelling: string) => {
    const root = openRoot(rootSpelling);
    const at = (name: string, open: Open) => ({ ...ntOpen(root, name, open), after: outside() });
    const refuse = OBJ_DONT_REPARSE;
    const file = (disposition: number, options = 0, attributes = 0): Open => ({
      access: FILE_ACCESS,
      disposition,
      options: SYNC | options,
      attributes,
    });
    const fileWithAttrs = (disposition: number, options = 0, attributes = 0): Open => ({
      access: FILE_ACCESS_ATTRS,
      disposition,
      options: SYNC | options,
      attributes,
    });
    const directory = (disposition: number, options = 0, attributes = 0): Open => ({
      access: DIR_ACCESS,
      disposition,
      options: DIR_OPTIONS | options,
      attributes,
    });
    const asItself = (attributes = 0): Open => ({
      access: ATTRS_ACCESS,
      disposition: FILE_OPEN,
      options: SYNC | FILE_OPEN_REPARSE_POINT,
      attributes,
    });

    probe(`${label}: device of the root`, () => device(root));
    probe(`${label}: root handle`, () => describeHandle(root));

    // Several components, no link.
    probe(`${label}: real\\new.txt overwrite_if refuse`, () => at("real\\new.txt", file(FILE_OVERWRITE_IF, 0, refuse)));
    probe(`${label}: real\\new.txt overwrite_if refuse again`, () =>
      at("real\\new.txt", file(FILE_OVERWRITE_IF, 0, refuse)),
    );
    probe(`${label}: nope\\x.txt overwrite_if refuse`, () => at("nope\\x.txt", file(FILE_OVERWRITE_IF, 0, refuse)));
    probe(`${label}: file.txt\\x.txt overwrite_if refuse`, () =>
      at("file.txt\\x.txt", file(FILE_OVERWRITE_IF, 0, refuse)),
    );
    probe(`${label}: real overwrite_if refuse (a directory as a file)`, () =>
      at("real", file(FILE_OVERWRITE_IF, 0, refuse)),
    );
    probe(`${label}: real\\sub create-directory refuse`, () =>
      at("real\\sub", directory(FILE_CREATE, FILE_OPEN_REPARSE_POINT, refuse)),
    );
    probe(`${label}: real create-directory refuse (exists)`, () =>
      at("real", directory(FILE_CREATE, FILE_OPEN_REPARSE_POINT, refuse)),
    );
    probe(`${label}: file.txt create-directory refuse (a file)`, () =>
      at("file.txt", directory(FILE_CREATE, FILE_OPEN_REPARSE_POINT, refuse)),
    );

    // A junction in the middle of the name.
    probe(`${label}: shared\\f.txt overwrite_if refuse`, () => at("shared\\f.txt", file(FILE_OVERWRITE_IF, 0, refuse)));
    probe(`${label}: shared\\f.txt overwrite_if follow`, () => at("shared\\f.txt", file(FILE_OVERWRITE_IF)));
    probe(`${label}: shared\\sub create-directory refuse`, () =>
      at("shared\\sub", directory(FILE_CREATE, FILE_OPEN_REPARSE_POINT, refuse)),
    );
    probe(`${label}: shared\\keep.txt open as itself refuse`, () => at("shared\\keep.txt", asItself(refuse)));

    // A junction under the last name.
    probe(`${label}: shared overwrite_if refuse`, () => at("shared", file(FILE_OVERWRITE_IF, 0, refuse)));
    probe(`${label}: shared overwrite_if follow`, () => at("shared", file(FILE_OVERWRITE_IF)));
    probe(`${label}: shared open as itself refuse`, () => at("shared", asItself(refuse)));
    probe(`${label}: shared open as itself`, () => at("shared", asItself()));
    probe(`${label}: shared open_if as itself, write access`, () =>
      at("shared", fileWithAttrs(FILE_OPEN_IF, FILE_OPEN_REPARSE_POINT)),
    );
    probe(`${label}: shared open-directory as itself`, () =>
      at("shared", directory(FILE_OPEN_IF, FILE_OPEN_REPARSE_POINT)),
    );
    probe(`${label}: shared open-directory as itself refuse`, () =>
      at("shared", directory(FILE_OPEN_IF, FILE_OPEN_REPARSE_POINT, refuse)),
    );
    probe(`${label}: shared create-directory as itself refuse`, () =>
      at("shared", directory(FILE_CREATE, FILE_OPEN_REPARSE_POINT, refuse)),
    );
    probe(`${label}: shared open for delete as itself refuse`, () =>
      at("shared", {
        access: DELETE | ATTRS_ACCESS,
        disposition: FILE_OPEN,
        options: DIR_OPTIONS | FILE_OPEN_REPARSE_POINT,
        attributes: refuse,
      }),
    );

    // A junction to nowhere under the last name.
    probe(`${label}: dangling create-directory as itself refuse`, () =>
      at("dangling", directory(FILE_CREATE, FILE_OPEN_REPARSE_POINT, refuse)),
    );
    probe(`${label}: dangling create-directory as itself`, () =>
      at("dangling", directory(FILE_CREATE, FILE_OPEN_REPARSE_POINT)),
    );
    probe(`${label}: dangling create-directory refuse`, () => at("dangling", directory(FILE_CREATE, 0, refuse)));
    probe(`${label}: dangling open_if-directory as itself`, () =>
      at("dangling", directory(FILE_OPEN_IF, FILE_OPEN_REPARSE_POINT)),
    );

    // A regular file and a new name, opened as themselves.
    probe(`${label}: file.txt open_if as itself`, () =>
      at("file.txt", fileWithAttrs(FILE_OPEN_IF, FILE_OPEN_REPARSE_POINT)),
    );
    probe(`${label}: fresh.txt open_if as itself`, () =>
      at("fresh.txt", fileWithAttrs(FILE_OPEN_IF, FILE_OPEN_REPARSE_POINT)),
    );
    probe(`${label}: newdir open_if-directory as itself`, () =>
      at("newdir", directory(FILE_OPEN_IF, FILE_OPEN_REPARSE_POINT)),
    );
    probe(`${label}: real open-directory as itself`, () => at("real", directory(FILE_OPEN, FILE_OPEN_REPARSE_POINT)));
    probe(`${label}: file.txt open-directory as itself (a file)`, () =>
      at("file.txt", directory(FILE_OPEN, FILE_OPEN_REPARSE_POINT)),
    );

    if (canSymlink) {
      // A symlink to a file under the last name.
      probe(`${label}: cfg overwrite_if refuse`, () => at("cfg", file(FILE_OVERWRITE_IF, 0, refuse)));
      probe(`${label}: cfg overwrite_if follow`, () => at("cfg", file(FILE_OVERWRITE_IF)));
      probe(`${label}: cfg open as itself refuse`, () => at("cfg", asItself(refuse)));
      probe(`${label}: cfg open_if as itself, write access`, () =>
        at("cfg", fileWithAttrs(FILE_OPEN_IF, FILE_OPEN_REPARSE_POINT)),
      );
      probe(`${label}: cfg open-directory as itself (a file symlink)`, () =>
        at("cfg", directory(FILE_OPEN, FILE_OPEN_REPARSE_POINT)),
      );
      probe(`${label}: cfg\\x.txt overwrite_if refuse`, () => at("cfg\\x.txt", file(FILE_OVERWRITE_IF, 0, refuse)));
      // A symlink to a directory.
      probe(`${label}: dlink\\f.txt overwrite_if refuse`, () => at("dlink\\f.txt", file(FILE_OVERWRITE_IF, 0, refuse)));
      probe(`${label}: dlink\\f.txt overwrite_if follow`, () => at("dlink\\f.txt", file(FILE_OVERWRITE_IF)));
      probe(`${label}: dlink open-directory as itself`, () =>
        at("dlink", directory(FILE_OPEN, FILE_OPEN_REPARSE_POINT)),
      );
      probe(`${label}: dlink overwrite_if refuse`, () => at("dlink", file(FILE_OVERWRITE_IF, 0, refuse)));
    }

    k32.CloseHandle(root);
    for (const name of ["real\\new.txt", "real\\sub", "fresh.txt", "newdir"]) {
      rmSync(join(out, name), { recursive: true, force: true });
    }
  };

  run("local", out);
  const remote = `\\\\localhost\\${out[0]}$\\${out.slice(3)}`;
  record.remoteReachable = existsSync(remote);
  if (record.remoteReachable) run("remote", remote);

  expect(record).toEqual({});
});
