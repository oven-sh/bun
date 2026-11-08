import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// The modules written against Bun's own libraries: _sqlite3, _hashlib and the hashes, zlib, _zstd. What a program can do to them
// that CPython answers is compared with CPython elsewhere. Here is what CPython crashes on, or has no way to do.

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

async function run(files: Record<string, string>) {
  using dir = tempDir("python-host-modules", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.py"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const lines = (...all: string[]) => all.map(line => line + "\n").join("");
const printed = (...all: string[]) => ({ stdout: lines(...all), stderr: "", exitCode: 0 });

const common = `
import gc, sqlite3

def show(f, *args, **kwargs):
    try:
        print(repr(f(*args, **kwargs)))
    except Exception as e:
        print(type(e).__name__ + ":", e)

def fresh(**kwargs):
    con = sqlite3.connect(":memory:", **kwargs)
    con.execute("create table t(x, y)")
    con.executemany("insert into t values(?, ?)", [(i, str(i)) for i in range(5)])
    con.commit()
    return con
`;

const closed = "ProgrammingError: Cannot operate on a closed database.";

test.concurrent("sqlite3: what a parameter runs while it is bound closes the connection", async () => {
  const result = await run({
    "common.py": common,
    "main.py": `
from common import *

con = fresh()
class Conforms:
    def __conform__(self, protocol):
        con.close()
        return 1
show(con.execute, "select ?, ?", (Conforms(), 2))
show(con.execute, "select 1")

con = fresh()
class Adapted: pass
def adapt(x):
    con.close()
    return 1
sqlite3.register_adapter(Adapted, adapt)
show(con.execute, "select ?, ?", (Adapted(), 2))

con = fresh()
class Named(dict):
    def __missing__(self, key):
        con.close()
        return 1
show(con.execute, "select :a, :b", Named())

con = fresh()
class Exports:
    def __buffer__(self, flags):
        con.close()
        return memoryview(b"abc")
show(con.execute, "select ?, ?", (Exports(), Exports()))

con = fresh()
def rows():
    yield (1, 2)
    con.close()
    yield (3, 4)
show(con.executemany, "insert into t values(?, ?)", rows())
`,
  });
  expect(result).toEqual(printed(closed, closed, closed, closed, closed, closed));
});

test.concurrent("sqlite3: what a statement calls closes the connection", async () => {
  const result = await run({
    "common.py": common,
    "main.py": `
from common import *

def close_and_collect():
    con.close()
    gc.collect()

con = fresh()
def function(x):
    close_and_collect()
    return x
con.create_function("f", 1, function)
del function
show(con.execute, "select sum(f(x)) from t")

con = fresh()
class Aggregate:
    def __init__(self): self.n = 0
    def step(self, x):
        close_and_collect()
        self.n += x
    def finalize(self):
        print("finalize", self.n)
        return self.n
con.create_aggregate("a", 1, Aggregate)
del Aggregate
show(con.execute, "select a(x) from t")

con = fresh()
def collation(a, b):
    close_and_collect()
    return (a > b) - (a < b)
con.create_collation("c", collation)
del collation
show(con.execute, "select y from t order by y collate c desc")

for statement in con.execute, con.__call__:
    con = fresh()
    def authorizer(*args):
        close_and_collect()
        return sqlite3.SQLITE_OK
    con.set_authorizer(authorizer)
    del authorizer
    show(getattr(con, statement.__name__), "select x from t")

con = fresh()
def progress():
    close_and_collect()
    return 0
con.set_progress_handler(progress, 1)
del progress
show(con.execute, "select x from t")

con = fresh()
con.set_trace_callback(lambda statement: close_and_collect())
show(con.execute, "select x from t")

con = fresh()
con.create_function("f", 1, lambda x: close_and_collect() or x)
show(con.executescript, "select sum(f(x)) from t; select f(1); select 2")
`,
  });
  expect(result).toEqual(printed(closed, "finalize 10", closed, closed, closed, closed, closed, closed, closed));
});

test.concurrent("sqlite3: callbacks close the connection under what is not a statement of the program", async () => {
  const result = await run({
    "common.py": common,
    "main.py": `
from common import *

big = fresh()
big.executemany("insert into t values(?, ?)", [(i, "x" * 1000) for i in range(500)])
big.commit()
for which in 0, 1:
    source, target = sqlite3.connect(":memory:"), sqlite3.connect(":memory:")
    big.backup(source)
    show(source.backup, target, pages=1, progress=lambda *args: (source, target)[which].close())

con = fresh()
con.execute("create table b(v)")
con.execute("insert into b values(zeroblob(10))")
con.set_progress_handler(lambda: con.close(), 1)
show(con.blobopen, "b", "v", 1)

con = fresh()
con.set_trace_callback(lambda statement: con.close())
show(con.serialize)

con = fresh()
data = con.serialize()
con.set_trace_callback(lambda statement: con.close())
show(con.deserialize, data)
`,
  });
  expect(result).toEqual(printed(closed, closed, closed, closed, closed));
});

test.concurrent("sqlite3: functions are kept for as long as SQLite may call them", async () => {
  const result = await run({
    "main.py": `
import gc, sqlite3

con = sqlite3.connect(":memory:")
def closer(x):
    con.close()
    return x
def collect(x):
    gc.collect()
    return [bytearray(64) for i in range(10000)] and x
con.create_function("closer", 1, closer)
con.create_function("collect", 1, collect)
# Nothing but the connection refers to these, and they have not been called when it is closed.
called = []
for i in range(20):
    con.create_function(f"f{i}", 1, eval("lambda x: called.append(%d) or x" % i))
try:
    con.execute("select closer(1) + collect(1) + " + " + ".join(f"f{i}(1)" for i in range(20)))
except sqlite3.ProgrammingError as e:
    print(e)
print(called == list(range(20)))
`,
  });
  expect(result).toEqual(printed("Cannot operate on a closed database.", "True"));
});

test.concurrent("sqlite3: the collector does not run finalize() of an aggregate, a safe point does", async () => {
  const result = await run({
    "common.py": common,
    "main.py": `
from common import *

class Window:
    def __init__(self): self.n = 0
    def step(self, x): self.n += x
    def inverse(self, x): self.n -= x
    def value(self): return self.n
    def finalize(self):
        # Allocates, and calls back.
        print("finalize", [str(i) for i in range(3)], con.execute("select 7").fetchone())
        return self.n
query = "select w(x) over (order by x rows between 1 preceding and 1 following) from t"

con = fresh()
con.create_window_function("w", 1, Window)
cursor = con.execute(query)
print(cursor.fetchone())
del cursor
gc.collect()
print("collected")
# The table is no longer being read.
con.execute("drop table t")

# finalize() closes the connection whose statement is being reset.
class Closes(Window):
    def finalize(self):
        print("finalize")
        con.close()
        return 1
con = fresh()
con.create_window_function("w", 1, Closes)
cursor = con.execute(query)
print(cursor.fetchone())
show(cursor.close)
show(con.execute, "select 1")

con = fresh()
con.create_window_function("w", 1, Closes)
cursor = con.execute(query)
print(cursor.fetchone())
del cursor
gc.collect()
show(con.execute, "select 1")
`,
  });
  expect(result).toEqual(
    printed(
      "(1,)",
      "finalize ['0', '1', '2'] (7,)",
      "collected",
      "(1,)",
      "finalize",
      "None",
      closed,
      "(1,)",
      "finalize",
      closed,
    ),
  );
});

test.concurrent("sqlite3: a window that no row has been in", async () => {
  const result = await run({
    "common.py": common,
    "main.py": `
from common import *

class Window:
    def __init__(self): print("__init__")
    def step(self, x): print("step")
    def inverse(self, x): print("inverse")
    def value(self): print("value")
    def finalize(self): print("finalize")
con = fresh()
con.create_window_function("w", 1, Window)
show(con.execute("select w(x) filter (where x > 100) over (order by x rows between 1 preceding and 1 following) from t").fetchall)
show(con.execute("select w(x) filter (where x > 100) over () from t").fetchall)
show(con.execute("select w(x) over (order by x rows between 2 following and 1 following) from t").fetchall)
`,
  });
  const nothing = "[(None,), (None,), (None,), (None,), (None,)]";
  expect(result).toEqual(printed(nothing, nothing, nothing));
});

test.concurrent("sqlite3: a function cannot get at the cursor that is running it", async () => {
  const result = await run({
    "common.py": common,
    "main.py": `
from common import *

for method, args in ("close", ()), ("fetchone", ()), ("execute", ("select 1",)), ("__init__", None):
    con = fresh()
    cursor = con.cursor()
    calls = 0
    def function(x):
        global calls
        calls += 1
        # The first call is made by execute(), the second by fetchall().
        if calls == 2:
            show(getattr(cursor, method), *((con,) if args is None else args))
        return x
    con.create_function("f", 1, function)
    cursor.execute("select f(x) from t")
    show(cursor.fetchall)
`,
  });
  const recursive = "ProgrammingError: Recursive use of cursors not allowed.";
  const rows = "[(0,), (1,), (2,), (3,), (4,)]";
  expect(result).toEqual(printed(recursive, rows, recursive, rows, recursive, rows, recursive, rows));
});

test.concurrent("sqlite3: callbacks that SQLite cannot be entered again from cannot use the connection", async () => {
  const result = await run({
    "common.py": common,
    "main.py": `
from common import *

def attempt():
    global attempts
    attempts += 1
    if attempts > 1:
        return
    # Any of these would pull the schema, or a page, from under what SQLite is doing.
    show(con.deserialize, data)
    show(con.execute, "drop table t")
    show(con.executescript, "detach main")
    show(other.backup, con)
    show(cursor.fetchone)
    show(con.commit)
    # These leave SQLite alone.
    show(lambda: con.in_transaction)
    show(con.set_trace_callback, None)

other = fresh()
def authorizer(*args):
    attempt()
    return sqlite3.SQLITE_OK
def progress():
    attempt()
    return 0
def collation(a, b):
    attempt()
    return (a > b) - (a < b)
for install, order in (
    (lambda: con.set_authorizer(authorizer), "y"),
    (lambda: con.set_progress_handler(progress, 1), "y"),
    (lambda: con.create_collation("c", collation), "y collate c"),
):
    con = fresh()
    data = con.serialize()
    cursor = con.execute("select x from t")
    attempts = 0
    install()
    show(con.execute("select y from t order by " + order + " limit 2").fetchall)
    print(attempts > 1)

con = fresh()
con.set_progress_handler(con.interrupt, 1)
show(lambda: con.execute("select y from t order by y").fetchall())

# While a backup is under way, its target is SQLite's alone, and its source stays what it is.
source, target = fresh(), sqlite3.connect(":memory:")
data = source.serialize()
def progress(status, remaining, total):
    if remaining:
        show(target.execute, "select 1")
        show(source.deserialize, data)
        show(source.execute("select count(*) from t").fetchall)
show(source.backup, target, pages=1, progress=progress)
show(target.execute("select count(*) from t").fetchall)
`,
  });
  const each = (who: string) => [
    ...Array(6).fill(`ProgrammingError: ${who} cannot use the connection that calls it.`),
    "False",
    "None",
    "[('0',), ('1',)]",
    "True",
  ];
  expect(result).toEqual(
    printed(
      ...each("The authorizer callback"),
      ...each("The progress handler"),
      ...each("A collation"),
      "OperationalError: interrupted",
      "ProgrammingError: The target of a backup cannot be used while the backup is under way.",
      "OperationalError: database is locked",
      "[(5,)]",
      "None",
      "[(5,)]",
    ),
  );
});

test.concurrent("sqlite3: callbacks are changed while SQLite has put them aside", async () => {
  const result = await run({
    "main.py": `
import sqlite3

def fresh():
    con = sqlite3.connect(":memory:", autocommit=True)
    con.execute("create table t(x, y)")
    con.execute("create index i on t(x)")
    con.execute("create view v as select x, y from t")
    con.executemany("insert into t values(?, ?)", [(i, str(i)) for i in range(6)])
    return con

# The progress handler does it at its first call, at its second, and so on, until the statement takes fewer calls than that.
def sweep(statement, change):
    at = 0
    while True:
        at += 1
        con = fresh()
        calls = 0
        def progress():
            nonlocal calls
            calls += 1
            if calls == at:
                change(con)
            return 0
        con.set_authorizer(lambda *args: sqlite3.SQLITE_OK)
        con.set_trace_callback(lambda statement: None)
        con.set_progress_handler(progress, 1)
        con.execute(statement)
        con.set_progress_handler(None, 0)
        assert len(con.execute("select y from t").fetchall()) == 6
        if calls < at:
            return at > 100

print(sweep("alter table t rename column x to z", lambda con: con.set_authorizer(None)))
print(sweep("vacuum", lambda con: con.set_trace_callback(None)))

# One that is set meanwhile is there afterwards.
seen = []
def install(con):
    con.set_authorizer(lambda *args: seen.append(args[0]) or sqlite3.SQLITE_OK)
at = 0
while True:
    at += 1
    con = fresh()
    calls = 0
    def progress():
        global calls
        calls += 1
        if calls == at:
            install(con)
        return 0
    con.set_progress_handler(progress, 1)
    con.execute("alter table t rename column x to z")
    con.set_progress_handler(None, 0)
    if calls < at:
        break
    seen.clear()
    con.execute("select 1")
    assert seen == [sqlite3.SQLITE_SELECT], (at, seen)
print("set")
`,
  });
  expect(result).toEqual(printed("True", "True", "set"));
});

test.concurrent("an object is what its class says it is", async () => {
  const result = await run({
    "common.py": common,
    "main.py": `
from common import *
import _csv, _hashlib, io

class Plain: pass
for base in sqlite3.Cursor, sqlite3.Connection, sqlite3.Row, _hashlib.HASH, _hashlib.HASHXOF:
    class Derived(base): pass
    plain = Plain()
    show(setattr, plain, "__class__", Derived)
    print(type(plain).__name__)
for bases in (sqlite3.Row, sqlite3.Cursor), (sqlite3.Connection, sqlite3.Cursor), (_hashlib.HASH, sqlite3.Cursor):
    show(type, "Both", bases, {})

# There is no making the instances of these from Python, nor those of a class derived from them.
for base in _hashlib.HASH, _hashlib.HASHXOF, type(_csv.reader(io.StringIO())):
    class Derived(base): pass
    show(Derived)
    class Derived(base):
        def __init__(self): print("__init__")
    show(Derived)
`,
  });
  const differs = (name: string) => `TypeError: __class__ assignment: '${name}' object layout differs from 'Plain'`;
  const conflict = "TypeError: multiple bases have instance lay-out conflict";
  const cannot = "TypeError: cannot create 'Derived' instances";
  expect(result).toEqual(
    printed(
      ...Array(5)
        .fill([differs("Derived"), "Plain"])
        .flat(),
      conflict,
      conflict,
      conflict,
      ...Array(6).fill(cannot),
    ),
  );
});

test.concurrent("_hashlib: what HASH defines, asked of a SHAKE object", async () => {
  const result = await run({
    "main.py": `
import _hashlib
for name in "shake_128", "shake_256":
    h = _hashlib.new(name, b"abc")
    print(_hashlib.HASH.digest(h).hex(), _hashlib.HASH.hexdigest(h) == h.hexdigest(len(_hashlib.HASH.digest(h))))
    print(_hashlib.HASH.digest_size.__get__(h), h.digest_size)
`,
  });
  expect(result).toEqual(
    printed(
      "5881092dd818bf5cf8a3ddb793fbcba7 True",
      "16 0",
      "483366601360a8771c6863080cc4114d8db44530f8f1e1ee4f94ea37e78b5739 True",
      "32 0",
    ),
  );
});

// A function that has the memory of a typed array holds it: JS gets a copy where it asks for the memory itself.
test.concurrent("the memory of a typed array stays while another argument is converted", async () => {
  const result = await run({
    "helper.js": `
      export function make(size) {
        return new Uint8Array(new ArrayBuffer(size)).fill(7);
      }
      export function detach(array) {
        array.buffer.transfer(0);
        Bun.gc(true);
        // Where the memory was, if it has been freed.
        later.push(new Uint8Array(array.length || 1 << 16).fill(0x5a));
      }
      const later = [];
    `,
    "main.py": `
import zlib, _blake2, _hashlib, _hmac, _zstd
import helper

class Detaches:
    "Stands for a number, or for bytes, and tries to detach the array when it is asked for them."
    def __init__(self, array, value): self.array, self.value = array, value
    def __index__(self):
        helper.detach(self.array)
        return self.value
    def __bool__(self):
        return bool(self.__index__())
    def __buffer__(self, flags):
        helper.detach(self.array)
        return memoryview(self.value)

def case(f, data=None, size=1 << 16):
    array = helper.make(len(data) if data else size)
    if data:
        memoryview(array)[:] = data
    # What the function makes of bytes that hold the same; whether the array is as long as it was; and afterwards it can be detached.
    plain = bytes(array)
    result = f(array, lambda value: Detaches(array, value))
    same = shown(result) == shown(f(plain, lambda value: value))
    attached = len(array) == len(plain)
    helper.detach(array)
    print(type(result).__name__, same, attached, len(array))

def shown(result):
    if isinstance(result, _zstd.ZstdDict): return result.dict_content
    return result.hexdigest() if hasattr(result, "hexdigest") else result

deflated = zlib.compress(bytes(1 << 16))
case(lambda a, d: zlib.compress(a, d(6)))
case(lambda a, d: zlib.compress(a, 6, d(15)))
case(lambda a, d: zlib.decompress(a, d(15)), deflated)
case(lambda a, d: zlib.decompress(a, 15, d(100)), deflated)
case(lambda a, d: zlib.crc32(a, d(0)))
case(lambda a, d: zlib.adler32(a, d(1)))
case(lambda a, d: zlib.decompressobj().decompress(a, d(10)), deflated)
case(lambda a, d: zlib._ZlibDecompressor().decompress(a, d(10)), deflated)
case(lambda a, d: _zstd.ZstdCompressor().compress(a, d(2)))
case(lambda a, d: _zstd.ZstdDecompressor().decompress(a, d(10)), _zstd.ZstdCompressor().compress(bytes(1 << 16), 2))
case(lambda a, d: _zstd.ZstdDict(a, is_raw=d(1)))
case(lambda a, d: _hashlib.pbkdf2_hmac("sha256", a, b"salt", d(1)))
case(lambda a, d: _hashlib.pbkdf2_hmac("sha256", b"password", a, 1, d(16)))
case(lambda a, d: _hashlib.pbkdf2_hmac("blake2s", a, b"salt", d(1)))
case(lambda a, d: _hashlib.scrypt(a, salt=b"salt", n=d(2), r=1, p=1))
case(lambda a, d: _hashlib.scrypt(b"password", salt=a, n=2, r=1, p=1, dklen=d(16)))
case(lambda a, d: _hashlib.hmac_digest(a, d(b"message"), "sha256"))
case(lambda a, d: _hashlib.compare_digest(a, d(bytes(1 << 16))))
case(lambda a, d: _hmac.compute_digest(a, d(b"message"), "sha256"))
case(lambda a, d: _hmac.compute_sha1(a, d(b"message")))
case(lambda a, d: _blake2.blake2b(key=a, fanout=d(1)), size=64)
case(lambda a, d: _blake2.blake2b(salt=a, last_node=d(0)), size=16)
case(lambda a, d: _blake2.blake2s(person=a, depth=d(1)), size=8)
`,
  });
  expect(result).toEqual(
    printed(
      ...[
        ...Array(4).fill("bytes"),
        ...Array(2).fill("int"),
        ...Array(4).fill("bytes"),
        "ZstdDict",
        ...Array(6).fill("bytes"),
        "bool",
        ...Array(2).fill("bytes"),
        ...Array(2).fill("blake2b"),
        "blake2s",
      ].map(type => type + " True True 0"),
    ),
  );
});

test.concurrent("zlib: the dictionary comes back to the object that asks for its buffer", async () => {
  const result = await run({
    "main.py": `
import zlib

words = b"the quick brown fox jumps over the lazy dog " * 4
compressor = zlib.compressobj(zdict=words)
deflated = compressor.compress(words * 50) + compressor.flush()

class Dictionary:
    def __init__(self, method, *args): self.method, self.args = method, args
    def __buffer__(self, flags):
        try:
            getattr(decompressor, self.method)(*self.args)
        except RuntimeError as e:
            print(str(e).split(" <")[0])
        return memoryview(words)

for dictionary in Dictionary("decompress", deflated), Dictionary("flush"), Dictionary("copy"):
    decompressor = zlib.decompressobj(zdict=dictionary)
    print(decompressor.decompress(deflated) == words * 50)
`,
  });
  expect(result).toEqual(printed(...Array(3).fill(["reentrant call inside", "True"]).flat()));
});
