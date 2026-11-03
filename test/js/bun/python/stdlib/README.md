# The tests of Python's standard library, from JavaScript

Each `<module>.test.ts` here is a translation of a file of CPython 3.15's `Lib/test`, by hand, test by test, with the names kept
(`describe("TestDecode")`, `test("test_float")`). The module under test is imported with the `python:` prefix and driven from
TypeScript. The modules are tested in their own language elsewhere (`../cpython-suite`, `../differential`): what these tests are
for is the boundary between the languages.

The head of each file says which file it was translated from, which of its tests, and what was left out and why. In the tests:

- A comment that is not in the original says where JavaScript differs from Python, and there is an `expect()` for it.
- `test.failing(...)` is an assertion of the original that does not hold from JavaScript, with the reason above it. If it
  begins to hold, the test fails and is to be made an ordinary one.
- "there: 20000" marks a size that is smaller here. These tests run in one process, and a debug build is slow.
- A `describe()` at the end ("the buffers of JavaScript", "between the languages") has what the original could not ask.

The standard library that is built into `bun` has no `test` package, so nothing here imports `test.support`.

## How Python is written in JavaScript

`kwargs` and `float` are from `bun:python`; `t`, `b`, `py`, `call`, `with_`, `asyncWith`, `makeClass`, `method`, `createTask`,
`raises`, `raisesAsync` and `warns` from `./helpers`.

### Calls

| Python                   | JavaScript                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `f(1, key=2)`            | `f(1, kwargs({ key: 2 }))`, always last                                               |
| `f(*args, **kw)`         | `f(...args, kwargs(kw))` for an object of JavaScript; `call(f, args, kw)` for a dict  |
| `C(1)`                   | `C(1)` or `new C(1)`                                                                  |
| `lambda x: x + 1`, `def` | an arrow function or a `function`                                                     |
| `def f(*args, **kw)`     | `(...args) => ...`: the keywords, if any were given, are an object, the last argument |
| `def f(a, *, key=None)`  | `(a, { key } = {}) => ...`                                                            |

- A function written in Python drops what JavaScript passes beyond its parameters, so `array.map(f)` works. What takes `*args`
  takes it all, and so do classes and functions written in C++: `array.map(str)` is `str(item, index, array)`, a `TypeError`.
  Write `array.map(x => str(x))`.
- A function of JavaScript takes whatever Python passes it. Where a test expects a `TypeError` for too many arguments, there is none.
- A method taken off its object stays bound: `const append = d.append`.

### Values

| Python                  | JavaScript                         |                                                                                                           |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `None`                  | `undefined`                        | `null` is `None` too when it goes in. What comes out is `undefined`: `toBeUndefined()`, not `toBeNull()`. |
| `True`, `False`         | `true`, `false`                    |                                                                                                           |
| `5`                     | `5`                                |                                                                                                           |
| `2**64`                 | `2n ** 64n`                        | An int beyond 2\*\*53 is a BigInt, below it a number, whichever went in: `5n` comes back as `5`.          |
| `1.5`                   | `1.5`                              |                                                                                                           |
| `2.0`                   | `float(2)`                         | A whole number is an int to Python. See below.                                                            |
| `"abc"`                 | `"abc"`                            |                                                                                                           |
| `b"abc\xff"`            | `b("abc\xff")`                     |                                                                                                           |
| `[1, 2]`                | `[1, 2]`                           | The same object in both languages.                                                                        |
| `(1, 2)`                | `t(1, 2)`                          | An array will do wherever Python only iterates or unpacks.                                                |
| `{"a": 1}`              | `py({ a: 1 })`                     | An object of JavaScript is no dict: `json.dumps({ a: 1 })` is a `TypeError`.                              |
| `{1: "a", (1, 2): "b"}` | `dict([[1, "a"], [t(1, 2), "b"]])` | or `py(new Map(...))`                                                                                     |
| `{1, 2}`                | `set([1, 2])`                      |                                                                                                           |
| `1 + 2j`                | `complex(1, 2)`                    |                                                                                                           |
| `...`                   | `Ellipsis`                         |                                                                                                           |
| `r"\d+"`                | ``String.raw`\d+` ``               |                                                                                                           |

**Numbers.**

- `math.factorial(20) + 1` throws in JavaScript: a BigInt and a number do not add. A method written in JavaScript that computes
  with ints of any size has to make them all BigInts first (`bisect.test.ts`, `Range`).
- The arithmetic of JavaScript does not grow into big ints: `x * y` beyond 2\*\*53 is a number, which is a _float_ to Python.
- A whole float that a call or an operator gives JavaScript is a number, and an int when it goes back: `type(math.sqrt(4))` is
  `int`. Inside a container it stays what it is, and JavaScript sees an object: of `json.loads("[1.0]")[0]`, `typeof` is
  `"object"`, `=== 1` is false, `== 1` true, `+ 1` is 2. `array.includes(1)` does not find it. `Number(x)` makes a number of it.
  The same goes for a NaN that Python made. `toEqual([1])` holds.
- `-0` is a float: `range(-i)` is a `TypeError` when `i` is 0. Write `0 - i`.

**Strings.** `len("a😀b")` is 3 and `"a😀b".length` 4. What Python gives for a position (`m.start()`, `s.find()`) counts
characters: use it with `getitem(s, i)` or `[...s][i]`, not with `s[i]`.

**The methods of lists, strings and numbers** are those of JavaScript, because they are values of JavaScript. Python's are on
the types: `list.sort(a)`, `list.index(a, x)`, `str.partition(s, ",")`, `int.bit_length(5)`, `getattr("", "join")`.
`a.sort()` is JavaScript's, which compares strings.

### Syntax that JavaScript lacks

| Python                              | JavaScript                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `x[key]`                            | `x[0]`, `x.name` for an index that is not negative and for a str key of a mapping; `getitem(x, key)` for anything |
| `x[key] = v`, `del x[key]`          | the same, `delete x[0]`; `setitem(x, key, v)`, `delitem(x, key)`                                                  |
| `x[-1]`                             | `getitem(x, -1)`: `x[-1]` is `undefined`, as for an array                                                         |
| `x[1:3]`, `x[::-1]`                 | `getitem(x, slice(1, 3))`, `getitem(x, slice(None, None, -1))`; for a list or str, `x.slice(1, 3)`                |
| `a in x`                            | `contains(x, a)`. `a in x` asks for a key or an index.                                                            |
| `len(x)`                            | `len(x)` or `x.length`                                                                                            |
| `a // b`, `divmod`                  | `floordiv(a, b)`                                                                                                  |
| `+a`                                | `pos(a)`: `+a` makes a number                                                                                     |
| `a += b`                            | `a = iadd(a, b)`: `a += b` is `a = a + b`, which makes a new object and may not be defined                        |
| `a is b`                            | `a === b`, `toBe`                                                                                                 |
| `a == b`                            | `a == b` if one of them is an object of Python's; `eq(a, b)` for two lists                                        |
| `not x`, `if x:`                    | `!bool(x)`: every object is true to JavaScript, an empty dict too                                                 |
| `with cm as v: ...`                 | `with_(cm, v => { ... })`                                                                                         |
| `async with cm as v: ...`           | `await asyncWith(cm, async v => { ... })`                                                                         |
| `for k, v in d.items():`            | `for (const [k, v] of d.items())`, or `of d`: a dict iterates as a `Map` does                                     |
| `[f(x) for x in it]`                | `Array.from(it, f)`                                                                                               |
| `yield`                             | `function*`: a generator of JavaScript is a generator to Python (`next`, `send`, `throw`, `close`)                |
| `class C(Base): def m(self): ...`   | `makeClass("C", [Base], { m() { ... } })`: `this` is `self`. `class extends` is a `TypeError`.                    |
| `namespace={"m": lambda self: ...}` | `py({ m: method(function () { ... }) })`: Python binds no function of JavaScript                                  |
| `@dataclass class C: x: int`        | `make_dataclass("C", [["x", int]])`                                                                               |
| `raise E("x")`                      | `throw new E("x")`                                                                                                |
| `try: ... except E as e:`           | `catch (e) { if (!(e instanceof E)) throw e; ... }`                                                               |
| `f"{x!r}"`, `"%r" % x`              | `` `${repr(x)}` ``                                                                                                |
| `eval(repr(x))`                     | `pyeval(repr(x), py({ deque }))`, with `import { eval as pyeval }`                                                |

**Operators** on objects of Python's ask their classes: `Fraction(1, 2) + 1`, `date2 - date1`, `a < b`, `s1 | s2`, `-x`,
`2 ** x`. On two arrays they are JavaScript's: `[1] + [2]` is `"12"`, `[10] < [9]` is true. Use `operator.add`, `operator.lt`.
Where neither class has an answer, Python raises a `TypeError` and JavaScript goes on as with any object:
`timedelta(1) + 1` is the string `"1 day, 0:00:001"`. A test of such a `TypeError` calls `operator.add`.

**Mappings.** A property of a mapping is an item first and an attribute second, so `d.get` is the item if there is a key `"get"`;
`dict.get(d, key)` is safe. Assigning to a property always sets an item: for an attribute (`defaultdict.default_factory`),
`setattr`. A key that looks like a number is an int: `d["3"] = x` sets `d[3]`. Reading a property does not call `__missing__`.

### Bytes

`bytes`, `bytearray` and `memoryview` are objects of Python's with `length`, indices and iteration:
`new Uint8Array(x)`, `Buffer.from(x)` and `[...x]` copy them. A `Uint8Array`, a `Buffer`, an `ArrayBuffer` and a `DataView` are
buffers to Python: whatever takes "a bytes-like object" reads them, and `struct.pack_into` writes to them. They are not `bytes`:
what asks `isinstance(x, (bytes, bytearray))`, as `json.loads` does, refuses them. `bytes(array)` copies.

### Exceptions

An exception of Python's is an `Error` (`instanceof Error`), with `name` (the name of the class), `message` (`str(e)`) and
`stack` (the traceback), besides its attributes (`e.args`, `e.lineno`, `e.__notes__`).

| unittest                             | bun:test                                               |
| ------------------------------------ | ------------------------------------------------------ |
| `assertRaises(E, f, x)`              | `expect(() => f(x)).toThrow(E)`, which is `isinstance` |
| `with assertRaises(E) as cm:`        | `const e = raises(E, () => { ... })`                   |
| `assertRaises((E1, E2), ...)`        | `raises([E1, E2], () => ...)`                          |
| `assertRaisesRegex(E, pattern, ...)` | `raises(E, () => ..., /pattern/)`                      |
| `assertWarns(W)`                     | `expect(warns(W, () => ...)).toHaveLength(1)`          |

What JavaScript throws goes through Python unchanged and comes out as it was thrown. In Python it is a `JSError`, an
`Exception`: `except TypeError` does not catch a `TypeError` of JavaScript's, nor is Python's `TypeError` an instance of
JavaScript's. Import it as `TypeError as PyTypeError`. Where Python hands such an exception over as a value and does not raise it
(`gather(return_exceptions=True)`, `task.exception()`), JavaScript sees the `JSError`, and what was thrown is its `value`.

### Assertions

| unittest                  | bun:test                                                                   |
| ------------------------- | -------------------------------------------------------------------------- |
| `assertEqual(a, b)`       | `expect(a).toEqual(b)`; `toBe` for numbers, strings and booleans           |
| `assertIs(a, b)`          | `expect(a).toBe(b)`                                                        |
| `assertIsNone(a)`         | `expect(a).toBeUndefined()`                                                |
| `assertTrue(a)`           | `expect(bool(a)).toBe(true)`, or `expect(a).toBe(true)` where it is a bool |
| `assertIn(a, b)`          | `expect(contains(b, a)).toBe(true)`                                        |
| `assertIsInstance(a, C)`  | `expect(a).toBeInstanceOf(C)`, numbers and strings too                     |
| `assertGreater(a, b)`     | `expect(a > b).toBe(true)`: `toBeGreaterThan` is for numbers               |
| `assertAlmostEqual(a, b)` | `expect(a).toBeCloseTo(b, 7)`                                              |
| `subTest`                 | a loop                                                                     |

`toEqual` on two objects of Python's, or one and a number or string, is Python's `==`. So
`expect(Decimal("1.50")).toEqual(Decimal("1.5"))` holds, two sets are compared as sets, and two instances of a class without
`__eq__` are equal only if they are one. Against an object of JavaScript, as `toEqual` takes an instance of a class for equal to
an object literal with the same properties:

- a tuple equals an array with equal items,
- a dict all of whose keys are strings (or ints) equals an object with equal properties,
- an instance equals an object with its attributes,
- `bytes` and a `bytearray` equal a `Uint8Array` with the same bytes,
- an array equals what says so itself (`UserList`),

and nothing else does. `toStrictEqual` wants the same type on both sides. A failure shows `repr()`.

### Showing

`String(x)` and `` `${x}` `` are `str(x)`; `console.log(x)`, `Bun.inspect(x)` and `util.inspect(x)` are `repr(x)`.
`JSON.stringify` makes an array of what has a length and can be iterated over (tuple, set, deque, bytes), an object of a mapping
(leaving out the keys whose value is `None`, which is `undefined`) and of an instance (its attributes). Of what has neither
(`date`) it makes `{}`.

### Async

An `async def` called from JavaScript gives a promise, and is under way as a task of the loop that Bun's event loop runs.
`await`, `Promise.all` and `for await` work as on anything of JavaScript's, and Python awaits a promise or an async function of
JavaScript's. Anything awaitable (a `Future`, a `Task`) can be awaited. For what JavaScript calls, that loop is the running loop:
`asyncio.gather()`, `ensure_future()`, `Future()`, `get_running_loop()`.

| Python                                                   | JavaScript                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `await coro()`, `await future`                           | the same                                                                  |
| `t = asyncio.create_task(q.get())`                       | `t = asyncio.ensure_future(q.get())`                                      |
| `tg.create_task(worker())`                               | `createTask(tg, worker())`                                                |
| `await asyncio.wait_for(q.get(), 1)`, `gather(a(), b())` | the same, with promises of either language                                |
| `async with asyncio.timeout(1): await f()`               | `await asyncWith(asyncio.timeout(1), () => f())`                          |
| `with assertRaises(TimeoutError): await f()`             | `await raisesAsync(TimeoutError, () => f())`                              |
| `await asyncio.sleep(0)`, to let a task take a step      | `await until(() => ...)`: a step of an async function takes several turns |

- Because the call gives a promise, JavaScript never holds a coroutine, and `create_task()` refuses a promise.
- The promise of a coroutine is awaited by Python as the task it is. So to cancel what waits for it cancels the coroutine:
  `ensure_future(q.get()).cancel()`, `wait_for(q.get(), 1)`.
- Nothing cancels an async function of JavaScript. What is cancelled is the waiting for it, and it goes on. So the body of an
  `asyncWith(asyncio.timeout(...))` should return what it would await, not await it.
- Behind the first `await` of an async function of JavaScript, `asyncio.current_task()` is `None`.

## What is in `helpers.py`

A function there is something JavaScript has no way to say: `with`, `async with`, a class with methods, catching warnings,
`f(**dict)`. That a few lines of Python beside the program can supply it, imported like any module, is an idiom too.
