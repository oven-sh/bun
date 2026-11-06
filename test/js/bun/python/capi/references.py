# References, identity, constants and the error indicator of the C API, through a library loaded with ctypes.PyDLL.
import ctypes, gc, sys, weakref
from ctypes import c_char_p, c_double, c_int, c_long, c_uint, py_object

lib = ctypes.PyDLL(sys.argv[1])

def declare(name, restype, *argtypes):
    function = getattr(lib, name)
    function.restype = restype
    function.argtypes = argtypes
    return function

hold = declare("hold", c_long, py_object)
held = declare("held", py_object, c_long)
drop = declare("drop", None, c_long)
count_held = declare("count_held", c_long)
make_and_hold = declare("make_and_hold", c_long, c_long)
count_after_incref = declare("count_after_incref", c_long, py_object)
incref_many = declare("incref_many", None, py_object, c_long)
decref_many = declare("decref_many", None, py_object, c_long)
same = declare("same", c_int, py_object, py_object)
same_by_call = declare("same_by_call", c_int, py_object, py_object)
identity = declare("identity", py_object, py_object)
which_constant = declare("which_constant", c_int, py_object)
constant = declare("constant", py_object, c_uint)
tests_of_constants = declare("tests_of_constants", c_int, py_object)
type_of = declare("type_of", py_object, py_object)
number_of_types = declare("number_of_types", c_long)
name_of_type = declare("name_of_type", c_char_p, c_long)
type_by_symbol = declare("type_by_symbol", py_object, c_long)
type_known_by_symbol = declare("type_known_by_symbol", c_long, py_object)
is_symbol = declare("is_symbol", c_long, py_object)
is_type = declare("is_type", c_int, py_object, py_object)
first_item_is_int_type = declare("first_item_is_int_type", c_int, py_object, c_int)
list_item = declare("list_item", py_object, py_object, c_long)
tuple_item = declare("tuple_item", py_object, py_object, c_long)
list_size = declare("list_size", c_long, py_object)
tuple_size = declare("tuple_size", c_long, py_object)
pair_of = declare("pair_of", py_object, py_object, py_object)
list_of = declare("list_of", py_object, py_object, py_object)
set_list_item = declare("set_list_item", c_int, py_object, c_long, py_object)
set_tuple_item = declare("set_tuple_item", c_int, py_object, c_long, py_object)
long_from = declare("long_from", py_object, c_long)
long_of = declare("long_of", c_long, py_object)
float_from = declare("float_from", py_object, c_double)
float_of = declare("float_of", c_double, py_object)
repr_of = declare("repr_of", py_object, py_object)
repr_of_null = declare("repr_of_null", py_object)
str_from = declare("str_from", py_object, c_char_p)
raise_string = declare("raise_string", py_object, py_object, c_char_p)
raise_object = declare("raise_object", py_object, py_object, py_object)
raise_none = declare("raise_none", py_object, py_object)
raise_by_symbol = declare("raise_by_symbol", py_object, c_int)
raise_with_int_result = declare("raise_with_int_result", c_int)
null_without_exception = declare("null_without_exception", py_object)
set_look_and_clear = declare("set_look_and_clear", py_object, py_object, py_object, py_object)
raise_twice = declare("raise_twice", py_object)
failure_of_the_api = declare("failure_of_the_api", py_object, py_object)
matches = declare("matches", c_int, py_object, py_object)
hold_raised = declare("hold_raised", c_long, py_object, py_object)


class Thing:
    def __init__(self, name): self.name = name
    def __repr__(self): return f"Thing({self.name!r})"


def churn(rounds=3):
    # Enough for the engine to collect by itself, young and old, besides the collections that are asked for.
    for _ in range(rounds):
        junk = [[i, str(i)] for i in range(30000)]
        del junk
        gc.collect()


def attempt(function, *args):
    try:
        return "returned", function(*args)
    except BaseException as e:
        return type(e).__name__, e.args, type(e.__context__).__name__, type(e.__cause__).__name__


print("== what C holds lives")
thing = Thing("a")
ref = weakref.ref(thing)
where = hold(thing)
del thing
churn()
print(ref() is not None, held(where), held(where) is ref())
drop(where)
churn(1)
print(ref())

print("== as many times as it was taken")
thing = Thing("b")
ref = weakref.ref(thing)
incref_many(thing, 1000)
del thing
gc.collect()
print(ref())
decref_many(ref(), 999)
gc.collect()
print(ref())
decref_many(ref(), 1)
gc.collect()
print(ref())

print("== what only C refers to")
places = [make_and_hold(n) for n in (0, 1, 500, 3000)]
churn()
for place in places:
    items = held(place)
    print(len(items), items[:2], items[-1:], all(item == (i * 1000003 * 1000003, f"item {i}", float(i)) for i, item in enumerate(items)),
          {type(part).__name__ for item in items for part in item} == ({"int", "str", "float"} if items else set()))
    del items
for place in places:
    drop(place)
print(count_held())

print("== many at a time, let go in another order")
things = [Thing(i) for i in range(2000)]
refs = [weakref.ref(t) for t in things]
places = [hold(t) for t in things]
del things
churn(1)
print(sum(r() is not None for r in refs))
for place in places[::2]:
    drop(place)
churn(1)
print(sum(r() is not None for r in refs), [r() for r in refs[:4]])
for place in places[1::2]:
    drop(place)
churn(1)
print(sum(r() is not None for r in refs), count_held())

print("== what hangs off what C holds")
outer = {"key": [Thing("inner")]}
ref = weakref.ref(outer["key"][0])
where = hold(outer)
del outer
churn(1)
print(ref(), held(where))
held(where)["key"].clear()
churn(1)
print(ref(), held(where))
drop(where)

print("== the count")
for value in (Thing("c"), [1], {}, object()):
    print(count_after_incref(value))

print("== identity")
thing = Thing("d")
values = [thing, None, True, False, ..., NotImplemented, 0, 1, -1, 2**31, 2**53, 2**64, -2**70, 1.5, 2.0, float("inf"), "", "text", b"", b"bytes", (), (1,), [], {}, set(), int, str, type, object,
          Thing, len, [].append, print, sys, ValueError, ValueError("x"), 3 + 4j, range(3), slice(1, 2), lambda: 0]
print(all(identity(v) is v for v in values), all(same(v, v) for v in values), all(same_by_call(v, v) for v in values))
print(sum(same(a, b) for i, a in enumerate(values) for j, b in enumerate(values) if i != j), sum(same_by_call(a, b) for i, a in enumerate(values) for j, b in enumerate(values) if i != j))
print(all(same(identity(v), v) for v in values))

print("== constants")
print([which_constant(v) for v in (None, False, True, ..., NotImplemented, 0, 1, "", b"", (), 2, "x", [], Thing)])
print([constant(i) for i in range(10)], [constant(i) is v for i, v in enumerate((None, False, True, ..., NotImplemented))])
print(attempt(constant, 10)[0], attempt(constant, 4000000000)[0])
print([tests_of_constants(v) for v in (None, True, False, ..., NotImplemented, 0, 1, "", Thing)])

print("== types")
print(all(type_of(v) is type(v) for v in values))
for i in range(number_of_types()):
    t = type_by_symbol(i)
    print(name_of_type(i).decode(), t.__name__, type(t).__name__, is_symbol(t) == i, same(t, type_by_symbol(i)))
samples = [object(), True, bytearray(), b"", len, 1j, {}, ..., enumerate([]), filter(None, []), 1.0, frozenset(), [], 1, map(len, []), memoryview(b""), sys, property(), range(1), reversed([]),
           set(), slice(1), super(Thing, thing), None, (), int, "", zip(), type.__dict__, {}.keys(), {}.values(), {}.items(), iter({}), iter({}.values()), iter({}.items()),
           reversed({}), reversed({}.values()), reversed({}.items()), iter([]), reversed([1]), iter(()), iter("ሴ"), iter(b""), iter(bytearray()), iter(range(1)), iter(range(2**70)),
           iter(set()), None, iter(int, 1), str.join, dict.fromkeys, str.__add__, type.__dict__["__name__"], None, list[int], weakref.ref(thing), weakref.proxy(thing), weakref.proxy(Thing)]
print([type_known_by_symbol(sample) if sample is not None else None for sample in samples])
print(type_known_by_symbol(thing), type_known_by_symbol(Thing), is_symbol(Thing), is_symbol(thing), is_symbol(None), is_symbol(5))
print(is_type(1, int), is_type(True, int), is_type(thing, Thing), is_type(thing, object), is_type(int, type), is_type(None, type(None)))
print(first_item_is_int_type([int], 1), first_item_is_int_type((int,), 0), first_item_is_int_type([str], 1), first_item_is_int_type((1,), 0))
print(pair_of(int, str), list_of(type, object), pair_of(int, str)[0] is int)

print("== lent and handed over")
items = [Thing("e"), "two", 3, 4.5, None]
print([list_item(items, i) for i in range(5)], list_item(items, 0) is items[0], list_size(items))
print([tuple_item(tuple(items), i) for i in range(5)], tuple_size(tuple(items)), tuple_size(()))
print(attempt(list_item, items, 5), attempt(list_item, items, -1), attempt(tuple_item, (1,), 1), attempt(tuple_item, (1,), -1))
print(attempt(list_item, (1,), 0)[0], attempt(tuple_item, [1], 0)[0], attempt(list_size, {})[0], attempt(tuple_size, "ab")[0])
a, b = Thing("f"), Thing("g")
ra, rb = weakref.ref(a), weakref.ref(b)
pair, both = pair_of(a, b), list_of(b, a)
del a, b
churn(1)
print(pair, both, pair[0] is both[1])
del pair
gc.collect()
print(ra(), rb())
del both
gc.collect()
print(ra(), rb())
target = [1, 2, 3]
c = Thing("h")
rc = weakref.ref(c)
print(set_list_item(target, 1, c), target)
print(attempt(set_list_item, target, 3, c), attempt(set_list_item, target, -1, c), attempt(set_list_item, (1,), 0, c)[0], attempt(set_tuple_item, [1], 0, c)[0])
del c
gc.collect()
print(rc())
target[1] = None
gc.collect()
print(rc())

print("== numbers")
edges = [0, 1, -1, 2**31 - 1, 2**31, -2**31, -2**31 - 1, 2**53 - 1, 2**53, 2**53 + 1, -2**53, -2**53 - 1, 2**62, 2**63 - 1, -2**63]
print([long_from(v) == v and type(long_from(v)) is int for v in edges], [long_of(v) == v for v in edges])
print(long_of(True), attempt(long_of, 2**63), attempt(long_of, -2**63 - 1), attempt(long_of, 1.5), attempt(long_of, "1"), attempt(long_of, None))
class Index:
    def __index__(self): return 42
class BadIndex:
    def __index__(self): raise KeyError("from __index__")
class Int(int): pass
print(long_of(Index()), attempt(long_of, BadIndex()), long_of(Int(7)))
floats = [0.0, -0.0, 1.0, 1.5, -2.0, 1e308, 5e-324, float("inf"), float("-inf"), 2.0**53, 123456789.0]
print([repr(float_from(v)) for v in floats], [type(float_from(v)).__name__ for v in floats[:4]], repr(float_from(float("nan"))))
print([float_of(v) == v for v in floats], float_of(3), float_of(True), float_of(2**70), attempt(float_of, "1"), attempt(float_of, None), attempt(float_of, 10**400))
class Float:
    def __float__(self): return 2.5
print(float_of(Float()), float_of(Index()))
print(repr_of(items), repr_of(None), repr_of(int), repr_of_null(), attempt(repr_of, type("R", (), {"__repr__": lambda self: 1 / 0})()))
print([str_from(t.encode()) == t for t in ("", "ascii", "\xe9", "€", "\U0001f600", "a\U0001f600b")], attempt(str_from, b"\xff"), attempt(str_from, b"\xed\xa0\x80"))

print("== exceptions that C raises")
print(attempt(raise_string, ValueError, b"message"))
print(attempt(raise_string, KeyError, "€".encode()))
print(attempt(raise_string, ValueError, b"\xff")[0])
print(attempt(raise_object, ValueError, "one"), attempt(raise_object, ValueError, ("one", 2)), attempt(raise_object, ValueError, None), attempt(raise_object, ValueError, ()))
print(attempt(raise_object, KeyError, ("a", "b")), attempt(raise_object, OSError, (2, "No such file")), attempt(raise_object, StopIteration, 5))
given = ValueError("given", 1)
try:
    raise_object(ValueError, given)
except ValueError as e:
    print(e is given, e.args)
try:
    raise_object(Exception, given)
except ValueError as e:
    print(e is given)
print(attempt(raise_object, TypeError, given))
print(attempt(raise_none, IndexError), attempt(raise_none, KeyboardInterrupt))
class Mine(Exception):
    def __init__(self, *args): super().__init__("mine", *args)
class Failing(Exception):
    def __init__(self, *args): raise LookupError("in __init__")
print(attempt(raise_object, Mine, 5), attempt(raise_object, Failing, 5), attempt(raise_string, Mine, b"text"))
print(attempt(raise_object, int, 5)[0], attempt(raise_object, 5, 5)[0], attempt(raise_string, Thing, b"x")[0])
print([attempt(raise_by_symbol, i)[:2] for i in range(7)])
print(attempt(raise_with_int_result), attempt(null_without_exception), attempt(raise_twice))
try:
    try:
        1 / 0
    except ZeroDivisionError:
        raise_string(ValueError, b"while handling")
except ValueError as e:
    print(type(e.__context__).__name__, e.__cause__, e.__suppress_context__)
import traceback
def frame_one(): raise_string(ValueError, b"traced")
def frame_two(): frame_one()
try:
    frame_two()
except ValueError as e:
    print([f.name for f in traceback.extract_tb(e.__traceback__)])

print("== what C sees of them")
print(set_look_and_clear(ValueError, "v", ValueError))
print(set_look_and_clear(KeyError, "k", LookupError))
print(set_look_and_clear(KeyError, "k", (TypeError, (ValueError, LookupError))))
print(set_look_and_clear(KeyError, "k", ValueError))
print(repr(failure_of_the_api([1])), failure_of_the_api(list(range(1001))))
cases = [(ValueError("x"), ValueError), (ValueError("x"), Exception), (ValueError("x"), TypeError), (ValueError, ValueError), (ValueError, Exception), (Exception, ValueError),
         (ValueError, (TypeError, ValueError)), (ValueError, ()), (ValueError, ((), ((ValueError,),))), (5, 5), (5, 6), (5, int), (ValueError, 5), ("a", ("b", "a")), (Mine(), Mine), (Mine, Exception)]
print([matches(*case) for case in cases])

print("== an exception that C keeps")
payload = Thing("payload")
ref = weakref.ref(payload)
where = hold_raised(ValueError, payload)
del payload
churn(1)
print(ref(), repr(held(where)))
drop(where)
churn(1)
print(ref(), count_held())
