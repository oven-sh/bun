# A place in a program that reads an attribute remembers what it found. Whatever then changes what the attribute is, in whatever
# order, the place gives what a fresh look would give: the class of the value gets a __get__ or loses it, the value changes its
# class, the object changes its class, the attribute is replaced, hidden by the object's own, found in another base.
import itertools, re


def scenario():
    class Plain:
        def __repr__(self): return "plain"

    class Getter:
        def __repr__(self): return "getter"
        def __get__(self, obj, cls): return "got by Getter(%s)" % ("class" if obj is None else "object")

    class Base:
        pass

    class C(Base):
        pass

    class Other(Base):
        attribute = "of Other"

    value = Plain()
    C.attribute = value
    c = C()

    # The places. Each is a function of its own, so each remembers for itself.
    def of_object(): return c.attribute
    def of_class(): return C.attribute
    def called():
        try:
            return c.attribute()
        except TypeError:
            return "not callable"
    def by_type(): return type(c).attribute
    def by_getattr(): return getattr(c, "attribute")
    places = (of_object, of_class, called, by_type, by_getattr)

    def class_of_value_gets_get():
        Plain.__get__ = lambda self, obj, cls: "got by Plain(%s)" % ("class" if obj is None else "object")
    def class_of_value_gets_set():
        Plain.__set__ = lambda self, obj, v: None
    def value_changes_class():
        value.__class__ = Getter if type(value) is Plain else Plain
    def object_changes_class():
        c.__class__ = Other if type(c) is C else C
    def object_gets_its_own():
        c.__dict__["attribute"] = "the object's own"
    def attribute_is_replaced():
        C.attribute = lambda *a: "a function, called with %d" % len(a)
    def attribute_moves_to_base():
        Base.attribute = C.__dict__["attribute"]
        del C.attribute
    changes = (class_of_value_gets_get, class_of_value_gets_set, value_changes_class, object_changes_class, object_gets_its_own, attribute_is_replaced, attribute_moves_to_base)
    return places, changes


def look(places):
    seen = []
    for place in places:
        for i in range(3):              # The first look remembers, the others go by that.
            try:
                result = re.sub(r" at 0x[0-9a-f]+", "", repr(place()))
            except AttributeError:
                result = "AttributeError"
        seen.append(result)
    return seen


count = len(scenario()[1])
lines = 0
digest = {}
for size in (1, 2, 3, 4):
    for order in itertools.permutations(range(count), size):
        places, changes = scenario()
        history = [look(places)]
        for index in order:
            try:
                changes[index]()
            except (AttributeError, KeyError, TypeError) as e:
                history.append([type(e).__name__])
                continue
            history.append(look(places))
        lines += 1
        digest[order] = history
        if size <= 2:
            print(" ".join(changes[i].__name__ for i in order))
            for seen in history[1:]:
                print("   ", seen)
# The longer ones would fill pages: what they gave is summed up.
import hashlib
for size in (3, 4):
    text = repr(sorted((order, history) for order, history in digest.items() if len(order) == size))
    print(size, "changes:", sum(len(order) == size for order in digest), "orders,", hashlib.sha256(text.encode()).hexdigest()[:16])
