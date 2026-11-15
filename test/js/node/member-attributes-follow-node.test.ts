/**
 * Members that Node.js leaves configurable, on classes and handles that Bun implements natively: net.BlockList,
 * module.SourceMap, string_decoder.StringDecoder, the handles of a zlib stream and of fs.watchFile(), the TTY of
 * process.binding("tty_wrap"), net.Server#listening and net.Socket#pending.
 *
 * An attribute is three letters: `c` configurable, `e` enumerable, then `w` writable, `-` read-only or `a` for an
 * accessor. Each row is what Node.js v26.12.1 prints, and v26.3.0 too. This file uses node:test and node:assert, and
 * its last test runs it under Node.js, which holds the rows to Node.js itself.
 *
 * Node.js writes the classes in JavaScript and defines the functions of a handle with SetProtoMethod:
 * https://github.com/nodejs/node/blob/v26.12.1/lib/internal/blocklist.js#L67
 * https://github.com/nodejs/node/blob/v26.12.1/lib/internal/source_map/source_map.js#L126
 * https://github.com/nodejs/node/blob/v26.12.1/lib/string_decoder.js#L116-L144
 * https://github.com/nodejs/node/blob/v26.12.1/src/node_zlib.cc#L2067-L2073
 * https://github.com/nodejs/node/blob/v26.12.1/src/handle_wrap.cc#L171-L174
 * https://github.com/nodejs/node/blob/v26.12.1/src/tty_wrap.cc#L68-L81
 * https://github.com/nodejs/node/blob/v26.12.1/lib/internal/bootstrap/realm.js#L169-L177 (internalBinding keeps one object for a name)
 * https://github.com/nodejs/node/blob/v26.12.1/lib/net.js#L1018-L1024 (pending) and #L2734-L2741 (listening)
 */
import assert from "node:assert";
import fs from "node:fs";
import module from "node:module";
import net from "node:net";
import { StringDecoder } from "node:string_decoder";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import sinon from "sinon";

type Attributes = Record<string, string>;

function attributesOf(descriptor: PropertyDescriptor): string {
  const last = "value" in descriptor ? (descriptor.writable ? "w" : "-") : "a";
  return (descriptor.configurable ? "c" : "-") + (descriptor.enumerable ? "e" : "-") + last;
}

/** The object that has `name` as its own property, from `object` upwards. */
function holderOf(object: object, name: string): object {
  for (let holder: object | null = object; holder !== null; holder = Object.getPrototypeOf(holder))
    if (Object.hasOwn(holder, name)) return holder;
  throw new Error(`nothing has ${name}`);
}

function handleOf(stream: zlib.Deflate | zlib.BrotliCompress | zlib.ZstdCompress): object {
  const handle = (stream as any)._handle;
  stream.close();
  return handle;
}

function statWatcherHandle(): object {
  const file = fileURLToPath(import.meta.url);
  const watcher = fs.watchFile(file, () => {});
  const handle = (watcher as any)._handle;
  fs.unwatchFile(file);
  return handle;
}

const sourceMap = () => new module.SourceMap({ version: 3, sources: ["a.js"], names: [], mappings: "AAAA" } as any);
const ttyWrap = () => (process as any).binding("tty_wrap");
const zlibHandle: Attributes = {
  close: "cew",
  init: "cew",
  params: "cew",
  reset: "cew",
  write: "cew",
  writeSync: "cew",
};

/** Each member is on the first object that has it, from what `make` returns upwards: the same object at each `make`. */
const rows: Record<string, { make: () => object; node: Attributes }> = {
  "a net.BlockList": {
    make: () => new net.BlockList(),
    node: { addAddress: "c-w", addRange: "c-w", addSubnet: "c-w", check: "c-w", rules: "c-a" },
  },
  "net.BlockList": { make: () => net.BlockList, node: { isBlockList: "c-w" } },
  "a module.SourceMap": {
    make: sourceMap,
    node: { findEntry: "c-w", findOrigin: "c-w", lineLengths: "c-a", payload: "c-a" },
  },
  "a string_decoder.StringDecoder": {
    make: () => new StringDecoder(),
    node: { lastChar: "cea", lastNeed: "cea", lastTotal: "cea" },
  },
  "the handle of zlib.createDeflate()": { make: () => handleOf(zlib.createDeflate()), node: zlibHandle },
  "the handle of zlib.createBrotliCompress()": { make: () => handleOf(zlib.createBrotliCompress()), node: zlibHandle },
  "the handle of zlib.createZstdCompress()": { make: () => handleOf(zlib.createZstdCompress()), node: zlibHandle },
  "the handle of fs.watchFile()": { make: statWatcherHandle, node: { close: "cew", ref: "cew", unref: "cew" } },
  'process.binding("tty_wrap")': { make: ttyWrap, node: { TTY: "cew" } },
  'the prototype of the TTY of process.binding("tty_wrap")': {
    make: () => ttyWrap().TTY.prototype,
    node: { getWindowSize: "cew", setRawMode: "cew" },
  },
  "a net.Server": { make: () => new net.Server(), node: { listening: "cea" } },
  "a net.Socket": { make: () => new net.Socket(), node: { pending: "c-a" } },
};

describe("a member has the attributes that Node.js gives it", () => {
  for (const [name, { make, node }] of Object.entries(rows)) {
    test(name, () => {
      const made = make();
      const again = make();
      const attributes: Attributes = {};
      for (const member of Object.keys(node)) {
        const holder = holderOf(made, member);
        // A member of an object that is built anew for each reader is redefined for nobody.
        assert.strictEqual(holderOf(again, member), holder, `${member} is on one object`);
        attributes[member] = attributesOf(Object.getOwnPropertyDescriptor(holder, member)!);
      }
      assert.deepStrictEqual(attributes, node);
    });
  }
});

describe("a member is redefined, deleted and put back", () => {
  // One of each kind: a function and an accessor of a class, a function of its constructor, a function of a handle.
  const members: [string, string][] = [
    ["a net.BlockList", "check"],
    ["a net.BlockList", "rules"],
    ["net.BlockList", "isBlockList"],
    ["the handle of zlib.createDeflate()", "write"],
    ["a string_decoder.StringDecoder", "lastNeed"],
    ["a net.Socket", "pending"],
  ];
  for (const [name, member] of members) {
    test(`${member} of ${name}`, () => {
      const made = rows[name].make();
      const holder = holderOf(made, member);
      const original = Object.getOwnPropertyDescriptor(holder, member)!;
      try {
        Object.defineProperty(holder, member, { value: "redefined", writable: true, configurable: true });
        assert.strictEqual((made as any)[member], "redefined");
        Object.defineProperty(holder, member, original);
        assert.strictEqual(delete (holder as any)[member], true);
        assert.strictEqual(Object.hasOwn(holder, member), false);
      } finally {
        Object.defineProperty(holder, member, original);
      }
      assert.deepStrictEqual(Object.getOwnPropertyDescriptor(holder, member), original);
    });
  }
});

describe("a stand-in for an accessor is taken away again", () => {
  // mock.getter() defines the getter on the object with the attributes of the accessor that the object inherits, and
  // restoreAll() defines that accessor over it. Neither works on an accessor that is not configurable.
  const accessors: [string, string][] = [
    ["a net.BlockList", "rules"],
    ["a module.SourceMap", "payload"],
    ["a module.SourceMap", "lineLengths"],
    ["a string_decoder.StringDecoder", "lastNeed"],
  ];
  for (const [name, member] of accessors) {
    test(`mock.getter() of node:test on ${member} of ${name}, then restoreAll()`, t => {
      const object: any = rows[name].make();
      const real = object[member];
      t.mock.getter(object, member, () => "mocked");
      assert.strictEqual(object[member], "mocked");
      t.mock.restoreAll();
      assert.deepStrictEqual(object[member], real);
    });
  }

  test("a getter stub of sinon on listening of a net.Server, then restore()", () => {
    const server = new net.Server();
    const stub = sinon.stub(server, "listening").get(() => "stubbed");
    try {
      assert.strictEqual(server.listening, "stubbed");
    } finally {
      stub.restore();
    }
    assert.strictEqual(server.listening, false);
  });
});

test('a TTY that is stored to process.binding("tty_wrap") is there at the next call', () => {
  const binding = ttyWrap();
  const { TTY } = binding;
  const standIn = function TTY() {};
  binding.TTY = standIn;
  try {
    assert.strictEqual(ttyWrap().TTY, standIn);
  } finally {
    binding.TTY = TTY;
  }
});

// Only in Bun: Node.js has no Bun.gc(), and when it runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  test('what is stored to process.binding("tty_wrap") outlives a collection', () => {
    // Stored in a call of its own: afterwards nothing but the binding holds the object.
    (() => {
      ttyWrap().standIn = { kept: true };
    })();
    Bun.gc(true);
    try {
      assert.deepStrictEqual(ttyWrap().standIn, { kept: true });
    } finally {
      delete ttyWrap().standIn;
    }
  });

  const { bunEnv, nodeExeAtLeast } = await import("harness");
  const node = nodeExeAtLeast("26.3.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node process per file. node:test still exits
      // non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--no-deprecation", fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
