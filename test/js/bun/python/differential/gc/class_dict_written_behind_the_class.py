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


# What a class remembers of a name that was looked up in it, while no other name takes the place of that one. A collection of what is
# new alone frees what was made since the last collection, and nothing else.
def collect(generation):
    junk = None
    for i in range(100000):
        junk = [junk and None, (i,), {i: i}, lambda: i]
    gc.collect(generation)


def remembered(generation):
    class Base:
        pass

    class Derived(Base):
        pass

    derived = Derived()

    def by_name(allowed):
        results = []
        for of in (derived, Derived, Base):
            found = getattr(of, "method", None)
            results.append(AttributeError if found is None else found(None) if isinstance(of, type) else found())
        print("getattr() gives one of", allowed, ":", [result in allowed for result in results])

    by_name((AttributeError,))
    dict_of(Base)["method"] = make("first")
    collect(generation)
    by_name((AttributeError, "first"))
    Base.method = make("old")
    by_name(("old",))
    for turn in range(5):
        dict_of(Base)["method"] = make(turn)
        collect(generation)
        by_name(("old",) + tuple(range(turn + 1)))
    del dict_of(Base)["method"]
    collect(generation)
    by_name(("old", 0, 1, 2, 3, 4, AttributeError))

    # What is remembered has been through a collection before it is let go of.
    Base.method = make("kept")
    by_name(("kept",))
    collect(generation)
    by_name(("kept",))
    del dict_of(Base)["method"]
    for again in (generation, generation, 2):
        collect(again)
        by_name(("kept", AttributeError))


for generation in (2, 0, 1):
    remembered(generation)
