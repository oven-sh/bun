// What Bun has, from Python: `from bun import ...`.
import { expect } from "bun:test";
import { program, script } from "./helpers";

const group = program();

group(
  "files, globs, hashes and other functions",
  {
    setup: `
import js, os, sys, tempfile, gzip, hashlib
import bun
from bun import file, write, Glob, hash, password, env, which, gzipSync, gunzipSync, TOML, version
directory = tempfile.mkdtemp()
p = os.path.join(directory, "f.txt")
`,
    teardown: `
import shutil
shutil.rmtree(directory)
`,
  },
  [
    [
      "await write(p, 'text é'), await file(p).text(), file(p).size, await file(p).exists(), await file(p + 'x').exists(), file(p).type, open(p, encoding='utf8').read()",
      "(7, 'text é', 7, True, False, 'text/plain;charset=utf-8', 'text é')",
    ],
    [
      "try:\n    await file(p + 'x').text()\nexcept Exception as e:\n    r = type(e).__name__, e.value.code\nr",
      "('JSError', 'ENOENT')",
    ],
    [
      "b = await file(p).bytes()\ntype(b).__name__, bytes(b), bytes(await file(p).arrayBuffer())",
      "('JSObject', b'text \\xc3\\xa9', b'text \\xc3\\xa9')",
    ],
    [
      "await write(os.path.join(directory, 'j.json'), js.JSON.stringify({'a': [1, 2]})), (await file(os.path.join(directory, 'j.json')).json()).a",
      "(11, [1, 2])",
    ],
    [
      "await write(os.path.join(directory, 'copy'), file(p)), open(os.path.join(directory, 'copy'), 'rb').read()",
      "(7, b'text \\xc3\\xa9')",
    ],
    [
      "w = file(os.path.join(directory, 'w.txt')).writer()\nw.write('a')\nw.write('b')\nawait js.Promise.resolve(w.end()), open(os.path.join(directory, 'w.txt')).read(), [bytes(c) async for c in file(os.path.join(directory, 'w.txt')).stream()]",
      "(2, 'ab', [b'ab'])",
    ],
    // What JavaScript documents as "a number or a promise of one" can be awaited there either way.
    [
      "w = file(os.path.join(directory, 'w2.txt')).writer()\nw.write('a')\nawait w.end()",
      "1",
      "TypeError: 'int' object can't be awaited",
    ],
    [
      "sorted(Glob('*.txt').scanSync(directory)), sorted(Glob('*.txt').scanSync(cwd=directory)), sorted([x async for x in Glob('*.{txt,json}').scan(cwd=directory)]), Glob('*.py').match('a.py')",
      "(['f.txt', 'w.txt', 'w2.txt'], ['f.txt', 'w.txt', 'w2.txt'], ['f.txt', 'j.json', 'w.txt', 'w2.txt'], True)",
    ],
    [
      "type(hash('abc')).__name__, hash.crc32('abc'), hash.crc32(js.Uint8Array(b'abc')), hash.wyhash('abc', 1) == hash.wyhash('abc', 1)",
      "('int', 891568578, 891568578, True)",
    ],
    [
      "h = await password.hash('pw', algorithm='bcrypt', cost=4)\nawait password.verify('pw', h), password.verifySync('no', h)",
      "(True, False)",
    ],
    [
      "which('sh') is not None, which('no-such-program-at-all'), version == bun.version == js.Bun.version",
      "(True, None, True)",
    ],
    [
      "bytes(gunzipSync(gzipSync('abc'))), bytes(gunzipSync(gzipSync(js.Uint8Array(b'abc')))), bytes(gunzipSync(js.Uint8Array(gzip.compress(b'xyz')))), gzip.decompress(bytes(gzipSync('abc')))",
      "(b'abc', b'abc', b'xyz', b'abc')",
    ],
    [
      "gzip.decompress(gzipSync('abc'))",
      "b'abc'",
      "TypeError: gzip slices its argument, and a typed array has no slices",
    ],
    [
      "r = TOML.parse('a = 1\\n[t]\\nb = [1.5, \"x\"]\\n')\nr.a, r.t.b, dict(r.t), bun.YAML.parse('a: 1\\nb: [x, 2]\\n').b, bun.JSON5.parse('{a: 1, /*c*/ b: [1,],}').b",
      "(1, [1.5, 'x'], {'b': [1.5, 'x']}, ['x', 2], [1])",
    ],
    [
      "bun.YAML.stringify({'a': 1, 'b': [1, 2]}), bun.YAML.stringify(js.eval('({ a: 1, b: [1, 2] })'))",
      "('{a: 1,b: [1,2]}', '{a: 1,b: [1,2]}')",
    ],
    [
      "bun.semver.satisfies('1.2.3', '^1.0.0'), bun.escapeHTML('<a&b>'), bun.stringWidth('añ😀'), len(bun.randomUUIDv7()), bun.nanoseconds() > 0, bun.fileURLToPath('file:///a'), bun.color('red', 'hex'), bun.color([255, 0, 0], 'css')",
      "(True, '&lt;a&amp;b&gt;', 4, 36, True, '/a', '#ff0000', 'red')",
    ],
    ["bun.color((255, 0, 0), 'css')", "'red'", "a tuple is no array to what is written in native code"],
    [
      "bun.main == os.path.abspath(__file__), bun.argv[1:] == [os.path.abspath(__file__)], sys.argv == [os.path.abspath(__file__)]",
      "(True, True, True)",
    ],
    [
      "bun.CryptoHasher('sha256').update('a').update(js.Uint8Array(b'b')).digest('hex') == hashlib.sha256(b'ab').hexdigest(), bun.SHA1.hash('a', 'hex') == hashlib.sha1(b'a').hexdigest()",
      "(True, True)",
    ],
    [
      "bun.peek(js.Promise.resolve(3)), await bun.readableStreamToText(js.Response('abc').body), bun.concatArrayBuffers([js.Uint8Array(b'a'), js.Uint8Array(b'b')]).byteLength",
      "(3, 'abc', 2)",
    ],
    [
      "bun.Transpiler(loader='ts').transformSync('const a: number = 1; export { a }').split()",
      "['const', 'a', '=', '1;', 'export', '{', 'a', '};']",
    ],
    [
      "c = bun.CookieMap('a=1; b=2')\nc.get('a'), c.size, len(c), [list(x) for x in c]",
      "('1', 2, 2, [['a', '1'], ['b', '2']])",
    ],
    ["dict(bun.CookieMap('a=1; b=2'))", "{'a': '1', 'b': '2'}", "KeyError: see URLSearchParams"],
    ["sorted(n for n in dir(bun) if n in ('serve', 'file', 'require', 'nothing'))", "['file', 'serve']"],
    ["bun.nothing", "!AttributeError: 'JSObject' object has no attribute 'nothing'"],
    ["from bun import nothing\n0", "!ImportError: cannot import name 'nothing' from 'bun' (unknown location)"],
  ],
);

group(
  "processes and the shell",
  {
    setup: `
import js, os, sys, asyncio
import bun
from bun import spawn, spawnSync
`,
  },
  [
    [
      "r = spawnSync(['sh', '-c', 'echo out; echo err >&2; exit 3'])\nr.exitCode, bytes(r.stdout), r.stderr.toString(), r.success",
      "(3, b'out\\n', 'err\\n', False)",
    ],
    [
      "spawnSync(cmd=['sh', '-c', 'echo $X'], env={'X': 'from env', 'PATH': os.environ['PATH']}).stdout.toString()",
      "'from env\\n'",
    ],
    [
      "p = spawn(['cat'], stdin='pipe', stdout='pipe')\np.stdin.write('to cat')\np.stdin.end()\nawait p.stdout.text(), await p.exited, p.exitCode",
      "('to cat', 0, 0)",
    ],
    [
      "done = asyncio.get_running_loop().create_future()\np = spawn(['true'], onExit=lambda proc, code, signal, error: done.set_result((proc is p, code, signal, error)))\nawait done",
      "(True, 0, None, None)",
    ],
    ["p = spawn(['sleep', '10'])\np.kill()\nawait p.exited, p.signalCode, p.killed", "(143, 'SIGTERM', True)"],
    ["await spawn([sys.executable, '-c', 'print(6 * 7)'], stdout='pipe').stdout.text()", "'42\\n'"],
    ["await spawn(['cat'], stdin=js.Response('from a Response'), stdout='pipe').stdout.text()", "'from a Response'"],
    ["[bytes(c) async for c in spawn(['echo', 'x']).stdout]", "[b'x\\n']"],
    ["await spawn(('echo', 'tuple')).stdout.text()", "'tuple\\n'", "TypeError: cmd must be an array"],
    [
      "spawnSync(['no-such-program-at-all'])",
      '!JSError: Error: Executable not found in $PATH: "no-such-program-at-all"',
    ],
    // $ is a tag for template literals, which Python has none of that JavaScript knows.
    ["await js.eval('async x => await Bun.$`echo ${x}`.text()')('a b')", "'a b\\n'"],
    [
      "strings = ['echo ', '']\njs.Object.assign(strings, raw=strings)\nawait getattr(bun, '$')(strings, 'a b').text()",
      "'a b\\n'",
    ],
    [
      "x = 'a b'\nawait getattr(bun, '$')(t'echo {x}').text()",
      "'a b\\n'",
      "a template string of Python (t'...') is not what a tag of JavaScript takes",
    ],
  ],
);

group(
  "Bun.serve",
  {
    setup: `
import js, asyncio, json
from bun import serve
errors = []
def fetch(request, server):
    path = js.URL(request.url).pathname
    if path == "/sync": return js.Response("sync")
    if path == "/json": return js.Response.json({"a": [1, 2.5, None], "t": (1, 2), "n": {"x": True}})
    if path == "/status": return js.Response("no", status=404, headers={"x-a": "b", "content-type": "text/x"})
    if path == "/init": return js.Response("no", {"status": 201, "headers": [("x-a", "1"), ("x-b", "2")]})
    if path == "/raise": raise ValueError("handler failed")
    if path == "/headers": return js.Response.json({k: v for k, v in request.headers})
    if path == "/ip": return js.Response(server.requestIP(request).address)
    if path == "/redirect": return js.Response.redirect("/sync", 302)
    return js.Response("fallback " + request.method)
def on_error(error):
    errors.append(error)
    return js.Response("custom error", status=500)
server = serve(port=0, hostname="127.0.0.1", fetch=fetch, error=on_error)
base = f"http://127.0.0.1:{server.port}"
async def get(path, **options):
    r = await js.fetch(base + path, **options)
    return r.status, await r.text()
`,
    teardown: "server.stop(True)\n",
  },
  [
    [
      "await get('/sync'), await get('/x'), await get('/x', method='PUT'), await get('/ip'), await get('/redirect')",
      "((200, 'sync'), (200, 'fallback GET'), (200, 'fallback PUT'), (200, '127.0.0.1'), (200, 'sync'))",
    ],
    ["await get('/json')", `(200, '{"a":[1,2.5,null],"t":[1,2],"n":{"x":true}}')`],
    [
      "r = await js.fetch(base + '/status')\nr.status, r.ok, r.statusText, r.headers.get('x-a'), r.headers.get('content-type'), r.headers.has('x-a'), r.headers.get('none')",
      "(404, False, 'Not Found', 'b', 'text/x', True, None)",
    ],
    ["r = await js.fetch(base + '/init')\nr.status, r.headers.get('x-a'), r.headers.get('x-b')", "(201, '1', '2')"],
    ["await get('/raise'), errors", "((500, 'custom error'), [ValueError('handler failed')])"],
    [
      "d = await (await js.fetch(base + '/headers', headers={'X-One': '1', 'x-two': '2'})).json()\nd['x-one'], d['x-two']",
      "('1', '2')",
    ],
    [
      "d = await (await js.fetch(base + '/json')).json()\nd.a, d.t, d.n.x, json.loads(await (await js.fetch(base + '/json')).text())",
      "([1, 2.5, None], [1, 2], True, {'a': [1, 2.5, None], 't': [1, 2], 'n': {'x': True}})",
    ],
    [
      "h = js.Headers({'A': '1'})\nh.append('b', '2')\nh.get('a'), [list(x) for x in h], {k: v for k, v in h}, dict(list(h)), h.toJSON().a",
      "('1', [['a', '1'], ['b', '2']], {'a': '1', 'b': '2'}, {'a': '1', 'b': '2'}, '1')",
    ],
    [
      "dict(js.Headers({'a': '1'})), 'a' in js.Headers({'a': '1'}), len(js.Headers({'a': '1'}))",
      "({'a': '1'}, True, 1)",
      "KeyError: see URLSearchParams",
    ],
    [
      "dict(js.Headers({'a': '1'}).entries())",
      "{'a': '1'}",
      "{}: dict() takes an iterator of JavaScript for a mapping",
    ],
    [
      "server.port > 0, server.hostname, str(server.url) == base + '/', server.pendingRequests",
      "(True, '127.0.0.1', True, 0)",
    ],
    [
      "async def afetch(request):\n    await asyncio.sleep(0.001)\n    return js.Response((await request.text()).upper())\ns = serve(port=0, hostname='127.0.0.1', fetch=afetch)\nr = await (await js.fetch(f'http://127.0.0.1:{s.port}/', method='POST', body='body')).text()\ns.stop(True)\nr",
      "'BODY'",
    ],
    [
      "s = serve(port=0, hostname='127.0.0.1', routes={'/u/:id': lambda r: js.Response('user ' + r.params.id), '/static': js.Response('static'), '/m': {'GET': lambda r: js.Response('get'), 'POST': lambda r: js.Response('post')}}, fetch=lambda r: js.Response('nf', status=404))\nb = f'http://127.0.0.1:{s.port}'\nr = [((await js.fetch(b + p, **k)).status, await (await js.fetch(b + p, **k)).text()) for p, k in (('/u/5', {}), ('/static', {}), ('/m', {}), ('/m', {'method': 'POST'}), ('/zz', {}))]\ns.stop(True)\nr",
      "[(200, 'user 5'), (200, 'static'), (200, 'get'), (200, 'post'), (404, 'nf')]",
    ],
    [
      "async def chunks():\n    for i in range(3):\n        await asyncio.sleep(0.001)\n        yield f'c{i};'\ns = serve(port=0, hostname='127.0.0.1', fetch=lambda r: js.Response(chunks()))\nu = f'http://127.0.0.1:{s.port}/'\nr = await (await js.fetch(u)).text(), b''.join([bytes(c) async for c in (await js.fetch(u)).body])\ns.stop(True)\nr",
      "('c0;c1;c2;', b'c0;c1;c2;')",
    ],
    [
      "class App:\n    def __init__(self): self.hits = 0\n    def fetch(self, request):\n        self.hits += 1\n        return js.Response(str(self.hits))\napp = App()\ns = serve(port=0, hostname='127.0.0.1', fetch=app.fetch)\nr = await (await js.fetch(f'http://127.0.0.1:{s.port}/')).text(), app.hits\ns.stop(True)\nr",
      "('1', 1)",
    ],
    [
      "f = js.FormData()\nf.append('k', 'v')\nf.append('f', js.Blob(['data']), 'n.txt')\nf.get('k'), f.get('f').name, [k for k, v in f], (await get('/x', method='POST', body=f))[0]",
      "('v', 'n.txt', ['k', 'f'], 200)",
    ],
  ],
);

group(
  "WebSocket, TCP",
  {
    setup: `
import js, asyncio
import bun
from bun import serve
loop = asyncio.get_running_loop()
async def until(condition):
    for _ in range(5000):
        if condition(): return
        await asyncio.sleep(0.001)
    raise TimeoutError("the condition never held")
log = []
def fetch(request, server):
    if server.upgrade(request, data={"name": "n1"}): return
    return js.Response("no upgrade", status=400)
def on_open(ws):
    log.append(("open", ws.data["name"], type(ws.data).__name__))
    ws.send("welcome")
def on_message(ws, message):
    log.append(("message", message if isinstance(message, str) else bytes(message)))
    ws.send(message.upper() if isinstance(message, str) else message)
server = serve(port=0, hostname="127.0.0.1", fetch=fetch, websocket={"open": on_open, "message": on_message, "close": lambda ws, code, reason: log.append(("close", code, reason))})
client = js.WebSocket(f"ws://127.0.0.1:{server.port}/")
client.binaryType = "arraybuffer"
queue = asyncio.Queue()
client.onmessage = lambda event: queue.put_nowait(event.data)
opened = loop.create_future()
client.addEventListener("open", lambda event: opened.set_result(event.type))
closed = loop.create_future()
client.onclose = lambda event: closed.set_result((event.code, event.reason))
`,
    teardown: "server.stop(True)\n",
  },
  [
    ["await opened, await queue.get()", "('open', 'welcome')"],
    ["client.send('hello')\nawait queue.get()", "'HELLO'"],
    ["client.send(js.Uint8Array(b'\\x01\\x02'))\nbytes(await queue.get())", "b'\\x01\\x02'"],
    [
      "client.readyState == js.WebSocket.OPEN, (await js.fetch(f'http://127.0.0.1:{server.port}/')).status",
      "(True, 400)",
    ],
    ["client.close(1000, 'bye')\nawait closed", "(1000, 'bye')"],
    [
      "await until(lambda: len(log) == 4)\nlog",
      "[('open', 'n1', 'dict'), ('message', 'hello'), ('message', b'\\x01\\x02'), ('close', 1000, 'bye')]",
    ],
    [
      "seen = []\nclass Handlers:\n    def open(self, s): seen.append('open')\n    def data(self, s, d):\n        seen.append(bytes(d))\n        s.write(bytes(d).upper().decode())\n    def close(self, s, *a): seen.append('close')\nh = Handlers()\nlistener = bun.listen(hostname='127.0.0.1', port=0, socket={'open': h.open, 'data': h.data, 'close': h.close})\ngot = loop.create_future()\nc = await bun.connect(hostname='127.0.0.1', port=listener.port, socket={'open': lambda s: s.write('ping'), 'data': lambda s, d: got.set_result(bytes(d))})\nr = await got\nc.end()\nawait until(lambda: 'close' in seen)\nlistener.stop(True)\nr, seen",
      "(b'PING', ['open', b'ping', 'close'])",
    ],
    [
      "listener = bun.listen(hostname='127.0.0.1', port=0, socket=h)\ngot = loop.create_future()\nc = await bun.connect(hostname='127.0.0.1', port=listener.port, socket={'open': lambda s: s.write('obj'), 'data': lambda s, d: got.set_result(bytes(d))})\nr = await got\nc.end()\nlistener.stop(True)\nr",
      "b'OBJ'",
    ],
  ],
);

group(
  "bun:sqlite, bun:ffi, HTMLRewriter",
  {
    setup: `
import js, os
from bun.sqlite import Database
db = Database(":memory:")
db.run("create table t(id integer primary key, name text, score real, data blob)")
insert = db.prepare("insert into t(name, score, data) values (?, ?, ?)")
`,
    teardown: "db.close()\n",
  },
  [
    [
      "insert.run('a', 1.5, js.Uint8Array(b'\\x00\\x01')).changes, insert.run('b', 2.0, None).lastInsertRowid",
      "(1, 2)",
    ],
    [
      "rows = db.query('select * from t order by id').all()\ntype(rows).__name__, type(rows[0]).__name__, [(r.id, r.name, r.score) for r in rows], bytes(rows[0].data), dict(rows[1])",
      "('list', 'JSObject', [(1, 'a', 1.5), (2, 'b', 2)], b'\\x00\\x01', {'id': 2, 'name': 'b', 'score': 2, 'data': None})",
    ],
    [
      "db.query('select name from t where id = ?').get(2).name, db.query('select name from t where id = $id').get(**{'$id': 1}).name, db.query('select 1 as x where 0').get(), db.query('select id, name from t').values(), [r.name for r in db.query('select name from t').iterate()]",
      "('b', 'a', None, [[1, 'a'], [2, 'b']], ['a', 'b'])",
    ],
    [
      "db.query('select name from t where id = $id').get({'$id': 1}).name",
      "'a'",
      "TypeError: a dict is no object of parameters",
    ],
    ["insert.run('c', 3, b'\\x00\\x01').changes", "1", "TypeError: bytes cannot be bound"],
    [
      "def many(names):\n    for n in names: insert.run(n, 0, None)\n    return len(names)\ndb.transaction(many)(['x', 'y']), db.query('select count(*) as n from t').get().n",
      "(2, 4)",
    ],
    [
      "def failing():\n    insert.run('z', 0, None)\n    raise ValueError('rolled back')\ndb.transaction(failing)()",
      "!ValueError: rolled back",
    ],
    ["db.query('select count(*) as n from t').get().n", "4"],
    [
      "try:\n    db.run('insert into t(id) values (1)')\nexcept Exception as e:\n    r = type(e).__name__, e.value.name, e.value.code, e.value.errno\nr",
      "('JSError', 'SQLiteError', 'SQLITE_CONSTRAINT_PRIMARYKEY', 1555)",
    ],
    ["db.run('nonsense')", '!JSError: SQLiteError: near "nonsense": syntax error'],
    [
      "with Database(':memory:') as other:\n    r = other.query('select 1 as one').get().one\nr",
      "1",
      "what JavaScript can dispose of (Symbol.dispose) is no context manager",
    ],
    [
      "from bun.ffi import dlopen, FFIType, ptr, JSCallback, toArrayBuffer\nlib = dlopen('libc.so.6', {'strlen': {'args': ['cstring'], 'returns': 'usize'}, 'abs': {'args': [FFIType.i32], 'returns': FFIType.i32}, 'getpid': {'args': [], 'returns': 'i32'}, 'qsort': {'args': ['ptr', 'usize', 'usize', 'function'], 'returns': 'void'}})\nlib.symbols.abs(-5), lib.symbols.getpid() == os.getpid(), lib.symbols.strlen(js.TextEncoder().encode('hello\\0'))",
      "(5, True, 5)",
    ],
    [
      "a = js.Int32Array([3, 1, 2])\ndef compare(x, y): return js.Int32Array(toArrayBuffer(x, 0, 4))[0] - js.Int32Array(toArrayBuffer(y, 0, 4))[0]\ncallback = JSCallback(compare, {'args': ['ptr', 'ptr'], 'returns': 'i32'})\nlib.symbols.qsort(ptr(a), 3, 4, callback.ptr)\ncallback.close()\nlib.close()\nlist(a)",
      "[1, 2, 3]",
    ],
    [
      "class Links:\n    def element(self, e):\n        e.setAttribute('href', e.getAttribute('href').upper())\n        e.append('!')\nawait js.HTMLRewriter().on('a', Links()).transform(js.Response('<a href=\"x\">t</a>')).text(), js.HTMLRewriter().on('a', {'element': lambda e: e.remove()}).transform('<p><a>t</a></p>')",
      `('<a href="X">t!</a>', '<p></p>')`,
    ],
  ],
);

// expect() can be called and cannot be constructed, but it looks like a class of the host's, which Python constructs.
script(
  "bun:test from Python",
  {
    "python.test.ts": `import "./tests.py";`,
    "tests.py": `
from bun.test import test, expect
def adds(): expect(1 + 1).toBe(2)
test("adds", adds)
def compares(): expect([1, (2,), {"a": 1}]).toEqual([1, (2,), {"a": 1}])
test("compares", compares)
async def awaits():
    import asyncio
    await asyncio.sleep(0.001)
    expect({"a": 1}).toEqual({"a": 1})
test("awaits", awaits)
`,
  },
  ({ stderr, exitCode }) => {
    expect(stderr).toContain("3 pass");
    expect(exitCode).toBe(0);
  },
  "failing",
  ["test", "python.test.ts"],
);
