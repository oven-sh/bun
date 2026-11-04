# gc.get_referents(C.__dict__) gives the dict itself of a class, which C.__dict__ only shows. Whoever writes to it does so behind
# the back of the class. CPython 3.15 ends with a segmentation fault here, so nothing can rely on what this gives, and a place in
# the program may go on giving what it remembers for as long as that exists. But nothing may be read from memory that has been
# given back: such a place used to call what was no longer there.
import gc


def dict_of(cls):
    return [o for o in gc.get_referents(cls.__dict__) if type(o) is dict][0]


def forget(obj):
    for i in range(5000):               # Other names take the places in which the class remembers what was looked up in it.
        getattr(obj, "n%d" % i, None)
    junk = None
    for i in range(100000):             # And other objects the place of the value.
        junk = [junk and None, (i,), {i: i}, lambda: i]
    gc.collect()


class C:
    pass


def make(result):
    def method(self): return result
    return method


C.method = make("old")
c = C()


def call_method(): return c.method()
def read_of_object(): return c.method.__func__(None)
def read_of_class(): return C.method(None)


places = (call_method, read_of_object, read_of_class)


def look(allowed):
    for place in places:
        try:
            result = place()
        except AttributeError:
            result = AttributeError
        print(place.__name__, "gives one of", allowed, ":", result in allowed)


for i in range(100):
    for place in places:
        place()
look(("old",))
dict_of(C)["method"] = make("new")
forget(c)
look(("old", "new"))
del dict_of(C)["method"]
forget(c)
look(("old", "new", AttributeError))


# A built-in class, which cannot be changed in any other way.
def swap(): return "aB".swapcase()


for i in range(100):
    swap()
print(swap())
dict_of(str)["swapcase"] = lambda self: "replaced"
forget("")
print(swap() in ("Ab", "replaced"))
