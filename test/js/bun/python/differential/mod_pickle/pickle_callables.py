# Built-in functions, methods and descriptors, and methods with private names: what they reduce to and how they are pickled.
import pickle, math, types, re
class Sub(list):
    class Nested(str): pass
class P:
    def __init__(self, v): self.v = v
    def __m(self): return self.v
    def get(self): return self.__m
    @classmethod
    def __c(cls): return 43
    @classmethod
    def getc(cls): return cls.__c
    def m__(self): pass
    def __d__(self): pass
    def ___(self): pass
    def __x_(self): pass
class _Q(P): pass
import datetime
ms = ["abcd".index, str.index, [1,2,3].__len__, list.__len__, {1,2}.__contains__, set.__contains__, dict.fromkeys, bytearray.maketrans, str.maketrans, len, math.sin,
      Sub([1]).count, Sub.count, Sub.Nested.count, Sub.Nested('x').count, bytearray.__dict__['maketrans'], dict.__dict__['fromkeys'], int.__add__, (1).__add__, int.real, int.__dict__['real'],
      types.FunctionType.__code__, types.FunctionType.__dict__['__globals__'], object.__init__, object().__init__, object.__new__, int.__new__, type.__call__, type.mro, int.from_bytes, int.to_bytes, (5).to_bytes,
      P(1).get(), P.getc(), _Q(1).get(), _Q.getc(), P(1).m__, P(1).__d__, P(1).___, P(1)._P__x_, complex.real, slice.start, range.start, property.fget, BaseException.args, BaseException.__dict__['__traceback__'], dict.__getitem__, {}.__getitem__, {}.get, dict.get, print, [].append, str.join, ''.join, object.__reduce_ex__, object().__reduce_ex__, type.__dict__['__dict__'], P.__dict__['__dict__'], P.__dict__['__weakref__']]
for m in ms:
    try: r = m.__reduce__()
    except Exception as e: r = (type(e).__name__, str(e))
    print(type(m).__name__, getattr(m, '__qualname__', None) if type(m) is not staticmethod else '', re.sub(' at 0x[0-9a-f]+', '', repr(r)))
    for proto in (0, 2, 4):
        for dumps, loads in ((pickle.dumps, pickle.loads), (pickle._dumps, pickle._loads)):
            try:
                d = dumps(m, proto); u = loads(d)
                # (With protocol 4 it matters whether the names of the modules of two things are one object.)
                print('  ', proto, d if proto < 4 else '', type(u).__name__, u == m)
            except Exception as e: print('  ', proto, type(e).__name__, re.sub(' at 0x[0-9a-f]+', '', str(e)))
