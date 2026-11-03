# Streams as objects: weak references, pickling, copying, comparison, dir().
import _io, io, weakref, pickle, copy

def t(f, *a, **k):
    try:
        r = f(*a, **k)
    except BaseException as e:
        print(type(e).__name__ + ':', e)
    else:
        print(repr(r))

objects = [_io.FileIO('/dev/null'), _io.BytesIO(b'ab'), _io.StringIO('ab'), _io.BufferedReader(_io.BytesIO()), _io.BufferedWriter(_io.BytesIO()), _io.BufferedRandom(_io.BytesIO()),
           _io.BufferedRWPair(_io.BytesIO(), _io.BytesIO()), _io.TextIOWrapper(_io.BytesIO()), _io._IOBase(), _io._RawIOBase(), _io._BufferedIOBase(), _io._TextIOBase()]

print('--- weak references')
for o in objects:
    r = weakref.ref(o)
    print(type(o).__name__, r() is o)
t(weakref.ref, _io.IncrementalNewlineDecoder(None, False))

print('--- identity')
for o in objects:
    print(type(o).__name__, o == o, o != o, hash(o) == hash(o), bool(o), o in [o], {o: 1}[o])
print(_io.BytesIO(b'a') == _io.BytesIO(b'a'), _io.StringIO('a') == _io.StringIO('a'))

print('--- pickling')
for o in objects:
    for proto in (2, pickle.HIGHEST_PROTOCOL):
        try:
            c = pickle.loads(pickle.dumps(o, proto))
        except Exception as e:
            print(type(o).__name__, proto, type(e).__name__, e)
        else:
            print(type(o).__name__, proto, type(c).__name__, getattr(c, 'getvalue', lambda: None)())
b = _io.BytesIO(b'0123456789')
b.seek(4)
b.tag = 'x'
c = pickle.loads(pickle.dumps(b))
print(c.getvalue(), c.tell(), c.tag, c.read())
s = _io.StringIO('a\r\nb', newline='\r\n')
s.seek(2)
c = pickle.loads(pickle.dumps(s))
print(repr(c.getvalue()), c.tell(), c.readlines())
class MyBytesIO(io.BytesIO):
    pass
m = MyBytesIO(b'xyz')
m.read(1)
c = pickle.loads(pickle.dumps(m))
print(type(c).__name__, c.getvalue(), c.tell())
b.close()
t(pickle.dumps, b)
class MyRaw(io.RawIOBase):
    pass
r = MyRaw()
r.tag = 'raw'
c = pickle.loads(pickle.dumps(r))
print(type(c).__name__, c.tag, c.closed, copy.copy(r).tag)

print('--- copying')
b = _io.BytesIO(b'0123')
b.read(2)
for f in (copy.copy, copy.deepcopy):
    c = f(b)
    print(c is b, c.getvalue(), c.tell())
s = _io.StringIO('0123')
s.read(1)
c = copy.deepcopy(s)
print(c.getvalue(), c.tell())
t(copy.copy, objects[0])
t(copy.deepcopy, objects[7])

print('--- dir')
for cls in (_io._IOBase, _io._RawIOBase, _io._BufferedIOBase, _io._TextIOBase, _io.FileIO, _io.BytesIO, _io.StringIO, _io.BufferedReader, _io.BufferedWriter, _io.BufferedRandom,
            _io.BufferedRWPair, _io.TextIOWrapper, _io.IncrementalNewlineDecoder):
    print(cls.__name__, [n for n in dir(cls) if not n.startswith('__')])
    print('   ', sorted(n for n in cls.__dict__ if n.startswith('__') and n not in ('__doc__', '__module__', '__new__', '__dict__', '__weakref__')))

print('--- kinds of attributes')
for cls, name in ((_io.FileIO, 'read'), (_io.FileIO, 'closed'), (_io.FileIO, '__init__'), (_io.FileIO, '__repr__'), (_io._IOBase, '__next__'), (_io._IOBase, '__enter__'), (_io._IOBase, '__del__'),
                  (_io.BytesIO, 'getvalue'), (_io.TextIOWrapper, 'name')):
    print(cls.__name__, name, type(cls.__dict__[name]).__name__, repr(cls.__dict__[name]))
f = objects[0]
print(repr(f.read).split(' at ')[0], repr(f.__repr__).split(' at ')[0], f.read.__name__, f.read.__qualname__, f.read.__self__ is f)
t(_io.FileIO.read, 5)
t(_io.FileIO.read, _io.BytesIO())
t(_io.FileIO.closed.__get__, 5)
t(_io.BytesIO.getvalue, _io.StringIO())
t(_io.TextIOWrapper.write, _io.StringIO(), 'x')
t(_io._IOBase.close, 5)
print(_io._IOBase.readable(f), _io._IOBase.closed.__get__(f), _io._RawIOBase.read(f, 0))

print('--- layouts do not mix')
for bases in ((_io.FileIO, _io.BytesIO), (_io.BytesIO, _io.StringIO), (_io.BufferedReader, _io.BufferedWriter), (_io.TextIOWrapper, _io.StringIO), (_io.FileIO, dict), (_io.BytesIO, int)):
    try:
        type('X', bases, {})
    except TypeError as e:
        print([b.__name__ for b in bases], 'TypeError:', e)
class Mixin:
    def extra(self): return 'extra'
class Mixed(Mixin, _io.BytesIO, io.BufferedIOBase):
    pass
m = Mixed(b'q')
print(m.extra(), m.read(), [c.__name__ for c in Mixed.__mro__])
for o in objects:
    o.close()
