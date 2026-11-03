import re
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
def sub():
    class S(memoryview): pass
t(sub)
m = memoryview(b'abc')
print(re.sub('0x[0-9a-f]+', '0x', repr(m)), re.sub('0x[0-9a-f]+', '0x', str(m)))
print(re.fullmatch('<memory at 0x[0-9a-f]+>', repr(m)) is not None)
m.release()
print(re.sub('0x[0-9a-f]+', '0x', repr(m)))
t(lambda: m.x)
def seta(): m.x = 1
t(seta)
def setobj(): m.obj = 1
t(setobj)
def setfmt(): memoryview(b'a').format = 'b'
t(setfmt)
def delfmt(): del memoryview(b'a').format
t(delfmt)
t(lambda: memoryview.__new__(memoryview, b'ab').tobytes())
t(lambda: memoryview.__new__(int, b'ab'))
t(lambda: memoryview.__new__(memoryview))
t(lambda: bool(memoryview(b'')))
t(lambda: bool(memoryview(b'a')))
t(lambda: memoryview[int])
t(lambda: memoryview[int, str].__args__)
t(lambda: memoryview[int].__origin__ is memoryview)
import weakref
m = memoryview(b'abc')
r = weakref.ref(m)
print(r() is m)
t(lambda: m + m)
t(lambda: m * 2)
t(lambda: m < m)
t(lambda: m <= b'abc')
t(lambda: m > m)
t(lambda: 97 in m)
t(lambda: 5 in m)
t(lambda: b'a' in m)
t(lambda: type(reversed(m)).__name__)
t(lambda: list(reversed(m)))
t(lambda: sorted(memoryview(b'cab')))
t(lambda: min(m), )
t(lambda: sum(m))
t(lambda: tuple(m))
t(lambda: m.__len__())
t(lambda: m.__getitem__(1))
t(lambda: m.__sizeof__() > 0)
t(lambda: isinstance(m, memoryview))
import collections.abc as abc
print(isinstance(m, abc.Sequence), isinstance(m, abc.Buffer), isinstance(b'', abc.Buffer), isinstance(bytearray(), abc.Buffer), isinstance('', abc.Buffer), isinstance(m, abc.MutableSequence), isinstance(m, abc.Hashable))
match m:
    case [a, b, c]:
        print('seq', a, b, c)
    case _:
        print('no')
