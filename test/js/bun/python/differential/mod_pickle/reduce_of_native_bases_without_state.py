# object.__reduce_ex__() for a class derived from a type written in C whose instances hold nothing of their own.
import copy, datetime, pickle

class Zone(datetime.tzinfo):
    def __init__(self, name=None, seconds=0):
        self.name = name
        self.offset = datetime.timedelta(seconds=seconds)
    def utcoffset(self, when):
        return self.offset
    __reduce__ = object.__reduce__      # As dateutil's zones have it.

zone = Zone("x", 3600)
for protocol in range(pickle.HIGHEST_PROTOCOL + 1):
    print(protocol, sorted(pickle.loads(pickle.dumps(zone, protocol)).__dict__.items()))
print(object.__reduce_ex__(zone, 2)[1:])
print(object.__reduce_ex__(zone, 0)[0].__name__, object.__reduce_ex__(zone, 0)[1][:2])
print(copy.copy(zone).name, copy.deepcopy(zone).offset)
when = datetime.datetime(2020, 1, 2, 3, 4, 5, tzinfo=zone)
print(pickle.loads(pickle.dumps(when)).utcoffset())

class Slotted(datetime.tzinfo):
    __slots__ = ("a",)
    __reduce__ = object.__reduce__
s = Slotted(); s.a = 5
print(object.__reduce_ex__(s, 2)[1:], pickle.loads(pickle.dumps(s)).a)

# tzinfo's own way.
class Plain(datetime.tzinfo):
    def __init__(self, a=1):
        self.a = a
print(Plain(5).__reduce__()[1:], Plain(5).__reduce_ex__(2)[1:], pickle.loads(pickle.dumps(Plain(6))).a)

# Those that do hold something cannot be pickled that way.
import collections, io, itertools, struct
for base, args in ((collections.deque, ()), (struct.Struct, ("i",)), (itertools.count, ()), (io.BufferedRWPair, None), (datetime.time, ()), (datetime.timedelta, ()), (bytearray, ()), (set, ()), (property, ())):
    cls = type("Sub", (base,), {"__reduce__": object.__reduce__})
    try:
        instance = cls.__new__(cls) if args is None else cls(*args)
        print(base.__name__, object.__reduce_ex__(instance, 2)[1:])
    except TypeError as e:
        print(base.__name__, e)
