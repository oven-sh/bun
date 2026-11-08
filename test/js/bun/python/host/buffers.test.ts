// Bytes: typed arrays, ArrayBuffer, DataView and Buffer in Python; bytes, bytearray and memoryview in JavaScript.
import { isWindows } from "harness";
import { program } from "./helpers";

const group = program();

group(
  "the buffers of JavaScript in Python",
  {
    setup: `
import js, struct, hashlib, zlib, base64, io, binascii
from node.buffer import Buffer
def u8(*items): return js.Uint8Array(list(items))
`,
  },
  [
    [
      "u = u8(1, 2, 3, 4)\ntype(u).__name__, len(u), u[0], u[3], list(u), [x for x in u], bytes(u), bytearray(u)",
      "('JSTypedArray', 4, 1, 4, [1, 2, 3, 4], [1, 2, 3, 4], b'\\x01\\x02\\x03\\x04', bytearray(b'\\x01\\x02\\x03\\x04'))",
    ],
    // The memory is shared, not copied.
    [
      "u = u8(1, 2, 3, 4)\nm = memoryview(u)\nm[0] = 9\nu[1] = 8\nm.nbytes, m.format, m.readonly, u[0], m[1], bytes(m[1:3]), m.tolist()",
      "(4, 'B', False, 9, 8, b'\\x08\\x03', [9, 8, 3, 4])",
    ],
    [
      "u = u8(1, 2, 3, 4)\nstruct.unpack_from('<HH', u), struct.pack_into('<H', u, 2, 0x0102), list(u)",
      "((513, 1027), None, [1, 2, 2, 1])",
    ],
    [
      "u = u8(1, 2)\nb'x' + u, bytes(u) + b'x', b''.join([u, u]), bytearray(b'a') + u, int.from_bytes(u, 'big'), bytes(u).hex()",
      "(b'x\\x01\\x02', b'\\x01\\x02x', b'\\x01\\x02\\x01\\x02', bytearray(b'a\\x01\\x02'), 258, '0102')",
    ],
    [
      "u = js.TextEncoder().encode('abc')\nhashlib.sha1(u).hexdigest()[:8], zlib.crc32(u), base64.b64encode(u), io.BytesIO(u).read(), binascii.hexlify(u), str(u, 'ascii')",
      "('a9993e36', 891568578, b'YWJj', b'abc', b'616263', 'abc')",
    ],
    [
      "a = js.ArrayBuffer(8)\nd = js.DataView(a)\nd.setUint16(0, 0x0102)\na.byteLength, bytes(a)[:3], bytes(d)[:2], memoryview(a).nbytes, d.getUint8(1)",
      "(8, b'\\x01\\x02\\x00', b'\\x01\\x02', 8, 2)",
    ],
    [
      "f = js.Float64Array([1.5, 2.0])\nlist(f), memoryview(f).format, memoryview(f).tolist(), len(f), len(bytes(f)), struct.unpack('<2d', f)",
      "([1.5, 2], 'd', [1.5, 2.0], 2, 16, (1.5, 2.0))",
    ],
    [
      "i = js.Int32Array([-1, 2])\nmemoryview(i).format, memoryview(i).tolist(), memoryview(i).itemsize, [memoryview(js.eval('new ' + n + '(1)')).format for n in ('Int8Array', 'Uint16Array', 'Uint32Array', 'Float32Array', 'BigInt64Array', 'BigUint64Array', 'Uint8ClampedArray')]",
      "('i', [-1, 2], 4, ['b', 'H', 'I', 'f', 'q', 'Q', 'B'])",
    ],
    [
      "u = u8(1, 2, 3, 4)\ns = u.subarray(1, 3)\ns[0] = 9\nlist(u), list(u.slice(1, 3)), u.buffer is u.buffer, u.byteOffset, s.byteOffset",
      "([1, 9, 3, 4], [9, 3], True, 0, 1)",
    ],
    [
      "b = Buffer.alloc(4)\nb.writeUInt32BE(0xdeadbeef, 0), bytes(b), b.readUInt16LE(0), b.toString('hex'), b.toString('base64'), b.subarray(1, 3).toString('hex'), Buffer.isBuffer(b)",
      "(4, b'\\xde\\xad\\xbe\\xef', 44510, 'deadbeef', '3q2+7w==', 'adbe', True)",
    ],
    [
      "getattr(Buffer, 'from')('héllo', 'utf8').length, bytes(getattr(Buffer, 'from')('héllo')), getattr(Buffer, 'from')('6162', 'hex').toString(), getattr(Buffer, 'from')([97, 98]).toString()",
      "(6, b'h\\xc3\\xa9llo', 'ab', 'ab')",
    ],
    ["u8(1, 2).toHex(), bytes(js.Uint8Array.fromHex('0102')), u8(1, 2).toBase64()", "('0102', b'\\x01\\x02', 'AQI=')"],
    [
      "isinstance(u8(1), (bytes, bytearray)), repr(u8(1)).split(' at ')[0], str(u8(1, 2))",
      "(False, '<JavaScript Uint8Array', '1,2')",
    ],
    // Typed arrays are sequences of a fixed length.
    ["u8(1, 2, 3)[-1]", "3"],
    ["bytes(u8(1, 2, 3)[1:])", "b'\\x02\\x03'"],
    ["9 in u8(9, 8), 1 in u8(9, 8)", "(True, False)"],
    [
      "u8(1, 2) == b'\\x01\\x02', b'\\x01\\x02' == u8(1, 2), memoryview(u8(1, 2)) == b'\\x01\\x02'",
      "(True, True, True)",
    ],
    ["list(reversed(u8(1, 2)))", "[2, 1]"],
    [
      "import _js\nu = u8(1, 2, 3, 4)\nisinstance(u, _js.JSTypedArray), isinstance(u, _js.JSObject), isinstance(u.buffer, _js.JSTypedArray), isinstance(js.DataView(u.buffer), _js.JSTypedArray)",
      "(True, True, False, False)",
    ],
    [
      "u = u8(1, 2, 3, 4)\nlist(u[::-1]), list(u[::2]), list(u[3:1:-1]), list(u[5:]), list(u[-2:]), type(u[1:]).__name__",
      "([4, 3, 2, 1], [1, 3], [4, 3], [], [3, 4], 'JSTypedArray')",
    ],
    // A slice is a copy, as of a bytearray. subarray() shares.
    ["u = u8(1, 2, 3)\ns = u[1:]\ns[0] = 9\nlist(u), list(s)", "([1, 2, 3], [9, 3])"],
    [
      "b = getattr(Buffer, 'from')('hello')\nb[1:3].toString(), Buffer.isBuffer(b[1:3]), b[::2].toString(), Buffer.isBuffer(b[::2])",
      "('el', True, 'hlo', True)",
    ],
    [
      "f = js.Float64Array([1.5, 2.5, 3.5])\nlist(f[1:]), list(f[::-1]), 3.5 in f, f.index(2.5), memoryview(f[::2]).format",
      "([2.5, 3.5], [3.5, 2.5, 1.5], True, 1, 'd')",
    ],
    ["u = u8(1, 2, 3, 4)\nu[-1] = 9\nu[0:2] = b'ab'\nu[2:3] = [7]\nlist(u)", "[97, 98, 7, 9]"],
    ["u = u8(1, 2, 3, 4)\nu[1:] = u[:-1]\nv = u8(1, 2, 3)\nv[::-1] = v\nlist(u), list(v)", "([1, 1, 2, 3], [3, 2, 1])"],
    ["u = u8(1, 2, 1)\nu.index(2), u.index(1, 1), u.count(1), u.count(5)", "(1, 2, 2, 0)"],
    ["u8(1, 2)[2]", "!IndexError: typed array index out of range"],
    ["u8(1, 2)[-3]", "!IndexError: typed array index out of range"],
    ["u = u8(1, 2)\nu[2] = 0\n0", "!IndexError: typed array index out of range"],
    [
      "u = u8(1, 2)\nu[0:1] = b'ab'\n0",
      "!ValueError: a typed array cannot be resized: attempt to assign a sequence of size 2 to a slice of size 1",
    ],
    ["u = u8(1, 2)\ndel u[0]\n0", "!TypeError: a typed array cannot be resized: its items cannot be deleted"],
    ["u8(1).index(5)", "!ValueError: the value is not in the typed array"],
    // What is neither an index nor a slice names a property, as for any object of JavaScript.
    ["u = u8(1, 2)\nu.tag = 't'\nu['length'], u['tag'], 'tag' in dir(u)", "(2, 't', True)"],
    // Equal as the views of them are: the same items, whatever holds them. What can change and is equal by its items has no hash.
    [
      "import array\nu8(1, 2) == u8(1, 2), u8(1, 2) != u8(1, 3), u8(1, 2) == bytearray(b'\\x01\\x02'), u8(1, 2) == array.array('B', [1, 2]), js.Int16Array([1, 2]) == u8(1, 2), u8(1) == [1], u8(1) == 1",
      "(True, True, True, True, True, False, False)",
    ],
    ["hash(u8(1))", "!TypeError: unhashable type: '_js.JSTypedArray'"],
    [
      "q = js.BigInt64Array(2)\nq[0] = 5\nq[1:] = [-(2**40)]\nlist(q), q[-1], 5 in q",
      "([5, -1099511627776], -1099511627776, True)",
    ],
    [
      "import gzip\ngzip.decompress(js.Bun.gzipSync(b'hello')), bytes(js.Bun.gunzipSync(gzip.compress(b'there')))",
      "(b'hello', b'there')",
    ],
  ],
);

group(
  "the bytes of Python in JavaScript",
  {
    setup: `
import js
from node.buffer import Buffer
look = js.eval("x => [x.length, x[0], [...x], Object.prototype.toString.call(x)]")
`,
  },
  [
    [
      "look(b'ab'), look(bytearray(b'ab')), look(memoryview(b'ab'))",
      "([2, 97, [97, 98], '[object bytes]'], [2, 97, [97, 98], '[object bytearray]'], [2, 97, [97, 98], '[object memoryview]'])",
    ],
    [
      "list(js.Uint8Array(b'ab')), list(js.Uint8Array(bytearray(b'ab'))), list(js.Uint8Array(memoryview(b'ab'))), list(getattr(js.Uint8Array, 'from')(b'ab'))",
      "([97, 98], [97, 98], [97, 98], [97, 98])",
    ],
    [
      "getattr(Buffer, 'from')(b'ab').toString(), getattr(Buffer, 'from')(bytearray(b'ab')).toString('hex')",
      "('ab', '6162')",
    ],
    ["ba = bytearray(b'abcd')\njs.eval('x => { x[0] = 65; return x[0]; }')(ba), ba", "(65, bytearray(b'Abcd'))"],
    [
      "js.eval('x => { \"use strict\"; x[0] = 65; }')(b'abcd')",
      "!TypeError: 'bytes' object does not support item assignment",
    ],
    ["js.JSON.stringify(b'ab'), js.eval('x => String(x)')(b'ab')", `('[97,98]', "b'ab'")`],
    // To code written in JavaScript they are no typed arrays. js.Uint8Array(data) makes a copy that is.
    ["js.eval('x => [x instanceof Uint8Array, ArrayBuffer.isView(x)]')(b'ab')", "[False, False]"],
    ["js.TextDecoder().decode(js.Uint8Array(b'h\\xc3\\xa9'))", "'hé'"],
    // What Bun itself implements takes them wherever it takes a typed array.
    [
      "js.TextDecoder().decode(b'h\\xc3\\xa9'), js.TextDecoder().decode(bytearray(b'h\\xc3\\xa9')), js.TextDecoder().decode(memoryview(b'h\\xc3\\xa9'))",
      "('hé', 'hé', 'hé')",
    ],
    ["Buffer.concat([b'a', bytearray(b'b')]).toString()", "'ab'"],
    [
      "getattr(Buffer, 'from')('ab').equals(b'ab'), getattr(Buffer, 'from')('ab').indexOf(b'b'), Buffer.byteLength(b'abc')",
      "(True, 1, 3)",
    ],
    ["a = bytearray(4)\njs.crypto.getRandomValues(a)\nlen(a)", "4"],
    // Also where anything is taken and made a string of.
    ["js.Blob([b'ab', 'cd']).size", "4"],
    ["js.Bun.hash.crc32(b'abc') == js.Bun.hash.crc32('abc')", "True"],
  ],
);

group(
  "bytes in requests, responses and files",
  {
    setup: `
import js, os, tempfile
from node import fs
directory = tempfile.mkdtemp()
path = os.path.join(directory, "file")
def read():
    with open(path, "rb") as f: return f.read()
`,
    teardown: `
import shutil
shutil.rmtree(directory)
`,
  },
  [
    [
      "bytes(await js.Response(js.Uint8Array(b'\\x00\\xff')).bytes()), bytes(await js.Response('é').arrayBuffer())",
      "(b'\\x00\\xff', b'\\xc3\\xa9')",
    ],
    ["bytes(await js.Response(b'\\x00\\xff').bytes())", "b'\\x00\\xff'"],
    ["bytes(await js.Response(bytearray(b'\\x00\\xff')).bytes())", "b'\\x00\\xff'"],
    ["bytes(await js.Request('http://a.example', method='POST', body=b'\\x00\\xff').bytes())", "b'\\x00\\xff'"],
    ["await js.Bun.write(path, js.Uint8Array(b'\\x00\\xff')), read()", "(2, b'\\x00\\xff')"],
    ["await js.Bun.write(path, b'\\x00\\xff'), read()", "(2, b'\\x00\\xff')"],
    [
      "fs.writeFileSync(path, js.Uint8Array(b'\\x01\\xfe')), read(), bytes(fs.readFileSync(path))",
      "(None, b'\\x01\\xfe', b'\\x01\\xfe')",
    ],
    ["fs.writeFileSync(path, b'\\x00\\xff'), read()", "(None, b'\\x00\\xff')"],
    [
      "fs.writeFileSync(path, 'abcd')\nfd = fs.openSync(path, 'r')\nu = js.Uint8Array(4)\nn = fs.readSync(fd, u, 0, 4, 0)\nfs.closeSync(fd)\nn, bytes(u)",
      "(4, b'abcd')",
    ],
    [
      "fd = fs.openSync(path, 'r')\nb = bytearray(4)\ntry:\n    n = fs.readSync(fd, b, 0, 4, 0)\nfinally:\n    fs.closeSync(fd)\nn, b",
      "(4, bytearray(b'abcd'))",
    ],
    ["bytes(await js.Blob([js.Uint8Array(b'ab'), 'cd']).bytes()), await js.Blob(['ab']).text()", "(b'abcd', 'ab')"],
  ],
);

group(
  "memory that Python lends",
  {
    setup: `
import array, asyncio, mmap
from _js import JSError
from node import crypto
directory = tempfile.mkdtemp()
path = os.path.join(directory, "file")
crc = js.Bun.hash.crc32
want = crc("abc")
class Exporter:
    def __buffer__(self, flags): return memoryview(bytearray(b"abc"))
def callback():
    future = asyncio.get_running_loop().create_future()
    return future, lambda *results: future.set_result(results)
`,
    teardown: `
shutil.rmtree(directory)
`,
  },
  [
    // Whatever has the buffer protocol.
    [
      "[crc(x) == want for x in (array.array('B', b'abc'), memoryview(b'xabcx')[1:4], memoryview(js.Uint8Array([97, 98, 99])), Exporter())]",
      "[True, True, True, True]",
    ],
    // Of memory of JS that can be made longer or shorter.
    [
      "[crc(memoryview(js.Uint8Array(memory(3, maxByteLength=4)).fill(0x61))) == crc('aaa') for memory in (js.ArrayBuffer, js.SharedArrayBuffer)]",
      "[True, True]",
    ],
    [
      "fs.writeFileSync(path, 'abc')\nwith open(path, 'r+b') as f:\n    with mmap.mmap(f.fileno(), 0) as m:\n        same = crc(m) == want\nsame",
      "True",
    ],
    ["crc(array.array('H', [0x6261, 0x63])) == crc('abc\\0')", "True"],
    // A call that has returned holds nothing.
    [
      "b = bytearray(b'abc')\ncrc(b), js.TextDecoder().decode(b), js.Blob([b]).size\nb.append(100)\nb",
      "bytearray(b'abcd')",
    ],
    // What is kept is a copy.
    [
      "b = bytearray(b'abc')\nr, blob = js.Response(b), js.Blob([b])\nb[0] = 120\nb.clear()\nawait r.text(), await blob.text()",
      "('abc', 'abc')",
    ],
    // Memory that cannot be had: what Python says of it.
    ["m = memoryview(b'abc')\nm.release()\ncrc(m)", "!ValueError: operation forbidden on released memoryview object"],
    ["js.Response(m)", "!ValueError: operation forbidden on released memoryview object"],
    ["js.Blob([m])", "!ValueError: operation forbidden on released memoryview object"],
    ["crc(memoryview(b'abcd')[::2])", "!BufferError: memoryview: underlying buffer is not C-contiguous"],
    ["js.Response(memoryview(b'abcd')[::2])", "!BufferError: memoryview: underlying buffer is not C-contiguous"],
    // Nothing writes to what cannot be written to.
    [
      "fd = fs.openSync(path, 'r')\ndata = b'....'\ntry:\n    fs.readSync(fd, data, 0, 3, 0)\nexcept JSError as e:\n    refused = True\nfinally:\n    fs.closeSync(fd)\nrefused, data",
      "(True, b'....')",
    ],
    [
      "data = b'....'\nrefused = []\nfor write in (js.crypto.getRandomValues, crypto.randomFillSync, lambda d: js.TextEncoder().encodeInto('x', d), lambda d: js.TextEncoder().encodeInto('x', memoryview(d))):\n    try: write(data)\n    except (JSError, BufferError, TypeError) as e: refused.append(True)\nrefused, data",
      "([True, True, True, True], b'....')",
    ],
    // A part of a bytearray is written where it is.
    [
      "fd = fs.openSync(path, 'r')\nb = bytearray(6)\nn = fs.readSync(fd, memoryview(b)[2:5], 0, 3, 0)\nfs.closeSync(fd)\nn, b",
      "(3, bytearray(b'\\x00\\x00abc\\x00'))",
    ],
    [
      "b = bytearray(4)\nr = js.TextEncoder().encodeInto('hé', b)\nr.read, r.written, b",
      "(2, 3, bytearray(b'h\\xc3\\xa9\\x00'))",
    ],
    ["b = bytearray(4)\ncrypto.randomFillSync(b) is b", "True"],
    // While another thread reads or writes it, a bytearray cannot be resized, as while a memoryview of it exists.
    [
      "b = bytearray(b'x' * 200000)\nfuture, done = callback()\nfs.writeFile(path, b, done)\ntry:\n    b.append(1)\nexcept BufferError as e:\n    during = str(e)\nawait future\nb.append(1)\nduring, len(b), os.path.getsize(path)",
      "('Existing exports of data: object cannot be re-sized', 200001, 200000)",
    ],
    [
      "fs.writeFileSync(path, 'abcd')\nfd = fs.openSync(path, 'r')\nb = bytearray(4)\nfuture, done = callback()\nfs.read(fd, b, 0, 4, 0, done)\ntry:\n    b.clear()\nexcept BufferError as e:\n    during = str(e)\nerror, n, buffer = await future\nfs.closeSync(fd)\nfilled = bytes(b)\nb.clear()\nduring, error, n, buffer is b, filled, b",
      "('Existing exports of data: object cannot be re-sized', None, 4, True, b'abcd', bytearray(b''))",
    ],
    [
      "b = bytearray(4)\nfuture, done = callback()\ncrypto.randomFill(b, done)\nerror, buffer = await future\nb.append(1)\nerror, buffer is b, len(b)",
      "(None, True, 5)",
    ],
    // It is kept alive for as long, too.
    [
      "import gc\nfuture, done = callback()\nfs.writeFile(path, bytearray(b'y' * 200000), done)\ngc.collect()\nawait future\nread() == b'y' * 200000",
      "True",
    ],
  ],
);

group(
  "memory that JavaScript takes away",
  {
    setup: `
import struct
def view(*items):
    u = js.Uint8Array(list(items))
    return u, memoryview(u)
`,
  },
  [
    [
      "u, m = view(1, 2, 3, 4)\njs.structuredClone(u.buffer, transfer=[u.buffer]).byteLength, len(u), len(m)",
      "(4, 0, 4)",
    ],
    ["m[0]", "!BufferError: the ArrayBuffer was detached or shrunk"],
    ["bytes(m)", "!BufferError: the ArrayBuffer was detached or shrunk"],
    ["m[0] = 5\n0", "!BufferError: the ArrayBuffer was detached or shrunk"],
    [
      "u, m = view(1, 2)\nu.buffer.transfer(8).byteLength, m.tolist()",
      "!BufferError: the ArrayBuffer was detached or shrunk",
    ],
    [
      "b = js.ArrayBuffer(8, maxByteLength=16)\nm = memoryview(js.Uint8Array(b))\nb.resize(2)\nbytes(m)",
      "!BufferError: the ArrayBuffer was detached or shrunk",
    ],
    ["b.resize(16)\nbytes(m)", "b'\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"],
    [
      "w = js.WebAssembly.Memory(initial=1, maximum=4)\nm = memoryview(w.buffer)\nlen(m), w.grow(1), len(memoryview(w.buffer))",
      "(65536, 1, 131072)",
    ],
    ["m[0]", "!BufferError: the ArrayBuffer was detached or shrunk"],
    [
      "u = js.Uint8Array(1 << 16)\nclass Detaches:\n    def __index__(self):\n        js.structuredClone(u.buffer, transfer=[u.buffer])\n        return 0\nstruct.pack_into('<I', u, Detaches(), 1), len(u), u[0]",
      "(None, 65536, 1)",
    ],
    [
      "len(bytes(js.SharedArrayBuffer(8))), memoryview(js.Uint8Array(js.SharedArrayBuffer(8))).nbytes, memoryview(js.Uint8Array(0)).tolist(), bytes(js.DataView(js.ArrayBuffer(4), 1, 2))",
      "(8, 8, [], b'\\x00\\x00')",
    ],
    [
      "wasm = bytes([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11])\njs.WebAssembly.validate(js.Uint8Array(wasm)), js.WebAssembly.Instance(js.WebAssembly.Module(js.Uint8Array(wasm))).exports.add(2, 3)",
      "(True, 5)",
    ],
    ["js.WebAssembly.Instance(js.WebAssembly.Module(wasm)).exports.add(2, 3)", "5"],
  ],
);

// The rows from here on are a program of their own, beside the other: they collect again and again, which takes a debug build its time.
const held = program();

// While a function written in C++ uses the memory of a typed array, the memory is pinned: JS gets a copy where it asks for the
// memory itself, and the function goes on where it was.
held(
  "memory that JavaScript would take away in the middle of a call",
  {
    setup: `
import js, struct
import _codecs, codecs, ctypes, io, marshal, pickle, sys, threading, types
def array(size=1 << 16): return js.Uint8Array(size).fill(0x11)
class Takes:
    "Asked for a number or for its truth, it has JS move the memory away and drop it, and make other things where it was."
    def __init__(self, u, value=0): self.u, self.value, self.moved = u, value, None
    def __call__(self, *ignored):
        if self.moved is None:
            self.moved = self.u.buffer.transfer().byteLength
            js.Bun.gc(True)
            self.later = [js.Uint8Array(1 << 16).fill(0x5a) for _ in range(50)]
    def __index__(self): self(); return self.value
    def __bool__(self): self(); return True
    # How long the array is now, how much JS got, and how many of the later arrays are no longer as they were made.
    def state(self): return len(self.u), self.moved, sum(bytes(a) != bytes([0x5a]) * (1 << 16) for a in self.later)
`,
  },
  [
    [
      "u = array()\nt = Takes(u, 0xee)\nstruct.pack_into('<B', u, 0, t), u[0], t.state()",
      "(None, 238, (65536, 65536, 0))",
    ],
    [
      "u = array()\nt = Takes(u, 4)\nstruct.pack_into('<B', u, t, 0xee), u[4], t.state()",
      "(None, 238, (65536, 65536, 0))",
    ],
    [
      "u = array()\nt = Takes(u)\nset(_codecs.utf_8_decode(u, 'strict', t)[0]), t.state()",
      "({'\\x11'}, (65536, 65536, 0))",
    ],
    [
      "u = array()\nu[0] = 0xff\nt = Takes(u)\ncodecs.register_error('takes', lambda e: (t(), ('?', e.end))[1])\nsorted(set(str(u, 'ascii', 'takes'))), t.state()",
      "(['\\x11', '?'], (65536, 65536, 0))",
    ],
    [
      "u = array()\nt = Takes(u)\nsys.modules['takes'] = types.SimpleNamespace(take=t)\npayload = b'ctakes\\ntake\\n)R0B' + struct.pack('<I', 100) + bytes([0x11]) * 100 + b'.'\nmemoryview(u)[:len(payload)] = payload\nset(pickle.loads(u)), t.state()",
      "({17}, (65536, 65536, 0))",
    ],
    [
      "u = array()\nt = Takes(u)\nsearch = lambda name: (t(), codecs.lookup('latin-1'))[1] if name == 'takes' else None\ncodecs.register(search)\ntry: text = str(u, 'takes')\nfinally: codecs.unregister(search)\nset(text), t.state()",
      "({'\\x11'}, (65536, 65536, 0))",
    ],
    [
      "u = array()\nu[0] = 0xff\nt = Takes(u)\nclass Chunks(io.BufferedIOBase):\n    chunks = [u]\n    def readable(self): return True\n    def read1(self, size=-1): return self.chunks.pop() if self.chunks else b''\n    read = read1\ncodecs.register_error('takes too', lambda e: (t(), ('?', e.end))[1])\nsorted(set(io.TextIOWrapper(Chunks(), encoding='ascii', errors='takes too').read())), t.state()",
      "(['\\x11', '?'], (65536, 65536, 0))",
    ],
    ["u = array()\nt = Takes(u)\nmarshal.loads(u, allow_code=t)", "!ValueError: bad marshal data (unknown type code)"],
    ["t.state()", "(65536, 65536, 0)"],
    // One format is not native, so the module struct unpacks each item, and that is code like any other.
    [
      "u = array()\nt = Takes(u)\nother = (ctypes.c_int32.__ctype_be__ * (1 << 14))(*([0x11111111] * (1 << 14)))\nclass Struct:\n    def __init__(self, format): self.unpack = struct.Struct(format).unpack_from\n    def unpack_from(self, buffer): t(); return self.unpack(buffer)\nsys.modules['struct'] = types.SimpleNamespace(Struct=Struct)\ntry: equal = memoryview(u).cast('i') == memoryview(other)\nfinally: sys.modules['struct'] = struct\nequal, t.state()",
      "(True, (65536, 65536, 0))",
    ],
    [
      "b = js.ArrayBuffer(1 << 16, maxByteLength=1 << 17)\nu = js.Uint8Array(b)\nsaid = []\nclass Shrinks:\n    def __index__(self):\n        try: b.resize(16)\n        except Exception as e: said.append(str(e)[:10])\n        return 0xee\nstruct.pack_into('<B', u, 1 << 15, Shrinks()), u[1 << 15], said, b.byteLength",
      "(None, 238, ['RangeError'], 65536)",
    ],
    // An array of up to 1000 items has its memory in the heap of JS until it is given an ArrayBuffer, and then the memory moves.
    ["u = array(16)\nt = Takes(u, 0xee)\nstruct.pack_into('<B', u, 0, t), u[0], t.state()", "(None, 238, (16, 16, 0))"],
    [
      "u = array(1000)\nt = Takes(u)\nset(_codecs.utf_8_decode(u, 'strict', t)[0]), t.state()",
      "({'\\x11'}, (1000, 1000, 0))",
    ],
    // That is before anybody is told where the memory is: an address that ctypes keeps stays good when Python looks again.
    ...(
      [
        ["Uint8Array", 16],
        ["Uint8Array", 1000],
        ["Uint8Array", 1001],
        ["Uint16Array", 1000],
        ["Float64Array", 1000],
        ["Float64Array", 1001],
      ] as const
    ).map(([type, length]): [string, string] => [
      `u = js.${type}(${length})\na = (ctypes.c_uint8 * u.byteLength).from_buffer(u)\np = ctypes.cast(a, ctypes.POINTER(ctypes.c_uint8))\nbefore = ctypes.addressof(a)\np[0] = 1\nlooked = bytes(u), struct.unpack_from('<B', u), memoryview(u)[0], u == b'x'\np[1] = 2\nbytes(u)[:2], ctypes.addressof(a) == before`,
      "(b'\\x01\\x02', True)",
    ]),
    // No thread is kept out meanwhile: code of the program that the function calls may wait for one. (The thread cannot be through
    // before the wait begins: it needs a turn after go.set().)
    [
      "u = array(16)\nalive = []\nclass Joins:\n    def __index__(self):\n        go = threading.Event()\n        thread = threading.Thread(target=go.wait)\n        thread.start()\n        go.set()\n        thread.join(10)\n        alive.append(thread.is_alive())\n        return 1\nstruct.pack_into('<B', u, 0, Joins()), alive",
      "(None, [False])",
    ],
    // Memory of WebAssembly is not pinned. Between two views no thread is kept out either, while code of the program runs that may wait for one.
    [
      "w = js.WebAssembly.Memory(initial=1)\nu = js.Uint8Array(w.buffer, 0, 16)\nother = (ctypes.c_int32.__ctype_be__ * 4)()\nwaited = []\nclass Struct:\n    def __init__(self, format): self.unpack = struct.Struct(format).unpack_from\n    def unpack_from(self, buffer):\n        if not waited:\n            go, done = threading.Event(), threading.Event()\n            threading.Thread(target=lambda: (go.wait(), done.set())).start()\n            go.set()\n            waited.append(done.wait(10))\n        return self.unpack(buffer)\nsys.modules['struct'] = types.SimpleNamespace(Struct=Struct)\ntry: equal = memoryview(u).cast('i') == memoryview(other)\nfinally: sys.modules['struct'] = struct\nequal, waited",
      "(True, [True])",
    ],
    [
      "w = js.WebAssembly.Memory(initial=1, maximum=4)\nu = js.Uint8Array(w.buffer)\nclass Grows:\n    def __index__(self): w.grow(1); return 1\nstruct.pack_into('<B', u, 0, Grows())",
      "!BufferError: the ArrayBuffer was detached or shrunk",
      "memory of WebAssembly is not held, and pack_into() does not look it up again behind the conversion",
    ],
    // Afterwards it is as free as before.
    ["b.resize(16), b.byteLength", "(None, 16)"],
    ["u = array()\nstruct.pack_into('<B', u, 0, 1), u.buffer.transfer().byteLength, len(u)", "(None, 65536, 0)"],
  ],
);

// An instance that ctypes makes of the memory of a typed array, and what is made of the instance, are addresses. The memory is pinned
// until a collection finds that nothing refers to any of them.
if (!isWindows)
  held(
    "what ctypes makes of memory of JavaScript",
    {
      setup: `
import gc, mmap, os
Bytes = ctypes.c_uint8 * (1 << 16)
libc = ctypes.CDLL(None)
Compare = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_uint8), ctypes.POINTER(ctypes.c_uint8))
# What makes the exports go that only code written in C++ holds: a bytearray of which a view has been dropped is resized.
def resize_another():
    other = bytearray(64)
    view = memoryview(other)
    del view
    other.extend(b"x")
def pointers():
    u = array(); a = Bytes.from_buffer(u); t = Takes(u)
    p, c = ctypes.pointer(a), ctypes.cast(a, ctypes.POINTER(ctypes.c_uint8))
    t()
    p.contents[0] = c[1] = a[2] = 0xee
    return bytes(u)[:4], t.state()
def a_later_argument():
    u = array(); a = Bytes.from_buffer(u); t = Takes(u)
    source = ctypes.create_string_buffer(bytes([0xee]) * (1 << 16), 1 << 16)
    class Parameter:
        @property
        def _as_parameter_(self): t(); return source
    ctypes.memmove(a, Parameter(), 1 << 16)
    return set(bytes(u)), t.state()
def a_callback(size):
    u = js.Uint8Array(size); a = (ctypes.c_uint8 * size).from_buffer(u); t = Takes(u)
    for i in range(size): a[i] = (size - 1 - i) & 0xff
    libc.qsort(a, size, 1, Compare(lambda x, y: (t(), x[0] - y[0])[1]))
    return list(u)[:3], list(u) == sorted(u), t.state()
class Exporter:
    "An object of Python's that hands on memory of JS's."
    def __init__(self, u): self.u = u
    def __buffer__(self, flags): return memoryview(self.u)
def made_on_the_way(how, exporter=lambda u: u):
    u = js.Uint8Array(64); t = Takes(u)
    for i in range(64): u[i] = 63 - i
    class Parameter:
        @property
        def _as_parameter_(self): return (ctypes.c_uint8 * 64).from_buffer(exporter(u))
        @classmethod
        def from_param(cls, value): return (ctypes.c_uint8 * 64).from_buffer(exporter(u))
    qsort = libc["qsort"]
    if how == "from_param": qsort.argtypes = [Parameter, ctypes.c_size_t, ctypes.c_size_t, Compare]
    def compare(x, y):
        if t.moved is None: resize_another(); t()
        return x[0] - y[0]
    qsort(Parameter(), 64, 1, Compare(compare))
    return list(u)[:3], t.state()
def without_the_GIL():
    u = array(); t = Takes(u); made = threading.Event(); r, w = os.pipe()
    class Parameter:
        @property
        def _as_parameter_(self):
            a = Bytes.from_buffer(u)
            made.set()
            return a
    thread = threading.Thread(target=lambda: libc.read(r, Parameter(), 512))
    thread.start()
    made.wait(10)
    resize_another(); t()
    os.write(w, bytes([0xee]) * 512)
    thread.join(10)
    os.close(r); os.close(w)
    return u[0], u[511], u[512], t.state()
def in_the_hands_of_tuple(exporter=lambda u: u):
    arrays = [array() for _ in range(3)]
    def make():
        for u in arrays:
            yield ctypes.pointer(Bytes.from_buffer(exporter(u)))
            resize_another()
    pointers = tuple(make())
    takes = [Takes(u) for u in arrays]
    for t in takes: t()
    for p in pointers: ctypes.memset(p, 0xee, 1 << 16)
    return [t.state() for t in takes]
def brought_back_to_life(exporter=lambda u: u):
    u = array(); saved = []
    class Holder:
        def __del__(self): saved.append(self.pointer)
    holder = Holder(); holder.pointer = ctypes.pointer(Bytes.from_buffer(exporter(u))); holder.cycle = holder
    del holder
    gc.collect()
    t = Takes(u); t()
    saved[0].contents[0] = 0xee
    return u[0], t.state()
def a_length():
    u = array(); a = Bytes.from_buffer(u); t = Takes(u, 1 << 16)
    return set(ctypes.string_at(a, t)), t.state()
def only_a_pointer_is_kept():
    u = array(); p = ctypes.pointer(Bytes.from_buffer(u))
    gc.collect(); js.Bun.gc(True); gc.collect()
    t = Takes(u); t()
    p.contents[0] = 0xee
    return u[0], t.state()
def transferred(u): return u.buffer.transfer().byteLength, len(u)
def nothing_is_kept():
    u = array(); a = Bytes.from_buffer(u); p = ctypes.pointer(a)
    before = transferred(u)
    del a, p
    gc.collect()
    return before, transferred(u)
def of_a_view():
    u = array(); m = memoryview(u); a = Bytes.from_buffer(m)
    m.release()
    before = transferred(u)
    del a
    gc.collect()
    return before, transferred(u)
def of_a_view_that_is_kept():
    u = array(); m = memoryview(u); a = Bytes.from_buffer(m)
    before = transferred(u)
    del a
    gc.collect()
    return before, transferred(u), m.nbytes
def collected_by(collect):
    u = array(); a = Bytes.from_buffer(u)
    del a
    collect()
    return transferred(u)
def a_young_collection():
    # It frees what has not lived through a collection, and one may come at any time.
    return any(collected_by(lambda: gc.collect(0)) == (65536, 0) for _ in range(20))
def released_by_hand():
    u = array(); a = Bytes.from_buffer(u); p = ctypes.pointer(a)
    a._objects['ffffffff'].release()
    gc.collect(); js.Bun.gc(True)
    before = transferred(u)
    p.contents[0] = 0xee
    del a, p
    gc.collect()
    return before, u[0], transferred(u)
def two_of_one_view():
    u = array(); m = memoryview(u); a = Bytes.from_buffer(m); b = Bytes.from_buffer(m)
    m.release()
    del a
    gc.collect()
    before = transferred(u)
    del b
    gc.collect()
    return before, transferred(u)
def that_fails():
    u = array()
    try: Bytes.from_buffer(u, 1)
    except ValueError as error: return str(error)[:21], transferred(u)
def of_an_mmap():
    m = mmap.mmap(-1, 1 << 16); a = Bytes.from_buffer(m)
    try: m.close()
    except BufferError: refused = True
    a[0] = 1
    del a
    gc.collect()
    m.close()
    return refused, m.closed
def again_and_again():
    arrays = [array(64) for _ in range(100)]
    for _ in range(3):
        instances = [(ctypes.c_uint8 * 64).from_buffer(u) for u in arrays for _ in range(3)]
        del instances
        gc.collect()
    return sum(transferred(u) == (64, 0) for u in arrays)
`,
    },
    [
      ["pointers()", "(b'\\xee\\xee\\xee\\x11', (65536, 65536, 0))"],
      ["a_later_argument()", "({238}, (65536, 65536, 0))"],
      ["a_callback(64)", "([0, 1, 2], True, (64, 64, 0))"],
      ["a_callback(1001)", "([0, 0, 0], True, (1001, 1001, 0))"],
      ["a_length()", "({17}, (65536, 65536, 0))"],
      // Nothing but the call holds the instance.
      ["made_on_the_way('_as_parameter_')", "([0, 1, 2], (64, 64, 0))"],
      ["made_on_the_way('from_param')", "([0, 1, 2], (64, 64, 0))"],
      ["without_the_GIL()", "(238, 238, 17, (65536, 65536, 0))"],
      ["in_the_hands_of_tuple()", "[(65536, 65536, 0), (65536, 65536, 0), (65536, 65536, 0)]"],
      ["brought_back_to_life()", "(238, (65536, 65536, 0))"],
      // Such an export has somebody to tell when it is over, and a finalizer of Python's that does so. The pin does not go by that.
      ["made_on_the_way('_as_parameter_', Exporter)", "([0, 1, 2], (64, 64, 0))"],
      ["made_on_the_way('from_param', Exporter)", "([0, 1, 2], (64, 64, 0))"],
      ["in_the_hands_of_tuple(Exporter)", "[(65536, 65536, 0), (65536, 65536, 0), (65536, 65536, 0)]"],
      ["brought_back_to_life(Exporter)", "(238, (65536, 65536, 0))"],
      ["only_a_pointer_is_kept()", "(238, (65536, 65536, 0))"],
      // JS gets a copy, and then the memory itself.
      ["nothing_is_kept()", "((65536, 65536), (65536, 0))"],
      ["of_a_view()", "((65536, 65536), (65536, 0))"],
      // The view of the program's pins nothing.
      ["of_a_view_that_is_kept()", "((65536, 65536), (65536, 0), 65536)"],
      ["again_and_again()", "100"],
      ["collected_by(gc.collect), collected_by(lambda: js.Bun.gc(True))", "((65536, 0), (65536, 0))"],
      ["a_young_collection()", "True"],
      // A pointer made before is still an address.
      ["released_by_hand()", "((65536, 65536), 238, (65536, 0))"],
      ["two_of_one_view()", "((65536, 65536), (65536, 0))"],
      [
        "b = js.ArrayBuffer(64, maxByteLength=128)\na = (ctypes.c_uint8 * 64).from_buffer(js.Uint8Array(b))\nb.resize(16)",
        "!JSRangeError: RangeError: ArrayBuffer resize failed with new byte length 16",
      ],
      ["b.resize(128)\ndel a\ngc.collect()\nb.resize(16), b.byteLength", "(None, 16)"],
      ["that_fails()", "('Buffer size too small', (65536, 0))"],
      ["of_an_mmap()", "(True, True)"],
      [
        "b = js.ArrayBuffer(64)\na = (ctypes.c_uint8 * 64).from_buffer(b)\nd = (ctypes.c_uint8 * 8).from_buffer(js.DataView(b, 8, 8))\nb.transfer().byteLength, b.detached",
        "(64, False)",
      ],
      ["del a\ngc.collect()\nb.transfer().byteLength, b.detached", "(64, False)"],
      ["del d\ngc.collect()\nb.transfer().byteLength, b.detached", "(64, True)"],
      // That cannot be pinned. The instance notices.
      [
        "w = js.WebAssembly.Memory(initial=1, maximum=4)\na = Bytes.from_buffer(js.Uint8Array(w.buffer))\nw.grow(1), a[0]",
        "!BufferError: the ArrayBuffer was detached or shrunk",
      ],
      [
        "u = array()\na = Bytes.from_buffer(u)\nview = a._objects['ffffffff']\ntype(view).__name__, view.obj is u",
        "('memoryview', True)",
      ],
      ["u = array()\na = Bytes.from_buffer_copy(u)\ntransferred(u), a[0]", "((65536, 0), 17)"],
    ],
  );

// A type written in C++ gives its memory without running code of the program, in a view that nothing else has. What a class has as __buffer__ may be any function written in C++.
held(
  "whose __buffer__() it is, and whether to ask for a buffer runs code",
  {
    setup: `
import collections, gc, typing, warnings
from array import array as Array
from node import crypto
def views_of(exporter):
    found = []
    for o in gc.get_objects():
        try:
            if type(o) is memoryview and o.obj is exporter: found.append(o)
        except ValueError: pass
    return found
def a_buffer_method_of_another_type():
    b = bytearray(b"ab"); view = memoryview(b)
    class Gets(dict): __buffer__ = dict.get
    struct.unpack_from("<B", Gets({flags: view for flags in range(0x400)}))
    return bytes(view), [found is view for found in views_of(b)]
def twice_the_same_and_not_the_same():
    "b''.join() asks each item for its bytes twice, if that runs no code of the program. dict.get() calls the __eq__() of a key."
    asked = []
    class Key:
        def __init__(self, answers): self.answers = answers
        def __hash__(self): return 0
        def __eq__(self, other): return bool(asked) and self.answers()
    class Gets(dict): __buffer__ = dict.get
    def once_only():
        asked.append(None)
        return len(asked) == 2
    gets = Gets({Key(once_only): memoryview(b"a"), Key(lambda: True): memoryview(b"b" * 64)})
    asked.append(None)
    return b"".join([gets, b""])
def times_code_runs_in_join(make):
    "An item that runs code when it is asked for its bytes is asked once: the code may make another item longer."
    calls = []; item = make(lambda: calls.append(None))
    return b"".join([item, b"o", memoryview(b"")]), len(calls)
def in_a_pickle_buffer(called):
    class Told(bytearray):
        def __release_buffer__(self, view): called()
    return pickle.PickleBuffer(Told(b"x"))
def a_type_written_in_C_that_is_given_methods():
    calls = []
    def buffer(self, flags):
        calls.append("get")
        return memoryview(b"x")
    struct.error.__buffer__ = buffer
    struct.error.__release_buffer__ = lambda self, view: calls.append("release")
    try:
        joined = b"".join([struct.error(), b"o"])
        try: struct.pack_into("<B", struct.error(), 0, 1)
        except TypeError as error: return joined, calls, str(error).split(",")[0]
    finally: del struct.error.__buffer__, struct.error.__release_buffer__
def a_method_written_in_C_that_calls_the_program(view):
    "typing.Generic.__class_getitem__() returns what a function of typing.py returns."
    class Generic(typing.Generic[typing.TypeVar("T")]): pass
    before = typing._generic_class_getitem; said = None
    typing.Generic.__buffer__ = typing.Generic.__dict__["__class_getitem__"]
    typing._generic_class_getitem = lambda cls, flags: view
    try: struct.pack_into("<2s", Generic(), 0, b"ZZ")
    except TypeError as error: said = str(error).split(",")[0]
    finally:
        typing._generic_class_getitem = before
        del typing.Generic.__buffer__
    return bytes(view), said
def behind_the_back_of_a_type():
    "mappingproxy | x hands the namespace itself to x.__ror__()."
    class Door:
        def __ror__(self, namespace): return namespace
    namespace = collections.defaultdict.__dict__ | Door()
    constant = bytes(4); said = None
    namespace["__buffer__"] = dict.get
    try:
        class Gets(collections.defaultdict): pass
        struct.pack_into("<2s", Gets(None, {flags: memoryview(constant) for flags in range(0x400)}), 0, b"ZZ")
    except TypeError as error: said = str(error).split(",")[0]
    finally: del namespace["__buffer__"]
    return constant, said
def the_host_takes(*objects):
    "Where it has begun its work, what runs code of the program when it is asked for its memory is no buffer."
    def takes(o):
        try: return bool(crypto.createHash("md5").update(o))
        except TypeError: return False
    return [takes(o) for o in objects]
class Plain(bytearray): pass
class Told(bytearray):
    def __release_buffer__(self, view): pass
class Gets(dict): __buffer__ = dict.get
class Key:
    "In the namespace of a class. It is asked whether it equals a name that is looked for, if it hashes like that."
    asked = 0
    def __init__(self, name): self.name = name
    def __hash__(self): return hash(self.name)
    def __eq__(self, other):
        Key.asked += 1
        return False
def keys_are_asked(use):
    # A class of its own each time: what a key has answered may be remembered.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        o = type("HasSuchKeys", (bytearray,), {Key("__buffer__"): 1, Key("__release_buffer__"): 2})(b"x")
    Key.asked = 0
    return use(o), Key.asked
def resized_after_a_view_was_dropped(o):
    def drops(): memoryview(o)
    drops(); o.extend(b"y")
    return bytes(o)
def behind_the_back_of_ctypes():
    "A function of ctypes has the __buffer__() of all data of ctypes, not what is found under that name."
    class Door:
        def __ror__(self, namespace): return namespace
    namespace = ctypes.Structure.__mro__[1].__dict__ | Door()
    calls = []; before = namespace["__buffer__"]
    def buffer(self, flags):
        calls.append(flags)
        return memoryview(b"")
    namespace["__buffer__"] = buffer
    try: return len(bytes(ctypes.CFUNCTYPE(None)(lambda: None))) == ctypes.sizeof(ctypes.c_void_p), calls
    finally: namespace["__buffer__"] = before
class Gives:
    def __buffer__(self, flags): return memoryview(b"a")
def first_of_very_many(*firsts):
    "Twelve million buffers of 192 bytes are more than a vector takes."
    items = [b"a"] * 12_000_000; said = []
    for items[0] in firsts:
        try: said.append(len(b"".join(items)))
        except MemoryError: said.append("MemoryError")
    return said
`,
  },
  [
    ["a_buffer_method_of_another_type()", "(b'ab', [True])"],
    ["twice_the_same_and_not_the_same()", "b'a'"],
    ["times_code_runs_in_join(in_a_pickle_buffer)", "(b'xo', 1)"],
    [
      "a_type_written_in_C_that_is_given_methods()",
      "(b'xo', ['get', 'release', 'get'], 'pack_into() argument 2 must be read-write bytes-like object')",
    ],
    ...["memoryview(bytes(4))", "memoryview(bytearray(4))[::-1]"].map((view): [string, string] => [
      `a_method_written_in_C_that_calls_the_program(${view})`,
      "(b'\\x00\\x00\\x00\\x00', 'pack_into() argument 2 must be read-write bytes-like object')",
    ]),
    [
      "behind_the_back_of_a_type()",
      "(b'\\x00\\x00\\x00\\x00', 'pack_into() argument 2 must be read-write bytes-like object')",
    ],
    [
      "the_host_takes(b'x', bytearray(b'x'), Plain(b'x'), Array('B', b'x'), memoryview(Told(b'x')), pickle.PickleBuffer(Plain(b'x')), (ctypes.c_char * 1)())",
      "[True, True, True, True, True, True, True]",
    ],
    [
      "the_host_takes(Told(b'x'), pickle.PickleBuffer(Told(b'x')), pickle.PickleBuffer(pickle.PickleBuffer(Told(b'x'))), Gets({flags: memoryview(b'x') for flags in range(0x400)}))",
      "[False, False, False, False]",
    ],
    ["behind_the_back_of_ctypes()", "(True, [])"],
    // A key that is no str is not asked.
    ...[
      ["lambda o: b''.join([o, b'o'])", "b'xo'"],
      ["lambda o: struct.unpack_from('<B', o)", "(120,)"],
      ["lambda o: bytes(memoryview(o))", "b'x'"],
      ["lambda o: bytes(pickle.PickleBuffer(o))", "b'x'"],
      ["resized_after_a_view_was_dropped", "b'xy'"],
      ["lambda o: the_host_takes(o, pickle.PickleBuffer(o))", "[True, True]"],
    ].map(([use, result]): [string, string] => [`keys_are_asked(${use})`, `(${result}, 0)`]),
    // Memory that another thread can make longer between two looks at it. The host looks once.
    [
      "shared = js.SharedArrayBuffer(1, maxByteLength=2)\nthe_host_takes(*map(pickle.PickleBuffer, (shared, js.Uint8Array(shared), js.DataView(shared), js.Uint8Array(shared, 0, 1), js.Uint8Array(js.SharedArrayBuffer(1)), js.Uint8Array(js.ArrayBuffer(1, maxByteLength=2)))))",
      "[True, True, True, True, True, True]",
    ],
    [
      "u = js.Uint8Array(js.SharedArrayBuffer(2, maxByteLength=4)).fill(0x61)\nb'-'.join([u, b'b', u, memoryview(u)])",
      "b'aa-b-aa-aa'",
    ],
    // join() looks once as well, and holds a buffer of each item, as where an item runs code. By this it shows: there is no room for so many. (CPython joins
    // them: DEFERRED.md, bytes.join() of very many items.)
    [
      "shared = js.SharedArrayBuffer(1, maxByteLength=2)\nfirst_of_very_many(js.Uint8Array(shared), pickle.PickleBuffer(shared), Gives())",
      "['MemoryError', 'MemoryError', 'MemoryError']",
    ],
  ],
);

// A function written in C++ makes a memoryview for itself, and counts on it that nothing else has it. The module gc finds what nothing refers to.
held(
  "views that functions make for themselves",
  {
    setup: `
import re
class Finds:
    def __init__(self, exporter, value): self.exporter, self.value, self.found = exporter, value, []
    def __index__(self):
        self.found += views_of(self.exporter)
        return self.value
def of_a_buffer():
    a = Array("B", bytes(64)); finds = Finds(a, 0xee)
    struct.pack_into("<B", a, 0, finds)
    a.append(1)
    return len(finds.found), a[0], len(a)
def of_holders():
    "Who has one refers to the object whose memory it is."
    b = bytearray(b"aaaa")
    holders = [(struct.iter_unpack("<B", b), next), (re.compile(b"a").scanner(b), lambda scanner: scanner.search()), (pickle.PickleBuffer(b), bytes)]
    first = [type(use(holder)) for holder, use in holders]
    referents = [gc.get_referents(holder) for holder, use in holders]
    return len(views_of(b)), [sum(type(o) is memoryview for o in found) for found in referents], [sum(o is b for o in found) for found in referents], [type(use(holder)) for holder, use in holders] == first
def an_export_released_by_hand():
    b = bytearray(4); m = memoryview(b); iterator = struct.iter_unpack("<B", m)
    gc.get_referents(m)[0].__del__()
    return next(iterator)
def a_slice_that_is_being_made():
    b = bytearray(64); m = memoryview(b); finds = Finds(b, 1)
    part = m[finds:]
    return [view is m for view in finds.found], len(part), len(views_of(b))
def given_to_eq():
    "The view that a typed array makes of itself to be compared goes to the __eq__() of the other."
    kept = []
    class Other:
        def __buffer__(self, flags): raise BufferError
        def __eq__(self, view):
            kept.append(pickle.PickleBuffer(view))
            return True
    return js.Uint8Array(2) == Other(), bytes(kept[0])
def a_scanner_that_is_being_made():
    found = []
    class Subject:
        def __buffer__(self, flags):
            found.extend(o for o in gc.get_objects() if type(o).__name__ == "SRE_Scanner")
            return memoryview(b"aaa")
    return re.compile(b"a").scanner(Subject()).search().span(), found
Small = ctypes.c_uint8 * 64
once = {}
def hook(event, arguments):
    action = once.pop(event, None)
    if action: action()
def with_a_hook(event, action, call):
    # A hook cannot be taken away again. This one does what it is told once, and nothing from then on.
    global hook
    if hook: sys.addaudithook(hook)
    hook = None
    once[event] = action
    try: return call()
    except ValueError as error: return str(error)
    finally: once.clear()
def a_hook_looks_for_the_view(event, u):
    found = []
    a = with_a_hook(event, lambda: found.extend(views_of(u)), lambda: Small.from_buffer(u))
    return len(found), [view is a._objects["ffffffff"] for view in views_of(u)]
def lent_and_handed_on():
    "To a thread that is using it when __release_buffer__() returns."
    started, go, said, unraisable = threading.Event(), threading.Event(), [], []
    class Separator(bytes):
        def __len__(self):
            started.set(); go.wait(10)
            return 1
    class Lends(bytearray):
        def __release_buffer__(self, view):
            if said: return
            said.append(None)
            self.thread = threading.Thread(target=lambda: said.append(view.hex(Separator(b":"))))
            self.thread.start(); started.wait(10)
    b = Lends(b"abc"); before = sys.unraisablehook
    sys.unraisablehook = lambda report: unraisable.append(f"{report.err_msg}: {type(report.exc_value).__name__}: {report.exc_value}")
    try: struct.unpack_from("<B", b)
    finally: sys.unraisablehook = before
    go.set(); b.thread.join(10)
    return said[1], unraisable
`,
  },
  [
    ["of_a_buffer()", "(0, 238, 65)"],
    // A view that the program has asked for is the program's.
    ["a = Array('B', bytes(64))\nview = memoryview(a)\n[found is view for found in views_of(a)]", "[True]"],
    ["of_holders()", "(0, [0, 0, 0], [1, 1, 1], True)"],
    ["an_export_released_by_hand()", "!ValueError: operation forbidden on released memoryview object"],
    ["a_slice_that_is_being_made()", "([True], 63, 2)"],
    ["a_scanner_that_is_being_made()", "((0, 1), [])"],
    ["given_to_eq()", "(True, b'\\x00\\x00')"],
    ...["ctypes.cdata/buffer", "ctypes.cdata"].map((event): [string, string] => [
      `a_hook_looks_for_the_view('${event}', ${event.endsWith("buffer") ? "js.Uint8Array(64)" : "bytearray(64)"})`,
      "(0, [True])",
    ]),
    [
      "lent_and_handed_on()",
      "('61:62:63', ['Exception ignored in bf_releasebuffer of Lends: BufferError: memoryview has 1 exported buffer'])",
    ],
  ],
);
