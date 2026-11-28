/**
 * A string write with an encoding argument that does not name an encoding
 * writes UTF-8. Node's binding reads the argument with
 * ParseEncoding(args[3], UTF8), which returns UTF8 for an unknown name and for
 * a value that is not a primitive string:
 * https://github.com/nodejs/node/blob/v26.12.1/src/node_file.cc#L3204
 * https://github.com/nodejs/node/blob/v26.12.1/src/api/encoding.cc#L125-L136
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node`, which is where the expected values come from: Node.js v26.12.1
 * passes every test. It cannot import from "harness" for the same reason, so
 * it manages its own temporary directory.
 *
 * Node.js v27 rejects an unknown encoding with ERR_UNKNOWN_ENCODING in its JS
 * validateEncoding (https://github.com/nodejs/node/pull/66247), so this file
 * fails under that Node.js. When Bun reports v27, port that check and change
 * the expected values here.
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { promisify } from "node:util";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-write-unknown-encoding-"));
const file = path.join(dir, "out.bin");
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// "é" tells UTF-8 (c3 a9) from latin1 (e9), and it ends a hex decode after "ab".
const data = "ab\u00e9d";
const utf8 = [0x61, 0x62, 0xc3, 0xa9, 0x64];
const utf16le = [0x61, 0, 0x62, 0, 0xe9, 0, 0x64, 0];

const encodings: [label: string, encoding: unknown, bytes: number[]][] = [
  ["'bogus'", "bogus", utf8],
  ["'BOGUS'", "BOGUS", utf8],
  ["'he'", "he", utf8],
  ["'hexx'", "hexx", utf8],
  ["' hex'", " hex", utf8],
  ["''", "", utf8],
  ["'\\u00fctf8'", "\u00fctf8", utf8],
  ["'\\u{1F600}'", "\u{1F600}", utf8],
  ["a name of 300 characters", Buffer.alloc(300, "x").toString(), utf8],
  // Only a primitive string names an encoding.
  ["new String('hex')", new String("hex"), utf8],
  ["new String('bogus')", new String("bogus"), utf8],
  ["{ toString: () => 'hex' }", { toString: () => "hex" }, utf8],
  ["['hex']", ["hex"], utf8],
  // A known name is still matched, in any case and from a 16-bit string.
  ["'HeX'", "HeX", [0xab]],
  ["'hex' decoded from UTF-16", Buffer.from("hex", "utf16le").toString("utf16le"), [0xab]],
  ["'utf-16le'", "utf-16le", utf16le],
  ["'UTF-16LE'", "UTF-16LE", utf16le],
];
// The async forms share the argument parser with writeSync, so they get fewer rows.
const unknown: [label: string, encoding: unknown][] = [
  ["'bogus'", "bogus"],
  ["'hexx'", "hexx"],
  ["new String('hex')", new String("hex")],
];

// Calls `call` with a fresh fd for `file`.
async function onFd<T>(flags: string, call: (fd: number) => T | Promise<T>) {
  const fd = fs.openSync(file, flags);
  try {
    return await call(fd);
  } finally {
    fs.closeSync(fd);
  }
}

describe("fs.writeSync(fd, string, position, encoding)", () => {
  for (const [label, encoding, bytes] of encodings) {
    test(`encoding ${label}`, async () => {
      // Bun 1.3.14 wrote UTF-8 for null and undefined. Bun 1.4.0 threw for all three.
      for (const position of [0, null, undefined]) {
        const written = await onFd("w", fd => (fs.writeSync as Function)(fd, data, position, encoding));
        assert.deepStrictEqual(
          { position, written, bytes: [...fs.readFileSync(file)] },
          { position, written: bytes.length, bytes },
        );
      }
    });
  }

  test("an empty string writes nothing", async () => {
    assert.strictEqual(await onFd("w", fd => (fs.writeSync as Function)(fd, "", null, "bogus")), 0);
    assert.deepStrictEqual([...fs.readFileSync(file)], []);
  });

  test("a write that fails throws the error of the write", async () => {
    fs.writeFileSync(file, "....");
    await onFd("r", fd => {
      assert.throws(() => (fs.writeSync as Function)(fd, "ab", null, "bogus"), { code: "EBADF", syscall: "write" });
    });
    assert.strictEqual(fs.readFileSync(file, "latin1"), "....");
  });
});

describe("fs.write(fd, string, position, encoding, callback)", () => {
  // Resolves with the arguments of the callback, and with whether fs.write() had returned by then.
  function write(fd: number, ...args: unknown[]) {
    const { promise, resolve } = Promise.withResolvers<unknown[]>();
    let returned = false;
    (fs.write as Function)(fd, ...args, (err: any, ...rest: unknown[]) =>
      resolve([err?.code ?? err, ...rest, { afterReturn: returned }]),
    );
    returned = true;
    return promise;
  }

  for (const [label, encoding] of unknown) {
    for (const position of [null, 0]) {
      test(`encoding ${label}, position ${position}`, async () => {
        assert.deepStrictEqual(await onFd("w", fd => write(fd, data, position, encoding)), [
          null,
          utf8.length,
          data,
          { afterReturn: true },
        ]);
        assert.deepStrictEqual([...fs.readFileSync(file)], utf8);
      });
    }
  }

  test("an empty string writes nothing", async () => {
    assert.deepStrictEqual(await onFd("w", fd => write(fd, "", null, "bogus")), [null, 0, "", { afterReturn: true }]);
    assert.deepStrictEqual([...fs.readFileSync(file)], []);
  });

  test("a write that fails gives the error of the write to the callback", async () => {
    fs.writeFileSync(file, "....");
    assert.deepStrictEqual(await onFd("r", fd => write(fd, "ab", null, "bogus")), [
      "EBADF",
      0,
      "ab",
      { afterReturn: true },
    ]);
    assert.strictEqual(fs.readFileSync(file, "latin1"), "....");
  });
});

// `write` makes one string write on a fresh fd for `file` and resolves with `{ bytesWritten, buffer }`.
function promiseForm(name: string, write: (flags: string, ...args: unknown[]) => Promise<object>) {
  describe(name, () => {
    for (const [label, encoding] of unknown) {
      for (const position of [null, 0]) {
        test(`encoding ${label}, position ${position}`, async () => {
          // Node's FileHandle result has a null prototype. The copy compares the properties only.
          assert.deepStrictEqual(
            { ...(await write("w", data, position, encoding)) },
            { bytesWritten: utf8.length, buffer: data },
          );
          assert.deepStrictEqual([...fs.readFileSync(file)], utf8);
        });
      }
    }

    test("an empty string writes nothing", async () => {
      assert.deepStrictEqual({ ...(await write("w", "", null, "bogus")) }, { bytesWritten: 0, buffer: "" });
      assert.deepStrictEqual([...fs.readFileSync(file)], []);
    });

    test("a write that fails rejects with the error of the write", async () => {
      fs.writeFileSync(file, "....");
      await assert.rejects(write("r", "ab", null, "bogus"), { code: "EBADF", syscall: "write" });
      assert.strictEqual(fs.readFileSync(file, "latin1"), "....");
    });
  });
}

promiseForm("util.promisify(fs.write)(fd, string, position, encoding)", (flags, ...args) =>
  onFd(flags, fd => (promisify(fs.write) as Function)(fd, ...args)),
);

promiseForm("filehandle.write(string, position, encoding)", async (flags, ...args) => {
  const handle = await fs.promises.open(file, flags);
  try {
    return await (handle.write as Function)(...args);
  } finally {
    await handle.close();
  }
});

// Node.js has no fs.promises.write. Bun's reaches the argument parser with no check in JS before it.
if (typeof (fs.promises as any).write === "function") {
  promiseForm("fs.promises.write(fd, string, position, encoding)", (flags, ...args) =>
    onFd(flags, async fd => ({ bytesWritten: await (fs.promises as any).write(fd, ...args), buffer: args[0] })),
  );
}
