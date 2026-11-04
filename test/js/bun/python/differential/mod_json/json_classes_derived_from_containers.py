# What json.dumps() writes for an instance of a class derived from list, tuple or dict: what iterating over it, or its items(), gives.
import collections, json


class Both(collections.UserList, list):     # as django.forms.utils.ErrorList: the list itself stays empty
    pass


class OtherItems(list):
    def __iter__(self):
        return iter([1, 2])


class NoLength(list):
    def __len__(self):
        return 0


class OtherItemsOfTuple(tuple):
    def __iter__(self):
        return iter([1, 2])


class Generated(list):
    def __iter__(self):
        yield "a"
        yield [OtherItems()]


class Failing(list):
    def __iter__(self):
        yield 1
        raise KeyError("while iterating")


class NotIterable(list):
    __iter__ = None


class Growing(list):
    def __iter__(self):
        self.append(len(self))
        return super().__iter__()


class OtherPairs(dict):
    def items(self):
        return [("k", 1)]


class OtherKeys(dict):
    def __iter__(self):
        return iter(["z"])

    def keys(self):
        return ["z"]

    def __getitem__(self, key):
        return 5


Point = collections.namedtuple("Point", "x y")

values = [Both([1, 2]), Both(), OtherItems(), OtherItems([9]), NoLength([1]), OtherItemsOfTuple(), OtherItemsOfTuple([9]), Generated(), Failing(), NotIterable([1]),
          Growing(), OtherPairs(), OtherPairs(a=1), OtherKeys(), OtherKeys(a=1), {"x": Both([3])}, [Both([4]), (Both([5]),)], Point(1, Both([6])),
          collections.OrderedDict(b=OtherItems()), collections.defaultdict(list, a=Both([7])), collections.Counter("aab")]
for value in values:
    for options in ({}, {"indent": 1}, {"sort_keys": True}, {"check_circular": False}, {"separators": (",", ":")}):
        for encode in (json.dumps, lambda v, **kw: "".join(json.JSONEncoder(**kw).iterencode(v))):
            try:
                print(type(value).__name__, options, encode(value, **options).replace("\n", "|"))
            except Exception as e:
                print(type(value).__name__, options, type(e).__name__, e, getattr(e, "__notes__", None))

# A cycle is known by the object, not by the copy that is written.
cycle = OtherItems()
cycle.__class__.__iter__ = lambda self: iter([self])
try:
    json.dumps(cycle)
except ValueError as e:
    print(type(e).__name__, e)
