# Who owns a reference where ctypes and C meet, and what C may conclude from a count or an address.
import _ctypes, ctypes, gc, re, sys, weakref
from ctypes import PYFUNCTYPE, Structure, c_char_p, c_int, c_long, py_object


# Written before anything has been loaded, and read by C afterwards.
class Holder(Structure):
    _fields_ = [("object", py_object)]


early = py_object(int)
early_in_a_structure = Holder(int)
early_in_an_array = (py_object * 2)(str, int)

lib = ctypes.PyDLL(sys.argv[1])


def declare(name, restype, *argtypes):
    function = getattr(lib, name)
    function.restype = restype
    function.argtypes = argtypes
    return function


def attempt(function, *args):
    try:
        return function(*args)
    except BaseException as e:
        return re.sub(r"\S+\.c:\d+: ", "", f"{type(e).__name__}: {e}")


is_int_type = declare("is_int_type", c_int, py_object)
print("the first call of all:", is_int_type(int))
print("and the second:", is_int_type(int), is_int_type(str), is_int_type(bool))
print("written early:", is_int_type(early), is_int_type(early_in_a_structure.object), is_int_type(early_in_an_array[1]), is_int_type(early_in_an_array[0]))
print("read back:", early.value is int, early_in_a_structure.object is int, early_in_an_array[1] is int, early_in_an_array[0] is str)
print("written late:", is_int_type(py_object(int)), is_int_type(Holder(int).object))

count = declare("count", c_long, py_object)
hold = declare("hold", None, py_object)
peek = declare("peek", py_object)
drop = declare("drop", None)
give_back = declare("give_back", None, py_object)
own_the_empty_bytes = declare("own_the_empty_bytes", None)
MAKES = PYFUNCTYPE(py_object)
keep_result_of = declare("keep_result_of", None, MAKES)
give_kept = declare("give_kept", py_object)
set_item = declare("set_item", c_int, py_object, c_long, py_object)
LOOKS = PYFUNCTYPE(None, py_object)
tuple_changed_after_a_look = declare("tuple_changed_after_a_look", py_object, LOOKS, py_object, py_object)
set_item_of_a_tuple_owned_twice = declare("set_item_of_a_tuple_owned_twice", c_int, py_object)
make_tuple_and_keep_it = declare("make_tuple_and_keep_it", py_object, py_object)
put_tuple_into_list_and_keep_it = declare("put_tuple_into_list_and_keep_it", py_object, py_object)
put_tuple_into_tuple_and_keep_it = declare("put_tuple_into_tuple_and_keep_it", py_object, py_object)
set_item_of_kept_tuple = declare("set_item_of_kept_tuple", c_int, py_object)
give_back_kept_tuple = declare("give_back_kept_tuple", None)
fill_tuple_that_a_tuple_has_taken_over = declare("fill_tuple_that_a_tuple_has_taken_over", py_object, py_object)
fill_tuples_that_a_list_has_taken_over = declare("fill_tuples_that_a_list_has_taken_over", py_object, c_long)
fill_tuple_that_was_appended = declare("fill_tuple_that_was_appended", py_object, py_object, c_int)
fill_tuple_that_two_lists_have = declare("fill_tuple_that_two_lists_have", py_object, py_object)
list_of_floats = declare("list_of_floats", py_object, c_long)
raise_object = declare("raise_object", None, py_object, py_object)
raise_string = declare("raise_string", None, py_object, c_char_p)
raise_none = declare("raise_none", None, py_object)
raise_and_return = declare("raise_and_return", py_object, py_object, py_object)
raise_and_return_what_is_no_object = declare("raise_and_return_what_is_no_object", py_object, py_object)


class Thing:
    def __init__(self, name):
        self.name = name


print("--- a count says nothing of who else refers to the object, so it never says that nobody does")
shared = [1, 2, 3]
also = shared
inside = [shared]
print(count(shared) > 1, count(Thing("fresh")) > 1, count(object()) > 1, count("a str " + str(len(sys.argv))) > 1)

print("--- and it follows what C takes and gives back")
thing = Thing("the one C owns")
base = count(thing)
hold(thing)
print(count(thing) - base)
print(peek() is thing, count(thing) - base)

print("--- a prototype over a function of Python's, called from Python, leaves the count as it was")
identity = PYFUNCTYPE(py_object, py_object)(lambda x: x)
for i in range(3):
    print(identity(thing) is thing, count(thing) - base)
ref = weakref.ref(thing)
del thing
gc.collect()
junk = [Thing("junk") for i in range(10000)]
print(ref() is not None, peek().name)
drop()
gc.collect()
print(ref())

print("--- what a callback returns is C's")
refs = []


def make():
    made = Thing("made in a callback")
    refs.append(weakref.ref(made))
    return made


callback = MAKES(make)
keep_result_of(callback)
for i in range(3):
    gc.collect()
junk = [Thing("junk") for i in range(10000)]
print(refs[0]() is not None)
print(give_kept().name)
gc.collect()
print(refs[0]())

print("--- ctypes' own functions hand over no reference")
own_the_empty_bytes()
base = count(b"")
print(ctypes.string_at(c_char_p(b"x"), 0), count(b"") - base)
print(ctypes.wstring_at(ctypes.c_wchar_p("x"), 0) == "", count(b"") - base)
number = c_int(5)
print(ctypes.cast(ctypes.pointer(number), ctypes.POINTER(c_int)).contents.value)
drop()

print("--- _ctypes.Py_INCREF and Py_DECREF count as C does")
thing = Thing("counted")
base = count(thing)
_ctypes.Py_INCREF(thing)
print(count(thing) - base)
hold(thing)
print(count(thing) - base)
_ctypes.Py_DECREF(thing)
print(count(thing) - base)
_ctypes.Py_INCREF(thing)
drop()
ref = weakref.ref(thing)
del thing
gc.collect()
print(ref() is not None)
give_back(ref())
gc.collect()
print(ref())
_ctypes.Py_INCREF(int)
_ctypes.Py_DECREF(int)
_ctypes.Py_INCREF(5)
_ctypes.Py_DECREF(5)

print("--- C fills a tuple that it has made and that it alone has")


def constant():
    return (1, 2, 3)


print(attempt(set_item, constant(), 0, 99), constant())
made = tuple([1, 2, len(sys.argv)])
print(attempt(set_item, made, 0, 99), made)
print(attempt(set_item, (), 0, 99))
print(attempt(set_item_of_a_tuple_owned_twice, 99))
hashes = []
changed = tuple_changed_after_a_look(LOOKS(lambda t: hashes.append((hash(t), t == (4,)))), 4, 5)
print(changed, hashes == [(hash((4,)), True)])
print(attempt(set_item, changed, 0, 99), changed)
# To take a reference and give it back is not to keep it.
print(tuple_changed_after_a_look(LOOKS(lambda t: _ctypes.Py_DECREF(_ctypes.Py_INCREF(t)) and None), 4, 5))
# What C has given away it fills no longer, though it owns one reference again.
for give in (make_tuple_and_keep_it, lambda item: put_tuple_into_list_and_keep_it(item)[0], lambda item: put_tuple_into_tuple_and_keep_it(item)[0]):
    given = give(4)
    found = {given: "found"}
    print(attempt(set_item_of_kept_tuple, 5), given, found.get(given), found.get((4,)), found.get((5,)), list(found))
    give_back_kept_tuple()
# The one reference may be a container's.
print(attempt(fill_tuple_that_a_tuple_has_taken_over, 7))
print(attempt(fill_tuples_that_a_list_has_taken_over, 3))
print(attempt(fill_tuple_that_was_appended, 7, True))
print(attempt(fill_tuple_that_was_appended, 7, False))
print(attempt(fill_tuple_that_two_lists_have, 7))

print("--- lists")
print(list_of_floats(0), list_of_floats(3), len(list_of_floats(100000)), list_of_floats(100000)[-1])
print(attempt(list_of_floats, -1))
print(attempt(list_of_floats, sys.maxsize))

print("--- a class of exceptions that makes something else")
for what in (5, [1, 2, 3], "abc", None, object, KeyError("another exception"), SystemExit(3)):

    class Weird(Exception):
        def __new__(cls, *args):
            return what() if what is object else what

    for raises, args in ((raise_object, ("x",)), (raise_object, (("x", "y"),)), (raise_object, (None,)), (raise_string, (b"text",)), (raise_none, ())):
        print(" ", attempt(raises, Weird, *args).replace(" object at 0x", " object at ").split(" at ")[0])


class Fails(Exception):
    def __init__(self, *args):
        raise LookupError(f"in __init__ {args}")


print(attempt(raise_object, Fails, "x"), "|", attempt(raise_string, Fails, b"text"), "|", attempt(raise_none, Fails))
print(attempt(raise_object, 5, "x"), "|", attempt(raise_object, int, "x"))

print("--- what C raised is raised, whatever it returned, and by the call that raised it")
print(attempt(raise_and_return, KeyError, [1]), "|", count([1]) > 1)
print(attempt(raise_and_return_what_is_no_object, KeyError))
print("done")
