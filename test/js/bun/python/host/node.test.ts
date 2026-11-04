// The modules of Node, from Python.
import { expect } from "bun:test";
import { lines, program, script } from "./helpers";

const group = program();

group(
  "fs, path, os",
  {
    setup: `
import js, os, tempfile, pathlib
from node import fs, path
import node.os
directory = tempfile.mkdtemp()
p = path.join(directory, "a.txt")
`,
    teardown: `
import shutil
shutil.rmtree(directory)
`,
  },
  [
    [
      "fs.writeFileSync(p, 'héllo'), fs.readFileSync(p, 'utf8'), bytes(fs.readFileSync(p)), fs.readFileSync(p, encoding='utf8'), fs.readFileSync(p, {'encoding': 'latin1'})",
      "(None, 'héllo', b'h\\xc3\\xa9llo', 'héllo', 'hÃ©llo')",
    ],
    ["open(p, encoding='utf8').read(), fs.existsSync(p), fs.existsSync(p + 'x')", "('héllo', True, False)"],
    [
      "s = fs.statSync(p)\ns.size, s.isFile(), s.isDirectory(), s.size == os.stat(p).st_size, s.mtime.getTime() == int(s.mtimeMs), type(fs.statSync(p, bigint=True).size).__name__",
      "(6, True, False, True, True, 'int')",
    ],
    [
      "fs.readdirSync(directory), [(e.name, e.isFile()) for e in fs.readdirSync(directory, withFileTypes=True)], os.listdir(directory)",
      "(['a.txt'], [('a.txt', True)], ['a.txt'])",
    ],
    [
      "fs.mkdirSync(path.join(directory, 'x', 'y'), recursive=True) == path.join(directory, 'x'), os.path.isdir(path.join(directory, 'x', 'y')), fs.rmSync(path.join(directory, 'x'), recursive=True), os.path.exists(path.join(directory, 'x'))",
      "(True, True, None, False)",
    ],
    [
      "try:\n    fs.readFileSync(p + 'x')\nexcept Exception as e:\n    r = type(e).__name__, e.value.code, e.value.errno, e.value.syscall, e.value.path == p + 'x', str(e).replace(directory, 'DIR')\nr",
      `('JSError', 'ENOENT', -2, 'open', True, "Error: ENOENT: no such file or directory, open 'DIR/a.txtx'")`,
    ],
    [
      "try:\n    fs.readFileSync(p + 'x')\nexcept FileNotFoundError as e:\n    r = e.errno, e.filename == p + 'x'\nr",
      "(2, True)",
      "an error of the system that Node reports is no OSError",
    ],
    ["fd = fs.openSync(p, 'r')\ndata = os.read(fd, 2)\nfs.closeSync(fd)\ndata", "b'h\\xc3'"],
    ["fd = os.open(p, os.O_RDONLY)\ndata = fs.readFileSync(fd, 'utf8')\nos.close(fd)\ndata", "'héllo'"],
    [
      "fs.existsSync(pathlib.Path(p)), fs.readFileSync(pathlib.Path(p), 'utf8')",
      "(True, 'héllo')",
      "a pathlib.Path is no path to Node: existsSync() says False, readFileSync() raises",
    ],
    ["fs.existsSync(os.fsencode(p))", "True"],
    [
      "path.basename('/a/b.txt'), path.extname('x.py'), path.resolve('/a', '../b'), path.sep, path.join(*['a', 'b']), path.relative('/a/b', '/a/c'), path.isAbsolute('a')",
      "('b.txt', '.py', '/b', '/', 'a/b', '../c', False)",
    ],
    [
      "dict(path.parse('/a/b.txt')), path.format({'dir': '/a', 'base': 'b'}), path.format(dir='/a', base='b'), path.posix.join('a', 'b'), path.win32.join('a', 'b')",
      "({'root': '/', 'dir': '/a', 'base': 'b.txt', 'ext': '.txt', 'name': 'b'}, '/a/b', '/a/b', 'a/b', 'a\\\\b')",
    ],
    [
      "node.os.EOL, type(node.os.cpus()).__name__, len(node.os.cpus()) == os.cpu_count(), node.os.homedir() == os.path.expanduser('~'), node.os.tmpdir() == tempfile.gettempdir(), node.os.hostname() == os.uname().nodename",
      "('\\n', 'list', True, True, True, True)",
    ],
    [
      "js.process.pid == os.getpid(), js.process.cwd() == os.getcwd(), js.process.platform, js.process.argv[1] == os.path.abspath(__file__), js.process.versions.bun == js.Bun.version",
      "(True, True, 'linux', True, True)",
    ],
    // More of it in process.test.ts.
    ["os.environ['FROM_PYTHON'] = '1'\njs.process.env.FROM_PYTHON", "'1'"],
    ["js.process.env.FROM_JS = '2'\nos.environ.get('FROM_JS')", "'2'"],
  ],
);

group(
  "fs with callbacks and promises",
  {
    setup: `
import js, asyncio, os, tempfile
from node import fs
from node.fs import promises
directory = tempfile.mkdtemp()
p = os.path.join(directory, "a.txt")
fs.writeFileSync(p, "data")
loop = asyncio.get_running_loop()
`,
    teardown: `
import shutil
shutil.rmtree(directory)
`,
  },
  [
    [
      "f = loop.create_future()\nfs.readFile(p, lambda err, data: f.set_result((err, bytes(data))))\nawait f",
      "(None, b'data')",
    ],
    [
      "f = loop.create_future()\nfs.readFile(p + 'x', lambda err, data=None: f.set_result((err.code, data)))\nawait f",
      "('ENOENT', None)",
    ],
    [
      "type(promises.readFile(p)).__name__, bytes(await promises.readFile(p)), await promises.readFile(p, 'utf8'), (await promises.stat(p)).size",
      "('JSPromise', b'data', 'data', 4)",
    ],
    [
      "try:\n    await promises.readFile(p + 'x')\nexcept Exception as e:\n    r = type(e).__name__, e.value.code\nr",
      "('JSError', 'ENOENT')",
    ],
    ["h = await promises.open(p)\ntext = await h.readFile('utf8')\nawait h.close()\ntext", "'data'"],
    [
      "await asyncio.gather(promises.readFile(p, 'utf8'), promises.stat(p).then(lambda s: s.size), asyncio.to_thread(lambda: open(p).read()))",
      "['data', 4, 'data']",
    ],
    ["[bytes(c) async for c in fs.createReadStream(p)]", "[b'data']"],
    [
      "w = fs.createWriteStream(p + '2')\nw.write('a')\nf = loop.create_future()\nw.end('b', lambda: f.set_result(None))\nawait f\nopen(p + '2').read()",
      "'ab'",
    ],
    [
      "import node.fs.promises\nnode.fs.promises is promises",
      "True",
      "ModuleNotFoundError: 'node.fs' is not a package",
    ],
    ["from node.fs.promises import readFile\nawait readFile(p, 'utf8')", "'data'", "the same"],
    ["import importlib\nimportlib.import_module('node:fs/promises') is promises", "True"],
  ],
);

group(
  "util, url, querystring, assert, vm",
  {
    setup: `
import js, importlib
from node import util, url, querystring, vm
assert_ = importlib.import_module("node.assert")
`,
  },
  [
    [
      "util.format('%s-%d-%j', 'a', 5, {'k': 1}), util.inspect(js.eval('({ a: 1, b: [1, 2] })')), util.inspect({'a': [1, (2, 3)], 'b': None}), util.inspect([1, 's', None, True])",
      `('a-5-{"k":1}', '{ a: 1, b: [ 1, 2 ] }', "{'a': [1, (2, 3)], 'b': None}", "[ 1, 's', undefined, true ]")`,
    ],
    [
      "util.isDeepStrictEqual([1, [2]], [1, [2]]), util.isDeepStrictEqual({'a': 1}, {'a': 1}), util.isDeepStrictEqual({'a': 1}, {'a': 2}), util.isDeepStrictEqual((1, 2), (1, 2))",
      "(True, True, False, True)",
    ],
    [
      "util.types.isPromise(js.Promise.resolve(1)), util.types.isUint8Array(js.Uint8Array(1)), util.types.isUint8Array(b'a'), util.types.isDate(js.Date()), util.types.isNativeError(js.Error('x'))",
      "(True, True, False, True, True)",
    ],
    ["util.types.isNativeError(ValueError('x'))", "True", "an exception of Python is an Error only to instanceof"],
    [
      "a = util.parseArgs(args=['-f', '--bar', 'b', 'pos'], options={'foo': {'type': 'boolean', 'short': 'f'}, 'bar': {'type': 'string'}}, allowPositionals=True)\na.values.foo, a.values.bar, a.positionals",
      "(True, 'b', ['pos'])",
    ],
    ["util.styleText('red', 'x') != '', util.stripVTControlCharacters('\\x1b[31mx\\x1b[0m')", "(True, 'x')"],
    [
      "url.fileURLToPath('file:///a/b'), url.pathToFileURL('/a b').href, url.format(js.URL('http://a.example/p?q=1#h'), fragment=False)",
      "('/a/b', 'file:///a%20b', 'http://a.example/p?q=1')",
    ],
    [
      "u = js.URL('http://u:p@a.example:8080/p/x?q=1&q=2&r=%20#h')\nu.host, u.port, u.username, u.searchParams.getAll('q'), u.searchParams.get('r'), u.searchParams.get('none'), list(u.searchParams.keys()), [list(x) for x in u.searchParams.entries()], str(u)",
      "('a.example:8080', '8080', 'u', ['1', '2'], ' ', None, ['q', 'q', 'r'], [['q', '1'], ['q', '2'], ['r', ' ']], 'http://u:p@a.example:8080/p/x?q=1&q=2&r=%20#h')",
    ],
    [
      "u = js.URL('http://a.example/p?q=1')\nu.pathname = '/new'\nu.searchParams.set('z', 5)\nu.hash = 'h'\nu.href, js.URL('../x', 'http://a.example/a/b').href, js.URL.canParse('nonsense')",
      "('http://a.example/new?q=1&z=5#h', 'http://a.example/x', False)",
    ],
    [
      "str(js.URLSearchParams({'a': 1, 'b': 'x y'})), str(js.URLSearchParams([('a', 1), ('a', 2)])), str(js.URLSearchParams(a=1)), len(js.URLSearchParams('a=1&b=2')), {k: v for k, v in js.URLSearchParams('a=1&b=2').items()}",
      "('a=1&b=x+y', 'a=1&a=2', 'a=1', 2, {'a': '1', 'b': '2'})",
    ],
    ["dict(js.URLSearchParams('a=1&b=2'))", "{'a': '1', 'b': '2'}"],
    ["'a' in js.URLSearchParams('a=1'), js.URLSearchParams('a=1')['a']", "(True, '1')"],
    // A key that is there twice is there twice, and [] is get(), which gives the first.
    [
      "p = js.URLSearchParams('x=1&y=2&x=3')\np['x'], len(p), list(p), dict(p), p.items(), p.getAll('x'), [list(e) for e in p.entries()]",
      "('1', 3, ['x', 'y', 'x'], {'x': '1', 'y': '2'}, [('x', '1'), ('y', '2'), ('x', '1')], ['1', '3'], [['x', '1'], ['y', '2'], ['x', '3']])",
    ],
    [
      "q = querystring.parse('a=1&a=2&b=x%20y')\nq.a, q.b, dict(q), querystring.stringify({'a': [1, 2], 'b': 'x y'}), querystring.stringify(a=[1, 2], b='x y')",
      "(['1', '2'], 'x y', {'a': ['1', '2'], 'b': 'x y'}, 'a=1&a=2&b=x%20y', 'a=1&a=2&b=x%20y')",
    ],
    [
      "assert_.strictEqual(1, 1), assert_.deepStrictEqual([1, {'a': 1}], [1, {'a': 1}]), assert_.deepEqual((1, 2), (1, 2)), assert_.ok(1), assert_.throws(lambda: 1 / 0), assert_.notStrictEqual([], [])",
      "(None, None, None, None, None, None)",
    ],
    [
      "try:\n    assert_.equal(1, 2, 'custom')\nexcept Exception as e:\n    r = e.value.name, e.value.code, e.value.message, e.value.actual, e.value.expected, e.value.operator\nr",
      "('AssertionError', 'ERR_ASSERTION', 'custom', 1, 2, '==')",
    ],
    [
      "assert_.deepStrictEqual({'a': 1}, {'a': 2})",
      "!JSError: AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:\n+ actual - expected\n\n  dict {\n+   a: 1\n-   a: 2\n  }\n",
    ],
    ["assert_.throws(lambda: 1 / 0, ZeroDivisionError)", "None"],
    [
      "assert_.throws(lambda: 1 / 0, {'name': 'ZeroDivisionError', 'message': 'division by zero'}), assert_.throws(lambda: 1 / 0, js.RegExp('division'))",
      "(None, None)",
    ],
    [
      "vm.runInNewContext('a + b', {'a': 1, 'b': 2}), vm.runInNewContext('a + b', a=1, b=2), vm.runInThisContext('1 + 1')",
      "(3, 3, 2)",
    ],
    ["c = {'n': 1}\nvm.runInNewContext('n += 1; m = 5', c), c", "(5, {'n': 2, 'm': 5})"],
  ],
);

group(
  "events",
  {
    setup: `
import js, asyncio
from node.events import EventEmitter, once
class H:
    def __init__(self): self.seen = []
    def handle(self, v): self.seen.append(v)
`,
  },
  [
    [
      "e = EventEmitter.new()\ngot = []\ndef on_x(a, b): got.append((a, b))\ne.on('x', on_x)\ne.once('x', lambda *a: got.append(('once', a)))\ne.emit('x', 1, 2), e.emit('x', 3, 4), e.emit('nobody'), got",
      "(True, True, False, [(1, 2), ('once', (1, 2)), (3, 4)])",
    ],
    [
      "e.listenerCount('x'), e.listeners('x')[0] is on_x, e.off('x', on_x) is e, e.listenerCount('x'), e.eventNames()",
      "(1, True, True, 0, [])",
    ],
    // It is written as a function.
    [
      "type(EventEmitter()).__name__, isinstance(EventEmitter(), EventEmitter), EventEmitter().listenerCount('x')",
      "('JSObject', True, 0)",
    ],
    ["h = H()\ne.on('y', h.handle)\ne.emit('y', 1)\nh.seen", "[1]"],
    [
      "e.off('y', h.handle)\ne.listenerCount('y')",
      "0",
      "h.handle is another object each time, and JavaScript compares listeners with ===",
    ],
    ["def bad(*a): raise ValueError('in a listener')\ne.on('z', bad)\ne.emit('z')", "!ValueError: in a listener"],
    ["e.emit('error', js.Error('nobody listens'))", "!JSError: Error: nobody listens"],
    [
      "e.emit('error', ValueError('nobody listens'))",
      "!ValueError: nobody listens",
      "it is wrapped in ERR_UNHANDLED_ERROR, as what is no Error is",
    ],
    ["asyncio.get_running_loop().call_later(0.001, lambda: e.emit('w', 7, 8))\nawait once(e, 'w')", "[7, 8]"],
    ["e.on('t', js.eval('(function () { this.flag = 1; })'))\ne.emit('t')\ne.flag", "1"],
    ["e.setMaxListeners(1) is e, e.getMaxListeners(), isinstance(e, EventEmitter)", "(True, 1, True)"],
    ["class My(EventEmitter):\n    def ping(self): return self.emit('ping')\nMy().ping()", "False"],
  ],
);

group(
  "streams, zlib, crypto",
  {
    setup: `
import js, asyncio, hashlib, hmac
import zlib as pyzlib
from node import stream, zlib, crypto, readline
from node.stream import Readable, Writable, Transform, PassThrough
null = js.eval("null")
readable = getattr(Readable, "from")
async def agen():
    yield "g1"
    await asyncio.sleep(0.001)
    yield "g2"
out = []
def write(chunk, encoding, callback):
    out.append(bytes(chunk))
    callback()
loop = asyncio.get_running_loop()
`,
  },
  [
    [
      "[c async for c in readable(['a', 'b'])], [c async for c in readable(agen())], [c async for c in readable(x for x in 'pq')]",
      "(['a', 'b'], ['g1', 'g2'], ['p', 'q'])",
    ],
    [
      "chunks = []\nr = readable(['a', 'b'])\nr.on('data', lambda c: chunks.append(c))\nf = loop.create_future()\nr.on('end', lambda: f.set_result(None))\nawait f\nchunks",
      "['a', 'b']",
    ],
    [
      "w = Writable.new(write=write)\nw.write('hello')\nw.end('!')\nawait stream.promises.finished(w)\nout",
      "[b'hello', b'!']",
    ],
    [
      "out.clear()\nt = Transform.new(transform=lambda chunk, encoding, callback: callback(None, chunk.toString().upper()))\nawait stream.promises.pipeline(readable(['x', 'y']), t, Writable.new(write=write)), out",
      "(None, [b'X', b'Y'])",
    ],
    [
      "r = Readable(read=lambda size: None)\nr.push('pushed')\nr.push(js.null)\n[bytes(c) async for c in r]",
      "[b'pushed']",
    ],
    [
      "def failing(chunk, encoding, callback): callback(ValueError('write failed'))\nw = Writable.new(write=failing)\nf = loop.create_future()\nw.on('error', lambda e: f.set_result(e))\nw.write('x')\nawait f",
      "ValueError('write failed')",
    ],
    ["await stream.promises.pipeline(readable(['x']), Writable.new(write=failing))", "!ValueError: write failed"],
    [
      "p = PassThrough.new()\np.end('through')\n(await stream.promises.finished(p.resume())), p.readableEnded",
      "(None, True)",
    ],
    ["[line async for line in readline.createInterface(input=readable(['l1\\nl2\\n', 'l3']))]", "['l1', 'l2', 'l3']"],
    [
      "class Upper(Transform):\n    def _transform(self, chunk, encoding, callback): callback(None, chunk.toString().upper())\n[bytes(c) async for c in readable(['a']).pipe(Upper())]",
      "[b'A']",
    ],
    // Streams of the web.
    [
      "def start(c):\n    c.enqueue('a')\n    c.enqueue('b')\n    c.close()\n[x async for x in js.ReadableStream(start=start)], [x async for x in js.ReadableStream({'start': start})]",
      "(['a', 'b'], ['a', 'b'])",
    ],
    ["r = js.ReadableStream(start=start).getReader()\nfirst = await r.read()\nfirst.value, first.done", "('a', False)"],
    [
      "n = [0]\ndef pull(c):\n    n[0] += 1\n    c.close() if n[0] > 3 else c.enqueue(js.Uint8Array([n[0]]))\nbytes(await js.Response(js.ReadableStream(pull=pull)).bytes())",
      "b'\\x01\\x02\\x03'",
    ],
    [
      "async def apull(c):\n    await asyncio.sleep(0.001)\n    c.enqueue('x')\n    c.close()\nawait js.Response(js.ReadableStream(pull=apull).pipeThrough(js.TextEncoderStream())).text()",
      "'x'",
    ],
    [
      "class Source:\n    i = 0\n    def pull(self, c):\n        self.i += 1\n        c.enqueue(str(self.i)) if self.i < 3 else c.close()\nawait js.Array.fromAsync(js.ReadableStream(Source()))",
      "['1', '2']",
    ],
    [
      "got = []\nw = js.WritableStream(write=lambda chunk, c: got.append(chunk), close=lambda: got.append('closed')).getWriter()\nawait w.write('1')\nawait w.close()\ngot",
      "['1', 'closed']",
    ],
    [
      "[x async for x in js.ReadableStream(start=start).pipeThrough(js.TransformStream(transform=lambda chunk, c: c.enqueue(chunk.upper())))]",
      "['A', 'B']",
    ],
    [
      "await js.Array.fromAsync(getattr(js.ReadableStream, 'from')(agen())), await js.Response(agen()).text()",
      "(['g1', 'g2'], 'g1g2')",
    ],
    [
      "pyzlib.decompress(zlib.deflateSync('abc')), bytes(zlib.inflateSync(js.Uint8Array(pyzlib.compress(b'xyz')))), bytes(zlib.gunzipSync(zlib.gzipSync('g'))), bytes(zlib.brotliDecompressSync(zlib.brotliCompressSync('b')))",
      "(b'abc', b'xyz', b'g', b'b')",
    ],
    [
      "crypto.createHash('sha256').update('ab').digest('hex') == hashlib.sha256(b'ab').hexdigest(), crypto.createHmac('sha1', 'k').update('m').digest('hex') == hmac.new(b'k', b'm', 'sha1').hexdigest()",
      "(True, True)",
    ],
    [
      "len(crypto.randomBytes(8)), type(crypto.randomInt(10)).__name__, len(crypto.randomUUID()), hmac.compare_digest(crypto.createHash('md5').update('a').digest(), hashlib.md5(b'a').digest())",
      "(8, 'int', 36, True)",
    ],
    [
      "bytes(await js.crypto.subtle.digest('SHA-256', js.TextEncoder().encode('ab'))).hex() == hashlib.sha256(b'ab').hexdigest()",
      "True",
    ],
    [
      "k = await js.crypto.subtle.generateKey({'name': 'HMAC', 'hash': 'SHA-256', 'length': 256}, True, ['sign', 'verify'])\ns = await js.crypto.subtle.sign('HMAC', k, js.TextEncoder().encode('m'))\nlen(bytes(s)), await js.crypto.subtle.verify('HMAC', k, s, js.TextEncoder().encode('m'))",
      "(32, True)",
    ],
    [
      "type(await js.crypto.subtle.generateKey({'name': 'HMAC', 'hash': 'SHA-256'}, True, ['sign'])).__name__",
      "'JSObject'",
      "OperationError: the optional `length` of the algorithm is read from the dict, whose length is 2",
    ],
  ],
);

group(
  "http, net, child_process",
  {
    setup: `
import js, asyncio, urllib.request
from node import http, net, child_process
loop = asyncio.get_running_loop()
def handler(request, response):
    body = []
    request.on("data", lambda c: body.append(bytes(c)))
    def end():
        response.writeHead(201, {"content-type": "text/plain", "x-method": request.method})
        response.end(b"".join(body).decode().upper() + request.url)
    request.on("end", end)
server = http.createServer(handler)
listening = loop.create_future()
server.listen(0, "127.0.0.1", lambda: listening.set_result(server.address().port))
port = await listening
`,
    teardown: "server.close()\n",
  },
  [
    [
      "r = await js.fetch(f'http://127.0.0.1:{port}/p?q', method='POST', body='abc')\nr.status, r.headers.get('x-method'), await r.text()",
      "(201, 'POST', 'ABC/p?q')",
    ],
    [
      "await asyncio.to_thread(lambda: urllib.request.urlopen(f'http://127.0.0.1:{port}/u', data=b'py').read())",
      "b'PY/u'",
    ],
    [
      "f = loop.create_future()\ndef on_response(r):\n    data = []\n    r.on('data', lambda c: data.append(c.toString()))\n    r.on('end', lambda: f.set_result((r.statusCode, ''.join(data))))\nhttp.request({'port': port, 'host': '127.0.0.1', 'method': 'POST', 'path': '/n'}, on_response).end('nn')\nawait f",
      "(201, 'NN/n')",
    ],
    [
      "s = net.createServer(lambda sock: sock.on('data', lambda d: sock.end('echo:' + d.toString())))\nf = loop.create_future()\ns.listen(0, '127.0.0.1', lambda: f.set_result(s.address().port))\nr, w = await asyncio.open_connection('127.0.0.1', await f)\nw.write(b'from asyncio')\ndata = await r.read()\nw.close()\ns.close()\ndata",
      "b'echo:from asyncio'",
    ],
    [
      "async def upper(r, w):\n    w.write((await r.read(100)).upper())\n    await w.drain()\n    w.close()\ns = await asyncio.start_server(upper, '127.0.0.1', 0)\nf = loop.create_future()\nc = net.connect(s.sockets[0].getsockname()[1], '127.0.0.1')\nc.on('data', lambda d: f.set_result(d.toString()))\nc.write('from node')\ndata = await f\nc.destroy()\ns.close()\ndata",
      "'FROM NODE'",
    ],
    [
      "child_process.execSync('echo hi').toString(), child_process.spawnSync('sh', ['-c', 'exit 2']).status, child_process.execFileSync('echo', ['a', 'b'], encoding='utf8')",
      "('hi\\n', 2, 'a b\\n')",
    ],
    [
      "f = loop.create_future()\nchild_process.exec('echo out; exit 1', lambda err, out, errout: f.set_result((err.code, out, errout)))\nawait f",
      "(1, 'out\\n', '')",
    ],
    [
      "c = child_process.spawn('cat')\nout = []\nc.stdout.on('data', lambda d: out.append(d.toString()))\nf = loop.create_future()\nc.on('close', lambda code, signal: f.set_result(code))\nc.stdin.end('piped')\nawait f, out",
      "(0, ['piped'])",
    ],
  ],
);

// Node calls back with as many arguments as it has: callback(error) when something failed.
script(
  "a callback that is given fewer arguments than it has parameters",
  {
    "main.py": `
from node import fs
fs.readFile("/nonexistent/file", lambda err, data: print("called with", err.code, data))
`,
  },
  ({ stdout, stderr, exitCode }) => {
    // TODO: a user of Node expects "called with ENOENT None". Today the call is a TypeError, which nobody can catch.
    expect(stdout).toBe("");
    expect(stderr).toContain("TypeError: <lambda>() missing 1 required positional argument: 'data'");
    expect(exitCode).toBe(1);
  },
);

// stream.push(None) is push(undefined), which does not end the stream.
script(
  "None does not end a stream",
  {
    "main.py": `
import asyncio
from node.stream import Readable
r = Readable.new(read=lambda size: None)
r.push("x")
r.push(None)
async def read(): return [bytes(c) async for c in r]
try:
    print(await asyncio.wait_for(read(), 0.2))
except TimeoutError:
    print("still open")
r.destroy()
`,
  },
  ({ stdout, exitCode }) => {
    expect(stdout).toBe(lines("still open")); // TODO: [b'x']
    expect(exitCode).toBe(0);
  },
);

// `for` does not call return() of the iterator yet.
script(
  "leaving `async for` over an iterator of JavaScript",
  {
    "main.py": `
import js
returned = []
it = js.eval("r => ({ [Symbol.asyncIterator]() { return this; }, async next() { return { value: 1, done: false }; }, async return() { r.push(true); return { done: true }; } })")(returned)
async for x in it:
    break
print(returned)
sync = js.eval("r => ({ [Symbol.iterator]() { return this; }, next() { return { value: 1, done: false }; }, return() { r.push('sync'); return { done: true }; } })")(returned)
for x in sync:
    break
print(returned)
`,
  },
  ({ stdout, exitCode }) => {
    expect(stdout).toBe(lines("[True]", "[True]")); // TODO: [True], [True, 'sync']
    expect(exitCode).toBe(0);
  },
);
