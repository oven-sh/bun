// Bytes: typed arrays, ArrayBuffer, DataView and Buffer in Python; bytes, bytearray and memoryview in JavaScript.
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
      "('JSObject', 4, 1, 4, [1, 2, 3, 4], [1, 2, 3, 4], b'\\x01\\x02\\x03\\x04', bytearray(b'\\x01\\x02\\x03\\x04'))",
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
    // They are no sequences yet.
    ["u8(1, 2, 3)[-1]", "3", "KeyError: an index is the name of a property"],
    [
      "bytes(u8(1, 2, 3)[1:])",
      "b'\\x02\\x03'",
      "TypeError: no slices, so gzip.decompress(typed_array) and the like fail",
    ],
    ["9 in u8(9, 8), 1 in u8(9, 8)", "(True, False)", "`in` asks for the index"],
    [
      "u8(1, 2) == b'\\x01\\x02', b'\\x01\\x02' == u8(1, 2), memoryview(u8(1, 2)) == b'\\x01\\x02'",
      "(True, True, True)",
      "only the memoryview equals the bytes",
    ],
    ["list(reversed(u8(1, 2)))", "[2, 1]"],
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
    // Where JavaScript asks for a typed array or an ArrayBuffer, they are none. js.Uint8Array(data) makes a copy that is.
    ["js.eval('x => [x instanceof Uint8Array, ArrayBuffer.isView(x)]')(b'ab')", "[False, False]"],
    ["js.TextDecoder().decode(js.Uint8Array(b'h\\xc3\\xa9'))", "'hé'"],
    [
      "js.TextDecoder().decode(b'h\\xc3\\xa9'), js.TextDecoder().decode(bytearray(b'h\\xc3\\xa9')), js.TextDecoder().decode(memoryview(b'h\\xc3\\xa9'))",
      "('hé', 'hé', 'hé')",
      "TypeError: expects an ArrayBuffer or TypedArray",
    ],
    ["Buffer.concat([b'a', bytearray(b'b')]).toString()", "'ab'", "TypeError"],
    [
      "getattr(Buffer, 'from')('ab').equals(b'ab'), getattr(Buffer, 'from')('ab').indexOf(b'b'), Buffer.byteLength(b'abc')",
      "(True, 1, 3)",
      "TypeError",
    ],
    ["a = bytearray(4)\njs.crypto.getRandomValues(a)\nlen(a)", "4", "TypeError"],
    // Worse where anything is taken and made a string of: what is written is repr(data).
    ["js.Blob([b'ab', 'cd']).size", "4", "7: the blob holds b'ab'cd"],
    ["js.Bun.hash.crc32(b'abc') == js.Bun.hash.crc32('abc')", "True", "the checksum is that of the text b'abc'"],
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
    ["bytes(await js.Response(b'\\x00\\xff').bytes())", "b'\\x00\\xff'", "the body is the text b'\\x00\\xff'"],
    [
      "bytes(await js.Response(bytearray(b'\\x00\\xff')).bytes())",
      "b'\\x00\\xff'",
      "the body is the text bytearray(b'\\x00\\xff')",
    ],
    [
      "bytes(await js.Request('http://a.example', method='POST', body=b'\\x00\\xff').bytes())",
      "b'\\x00\\xff'",
      "the same",
    ],
    ["await js.Bun.write(path, js.Uint8Array(b'\\x00\\xff')), read()", "(2, b'\\x00\\xff')"],
    [
      "await js.Bun.write(path, b'\\x00\\xff'), read()",
      "(2, b'\\x00\\xff')",
      "Bun.write() writes the text b'\\x00\\xff'",
    ],
    [
      "fs.writeFileSync(path, js.Uint8Array(b'\\x01\\xfe')), read(), bytes(fs.readFileSync(path))",
      "(None, b'\\x01\\xfe', b'\\x01\\xfe')",
    ],
    ["fs.writeFileSync(path, b'\\x00\\xff'), read()", "(None, b'\\x00\\xff')", "TypeError"],
    [
      "fs.writeFileSync(path, 'abcd')\nfd = fs.openSync(path, 'r')\nu = js.Uint8Array(4)\nn = fs.readSync(fd, u, 0, 4, 0)\nfs.closeSync(fd)\nn, bytes(u)",
      "(4, b'abcd')",
    ],
    [
      "fd = fs.openSync(path, 'r')\nb = bytearray(4)\ntry:\n    n = fs.readSync(fd, b, 0, 4, 0)\nfinally:\n    fs.closeSync(fd)\nn, b",
      "(4, bytearray(b'abcd'))",
      "TypeError: a bytearray is no buffer to read into",
    ],
    ["bytes(await js.Blob([js.Uint8Array(b'ab'), 'cd']).bytes()), await js.Blob(['ab']).text()", "(b'abcd', 'ab')"],
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
      "u = js.Uint8Array(1 << 16)\nclass Detaches:\n    def __index__(self):\n        js.structuredClone(u.buffer, transfer=[u.buffer])\n        return 0\nstruct.pack_into('<I', u, Detaches(), 1)",
      "!BufferError: the ArrayBuffer was detached or shrunk",
    ],
    [
      "len(bytes(js.SharedArrayBuffer(8))), memoryview(js.Uint8Array(js.SharedArrayBuffer(8))).nbytes, memoryview(js.Uint8Array(0)).tolist(), bytes(js.DataView(js.ArrayBuffer(4), 1, 2))",
      "(8, 8, [], b'\\x00\\x00')",
    ],
    [
      "wasm = bytes([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11])\njs.WebAssembly.validate(js.Uint8Array(wasm)), js.WebAssembly.Instance(js.WebAssembly.Module(js.Uint8Array(wasm))).exports.add(2, 3)",
      "(True, 5)",
    ],
    [
      "js.WebAssembly.Instance(js.WebAssembly.Module(wasm)).exports.add(2, 3)",
      "5",
      "TypeError: bytes are no ArrayBuffer",
    ],
  ],
);
