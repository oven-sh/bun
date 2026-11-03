"""What translate.py is tried on: a test file in the manner of Lib/test, with a bit of everything it translates."""

import asyncio
import collections
import contextlib
import dataclasses
import enum
import functools
import itertools
import os.path
import pickle
import sys
import unittest
import warnings
from collections import OrderedDict, namedtuple
from fractions import Fraction as F

try:
    import _no_such_module
except ImportError:
    _no_such_module = None

BIG = 2**100
counter = 0


def bump(by=1, *, twice=False):
    """Adds to the counter."""
    global counter
    counter += by * (2 if twice else 1)
    return counter


def logged(function):
    @functools.wraps(function)
    def wrapper(*args, **kwargs):
        wrapper.calls.append((args[1:], kwargs))
        return function(*args, **kwargs)

    wrapper.calls = []
    return wrapper


class Point:
    """A point."""

    dimensions = 2
    __slots__ = ("x", "y")

    def __init__(self, x=0, y=0):
        self.x = x
        self.y = y

    def __eq__(self, other):
        if not isinstance(other, Point):
            return NotImplemented
        return (self.x, self.y) == (other.x, other.y)

    def __hash__(self):
        return hash((self.x, self.y))

    def __add__(self, other):
        return type(self)(self.x + other.x, self.y + other.y)

    def __iter__(self):
        yield self.x
        yield self.y

    def __repr__(self):
        return f"{type(self).__name__}({self.x!r}, {self.y!r})"

    @property
    def norm2(self):
        return self.x**2 + self.y**2

    @classmethod
    def origin(cls):
        return cls()

    @staticmethod
    def parse(text):
        return Point(*map(int, text.split(",")))


class Point3(Point):
    dimensions = Point.dimensions + 1
    __slots__ = ("z",)

    def __init__(self, x=0, y=0, z=0):
        super().__init__(x, y)
        self.z = z

    def __iter__(self):
        yield from super().__iter__()
        yield self.z

    def __repr__(self):
        return super().__repr__()[:-1] + f", {self.z})"


class Color(enum.Enum):
    RED = 1
    GREEN = enum.auto()

    def shout(self):
        return self.name + "!"


@dataclasses.dataclass(order=True)
class Item:
    name: str
    price: float = 1.5
    tags: list = dataclasses.field(default_factory=list)


class Recorder:
    def __init__(self, swallow=()):
        self.events = []
        self.swallow = swallow

    def __enter__(self):
        self.events.append("enter")
        return self

    def __exit__(self, kind, value, traceback):
        self.events.append(("exit", kind and kind.__name__))
        return kind is not None and issubclass(kind, self.swallow)


class SequenceTests:
    """A mixin: the classes below say what it tests."""

    make = None

    def test_length(self):
        self.assertEqual(len(self.make("abc")), 3)

    def test_items(self):
        value = self.make([1, 2, 3])
        self.assertEqual(value[0], 1)
        self.assertEqual(value[-1], 3)
        self.assertEqual(list(value[::-1]), [3, 2, 1])
        self.assertIn(2, value)
        self.assertNotIn(5, value)
        with self.assertRaises(IndexError):
            value[3]


class ListTest(SequenceTests, unittest.TestCase):
    make = list

    def test_mutation(self):
        value = self.make(range(5))
        value[1:3] = ["a"]
        del value[0]
        value += [9]
        value.append(10)
        self.assertEqual(value, ["a", 3, 4, 9, 10])


class TupleTest(SequenceTests, unittest.TestCase):
    make = tuple

    def test_hash(self):
        self.assertEqual(hash(self.make([1, 2])), hash((1, 2)))


class LanguageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = ["class"]

    def setUp(self):
        self.log = []
        self.addCleanup(self.log.clear)

    def test_numbers(self):
        self.assertEqual(BIG + 1, 1267650600228229401496703205377)
        self.assertEqual(7 // 2, 3)
        self.assertEqual(-7 // 2, -4)
        self.assertEqual(7 % -3, -2)
        self.assertEqual(7 / 2, 3.5)
        self.assertEqual(2**-1, 0.5)
        self.assertEqual(divmod(17, 5), (3, 2))
        self.assertEqual((1 << 70) >> 68, 4)
        self.assertEqual(F(1, 3) + F(1, 6), F(1, 2))
        self.assertTrue(1 < 2 <= 2 != 3)
        self.assertFalse(1 < 2 > 3)
        self.assertEqual(repr(1.0 + 1.5), "2.5")
        self.assertEqual(0 or None or "x", "x")
        self.assertEqual([] and 1, [])
        self.assertIs(not [], True)

    def test_strings(self):
        name, width = "world", 8
        self.assertEqual(f"hello {name!r:>{width}}|{3.14159:.2f}|{BIG:x}", "hello  'world'|3.14|10000000000000000000000000")
        self.assertEqual("%s-%03d" % ("a", 7), "a-007")
        self.assertEqual("a,b".split(","), ["a", "b"])
        self.assertEqual("-".join(str(i) for i in range(3)), "0-1-2")
        self.assertEqual(len("a\U0001f600b"), 3)
        self.assertEqual(b"ab\xff"[2], 255)
        self.assertEqual("abc"[::-1], "cba")
        self.assertEqual(f"{True} {None}", "True None")

    def test_containers(self):
        d = {"a": 1, (1, 2): "t", **{"z": 26}}
        self.assertEqual(d[(1, 2)], "t")
        self.assertEqual(list(d), ["a", (1, 2), "z"])
        self.assertEqual({k: v for k, v in d.items() if isinstance(k, str)}, {"a": 1, "z": 26})
        self.assertEqual({x % 3 for x in range(10)}, {0, 1, 2})
        self.assertEqual([(x, y) for x in range(3) for y in range(x)], [(1, 0), (2, 0), (2, 1)])
        first, *middle, last = range(5)
        self.assertEqual((first, middle, last), (0, [1, 2, 3], 4))
        (a, b), c = (1, 2), 3
        a, b = b, a
        self.assertEqual([a, b, c], [2, 1, 3])
        self.assertEqual([*range(2), *"ab"], [0, 1, "a", "b"])
        with self.assertRaises(ValueError):
            a, b = [1, 2, 3]
        with self.assertRaises(KeyError) as caught:
            d["missing"]
        self.assertEqual(caught.exception.args, ("missing",))

    def test_functions(self):
        def f(a, b=2, *args, c, d=4, **kwargs):
            return (a, b, args, c, d, kwargs)

        self.assertEqual(f(1, c=3), (1, 2, (), 3, 4, {}))
        self.assertEqual(f(1, 2, 3, 4, c=5, e=6), (1, 2, (3, 4), 5, 4, {"e": 6}))
        self.assertEqual(f(*[1, 2], **{"c": 3}), (1, 2, (), 3, 4, {}))
        self.assertEqual(f(1, None, c=None), (1, None, (), None, 4, {}))
        with self.assertRaisesRegex(TypeError, "missing 1 required keyword-only argument: 'c'"):
            f(1)
        self.assertEqual(sorted(["b", "A", "c"], key=str.lower, reverse=True), ["c", "b", "A"])
        self.assertEqual(list(map(lambda x, y=10: x + y, [1, 2])), [11, 12])
        adders = [lambda x, n=n: x + n for n in range(3)]
        self.assertEqual([g(10) for g in adders], [10, 11, 12])
        late = [lambda: n for n in range(3)]
        self.assertEqual([g() for g in late], [2, 2, 2])

    def test_globals_and_closures(self):
        global counter
        counter = 0
        self.assertEqual(bump(), 1)
        self.assertEqual(bump(2, twice=True), 5)
        self.assertEqual(counter, 5)
        self.assertEqual(bump.__doc__, "Adds to the counter.")

        def make():
            total = 0

            def add(n):
                nonlocal total
                total += n
                return total

            return add

        add = make()
        add(2)
        self.assertEqual(add(3), 5)

    def test_control_flow(self):
        found = None
        for n in range(2, 10):
            for d in range(2, n):
                if n % d == 0:
                    break
            else:
                if n > 5:
                    found = n
                    break
                continue
        self.assertEqual(found, 7)
        i = 0
        while i < 3:
            i += 1
        else:
            i = -i
        self.assertEqual(i, -3)
        self.assertEqual("yes" if found else "no", "yes")
        if (n := len("abcd")) > 3:
            self.assertEqual(n, 4)

    def test_exceptions(self):
        order = []

        def run(error):
            try:
                order.append("try")
                if error:
                    raise error
            except (KeyError, IndexError) as e:
                order.append(type(e).__name__)
                return "lookup"
            except ValueError:
                order.append("value")
                raise
            else:
                order.append("else")
                return "fine"
            finally:
                order.append("finally")

        self.assertEqual(run(None), "fine")
        self.assertEqual(run(KeyError("k")), "lookup")
        self.assertRaises(ValueError, run, ValueError)
        self.assertRaises(ZeroDivisionError, run, ZeroDivisionError())
        self.assertEqual(order, ["try", "else", "finally", "try", "KeyError", "finally", "try", "value", "finally", "try", "finally"])
        with self.assertRaises(RuntimeError) as caught:
            try:
                1 / 0
            except ZeroDivisionError as e:
                raise RuntimeError("wrapped") from e
        self.assertIsInstance(caught.exception.__cause__, ZeroDivisionError)

    def test_with(self):
        with Recorder() as r, Recorder() as s:
            r.events.append("body")
        self.assertEqual(r.events, ["enter", "body", ("exit", None)])
        self.assertEqual(s.events, ["enter", ("exit", None)])
        with Recorder(swallow=(KeyError,)) as r:
            raise KeyError
        self.assertEqual(r.events[-1], ("exit", "KeyError"))

        def leave():
            for i in range(3):
                with Recorder() as r:
                    if i == 1:
                        return r
            return None

        self.assertEqual(leave().events, ["enter", ("exit", None)])
        with self.assertRaises(TypeError):
            with object():
                pass
        with contextlib.suppress(StopIteration):
            raise StopIteration
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            warnings.warn("careful", DeprecationWarning)
        self.assertEqual([str(w.message) for w in caught], ["careful"])

    def test_generators(self):
        def countdown(n):
            while n:
                received = yield n
                n = received if received is not None else n - 1
            return "done"

        g = countdown(3)
        self.assertEqual(next(g), 3)
        self.assertEqual(g.send(2), 2)
        self.assertEqual(list(g), [1])

        def outer():
            result = yield from countdown(1)
            yield result

        self.assertEqual(list(outer()), [1, "done"])
        g = countdown(5)
        for n in g:
            break
        self.assertEqual(next(g), 4)
        self.assertEqual(list(itertools.islice((x * x for x in itertools.count()), 3)), [0, 1, 4])
        self.assertEqual(sum(x for x in range(4)), 6)

        @contextlib.contextmanager
        def managed(log):
            log.append("in")
            try:
                yield "value"
            finally:
                log.append("out")

        with managed(self.log) as value:
            self.assertEqual(value, "value")
        self.assertEqual(self.log, ["in", "out"])

    def test_classes(self):
        p = Point(1, 2) + Point(3, 4)
        self.assertEqual(p, Point(4, 6))
        self.assertNotEqual(p, 5)
        self.assertEqual(repr(p), "Point(4, 6)")
        self.assertEqual(tuple(p), (4, 6))
        self.assertEqual(p.norm2, 52)
        self.assertEqual(Point.origin(), Point())
        self.assertEqual(Point.parse("5,6"), Point(5, 6))
        self.assertEqual(len({Point(1, 1), Point(1, 1)}), 1)
        self.assertEqual(Point.__doc__, "A point.")
        self.assertEqual(Point.__module__, __name__)
        with self.assertRaises(AttributeError):
            p.w = 1
        q = Point3(1, 2, 3)
        self.assertEqual(repr(q), "Point3(1, 2, 3)")
        self.assertEqual(list(q), [1, 2, 3])
        self.assertEqual(Point3.dimensions, 3)
        self.assertIsInstance(Point3.origin(), Point3)
        self.assertEqual([c.__name__ for c in Point3.__mro__], ["Point3", "Point", "object"])

        class Private:
            def __init__(self):
                self.__secret = 1

            def reveal(self):
                return self.__secret

        self.assertEqual(Private().reveal(), 1)
        self.assertEqual(vars(Private()), {"_Private__secret": 1})

    def test_library_classes(self):
        self.assertEqual(Color.GREEN.value, 2)
        self.assertEqual(Color(1).shout(), "RED!")
        self.assertEqual(list(Color), [Color.RED, Color.GREEN])
        a, b = Item("a"), Item("b", 2.5, ["x"])
        self.assertLess(a, b)
        self.assertEqual(repr(b), "Item(name='b', price=2.5, tags=['x'])")
        self.assertEqual(dataclasses.asdict(a), {"name": "a", "price": 1.5, "tags": []})
        Pair = namedtuple("Pair", "left right")
        self.assertEqual(Pair(1, right=2)._replace(left=0), (0, 2))
        self.assertEqual(OrderedDict(a=1).popitem(), ("a", 1))
        self.assertEqual(collections.Counter("abca").most_common(1), [("a", 2)])
        self.assertEqual(pickle.loads(pickle.dumps(Point3(1, 2, 3))), Point3(1, 2, 3))
        self.assertEqual(os.path.join("a", "b"), "a/b")
        self.assertIsNone(_no_such_module)

    @logged
    def helper(self, a, b=0):
        return a + b

    def test_decorators(self):
        self.assertEqual(self.helper(1, b=2), 3)
        self.assertEqual(type(self).helper.calls[-1], ((1,), {"b": 2}))
        self.assertEqual(type(self).helper.__name__, "helper")

        @functools.lru_cache(maxsize=None)
        def fib(n):
            return n if n < 2 else fib(n - 1) + fib(n - 2)

        self.assertEqual(fib(50), 12586269025)

    def test_subtests(self):
        for value, expected in [(1, 1), (2, 4)]:
            with self.subTest(value=value):
                self.assertEqual(value**2, expected)

    def test_fixtures(self):
        self.assertEqual(self.shared, ["class"])
        self.assertEqual(self.log, [])

    @unittest.skip("on purpose")
    def test_skipped(self):
        self.fail("not run")

    @unittest.skipUnless(sys.maxsize > 1, "never")
    def test_not_skipped(self):
        pass

    def test_skips_itself(self):
        self.skipTest("on second thoughts")

    @unittest.expectedFailure
    def test_expected_failure(self):
        self.assertEqual(1, 2)

    def test_left_out(self):
        self.assertIn("self", locals())


class CoroutineTest(unittest.TestCase):
    def test_run(self):
        async def double(x):
            await asyncio.sleep(0)
            return 2 * x

        async def main():
            results = await asyncio.gather(double(1), double(2))
            task = asyncio.create_task(double(3))
            results.append(await task)
            with self.assertRaises(TimeoutError):
                await asyncio.wait_for(asyncio.sleep(10), 0.001)
            return results

        self.assertEqual(asyncio.run(main()), [2, 4, 6])

    def test_protocol(self):
        async def f():
            return 1

        coroutine = f()
        with self.assertRaises(StopIteration) as caught:
            coroutine.send(None)
        self.assertEqual(caught.exception.value, 1)


class AsyncTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.queue = asyncio.Queue()

    async def test_queue(self):
        await self.queue.put(1)
        self.assertEqual(await self.queue.get(), 1)

    async def test_async_for_and_with(self):
        async def numbers(n):
            for i in range(n):
                await asyncio.sleep(0)
                yield i

        self.assertEqual([i async for i in numbers(3)], [0, 1, 2])
        total = 0
        async for i in numbers(4):
            total += i
        self.assertEqual(total, 6)
        lock = asyncio.Lock()
        async with lock:
            self.assertTrue(lock.locked())
        self.assertFalse(lock.locked())


if __name__ == "__main__":
    unittest.main()
