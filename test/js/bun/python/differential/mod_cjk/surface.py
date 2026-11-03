# What the modules have in them, and how their functions take their arguments.
import _multibytecodec as m
import _codecs_cn, _codecs_hk, _codecs_iso2022, _codecs_jp, _codecs_kr, _codecs_tw
import codecs, copy, inspect, io, pickle, re, sys, types, weakref

def t(f, *a, **k):
    try:
        print(re.sub(r' at 0x[0-9a-f]+', ' at 0x', repr(f(*a, **k))))
    except BaseException as e:
        print(type(e).__name__, e)

hidden = {'__file__', '__loader__', '__spec__', '__package__', '__cached__', '__builtins__'}
for module in (m, _codecs_cn, _codecs_hk, _codecs_iso2022, _codecs_jp, _codecs_kr, _codecs_tw):
    print(module.__name__, module.__doc__, sorted(set(dir(module)) - hidden))
    for name in sorted(vars(module)):
        if name.startswith('__map_'):
            t(type, getattr(module, name)); t(repr, getattr(module, name))
            break
print(type(_codecs_jp.__map_jisx0208) is types.CapsuleType)

c = _codecs_jp.getcodec('shift_jis')
kinds = [type(c), m.MultibyteIncrementalEncoder, m.MultibyteIncrementalDecoder, m.MultibyteStreamReader, m.MultibyteStreamWriter]
for cls in kinds:
    print(cls, cls.__name__, cls.__qualname__, cls.__module__, cls.__bases__, cls.__doc__, cls.__text_signature__, sorted(cls.__dict__))
    print(cls.__flags__ & (1 << 10 | 1 << 8 | 1 << 7), cls.__dictoffset__, cls.__weakrefoffset__)
    for name, value in sorted(cls.__dict__.items()):
        if name not in ('__doc__', '__module__'):
            print(' ', name, type(value).__name__, getattr(value, '__text_signature__', None), repr(value.__doc__)[:60])
    t(setattr, cls, 'x', 1)
for f in (m.__create_codec, _codecs_jp.getcodec):
    print(f.__name__, f.__qualname__, f.__module__, f.__text_signature__, f.__doc__, f.__self__ is sys.modules[f.__module__])

class E(m.MultibyteIncrementalEncoder): codec = c
class D(m.MultibyteIncrementalDecoder): codec = c
class R(m.MultibyteStreamReader): codec = c
class W(m.MultibyteStreamWriter): codec = c

print('-- constructors')
for cls in (E, D):
    t(cls, None); t(cls, 1); t(cls, 'a', 'b'); t(cls, x=1); t(cls, errors='x\0y'); t(cls, errors=None); t(cls, 'strict', errors='strict')
    t(cls, error='x'); t(cls, x=1, y=2); t(cls, '\udc80'); t(cls, errors='\udc80'); t(cls, 'nosuch'); t(cls, errors='ignore')
for cls in (R, W):
    t(cls); t(cls, None, None); t(cls, 1, 2, 3); t(cls, x=1); t(cls, stream=1, errors='a', x=2); t(cls, errors='strict')
    t(cls, 5, stream=6); t(cls, 1, x=2); t(cls, 1, error='a'); t(cls, 1, '\udc80x\0'); t(cls, stream=None); t(cls, errors='replace', stream=2)
for cls in kinds[1:]:
    t(cls); t(cls, None)
class B(m.MultibyteIncrementalEncoder): codec = 1
t(B)
class B(m.MultibyteStreamReader): codec = E()
t(B, None)
class B(m.MultibyteStreamWriter):
    @property
    def codec(self): return c
t(B, None)
t(type(c)); t(type(c).__new__, type(c)) if hasattr(type(c), '__new__') else None
t(E.__init__, E(), 1, 2, 3, x=4); t(E().__init__); t(E.__new__, E); t(E.__new__, D); t(m.MultibyteIncrementalEncoder.__new__, int); t(m.MultibyteIncrementalEncoder.__new__, D); t(m.MultibyteIncrementalEncoder.__new__)
try:
    class Both(m.MultibyteIncrementalEncoder, m.MultibyteIncrementalDecoder): pass
except TypeError as e:
    print(e)
try:
    class Sub(type(c)): pass
except TypeError as e:
    print(e)

print('-- getcodec')
t(m.__create_codec, 1); t(m.__create_codec); t(m.__create_codec, _codecs_jp.__map_jisx0208); t(m.__create_codec, c); t(m.__create_codec, arg=1)
t(_codecs_jp.getcodec, 1); t(_codecs_jp.getcodec, 'x'); t(_codecs_jp.getcodec); t(_codecs_jp.getcodec, 'shift_jis\0'); t(_codecs_jp.getcodec, 'shift_jis\0x'); t(_codecs_jp.getcodec, 'Shift_JIS')
t(_codecs_jp.getcodec, b'shift_jis'); t(_codecs_jp.getcodec, ''); t(_codecs_jp.getcodec, 'gbk'); t(_codecs_jp.getcodec, '\udc80'); t(_codecs_jp.getcodec, 'a', 'b'); t(_codecs_jp.getcodec, object='cp932')
print(_codecs_jp.getcodec('cp932') is _codecs_jp.getcodec('cp932'), _codecs_jp.getcodec('cp932') == _codecs_jp.getcodec('cp932'))
names = {_codecs_cn: 'gb2312 gbk gb18030 hz', _codecs_hk: 'big5hkscs', _codecs_tw: 'big5 cp950', _codecs_kr: 'euc_kr cp949 johab',
         _codecs_jp: 'shift_jis cp932 euc_jp shift_jis_2004 euc_jis_2004 euc_jisx0213 shift_jisx0213',
         _codecs_iso2022: 'iso2022_kr iso2022_jp iso2022_jp_1 iso2022_jp_2 iso2022_jp_2004 iso2022_jp_3 iso2022_jp_ext'}
for module, own in names.items():
    for others in names.values():
        for name in others.split():
            try:
                module.getcodec(name)
                assert name in own.split(), name
            except LookupError:
                assert name not in own.split(), name

print('-- MultibyteCodec')
t(c.encode); t(c.encode, 1); t(c.encode, 'a', 1); t(c.encode, 'a', None); t(c.encode, 'a', 'x\0'); t(c.encode, 'a', errors='strict', x=1); t(c.encode, input='a'); t(c.encode, 'a', 'b', 'c')
t(c.encode, 'a', '\udc80'); t(c.encode, '\xff', ''); t(c.encode, 'a', 'nosuch'); t(c.encode, '\xff', 'nosuch'); t(c.encode, errors='strict'); t(c.encode, 'a', error='strict'); t(c.encode, '')
t(c.decode); t(c.decode, 'a'); t(c.decode, b'a', 1); t(c.decode, 1); t(c.decode, memoryview(b'abc')[::2]); t(c.decode, bytearray(b'a')); t(c.decode, input=b'a', errors=None)
t(c.decode, b'\xff', 'x'); t(c.decode, 'a', 1); t(c.decode, b''); t(c.decode, b'', 'nosuch'); t(c.decode, memoryview(b'\x82\xa0')); t(c.decode, b'a', 'x\0'); t(c.decode, None)
import array
t(c.decode, array.array('H', [0x4141, 0x4242])); t(c.decode, memoryview(b'abcd').cast('H'))
class S(str): pass
class X:
    def __str__(self): return 'xyz'
class Y:
    def __str__(self): return 1
class Z:
    def __str__(self): raise KeyError('z')
t(c.encode, X()); t(c.encode, None); t(c.encode, b'a'); t(c.encode, S('abc')); t(c.encode, Y()); t(c.encode, Z()); t(c.encode, 1.5); t(c.encode, S('\u3042'), S('strict'))
t(type(c).encode, 5, 'x'); t(type(c).encode); t(type(c).decode, E(), b'')
t(copy.copy, c); t(pickle.dumps, c); t(weakref.ref, c); t(setattr, c, 'x', 1); t(getattr, c, '__dict__'); t(hash, c) if False else None; t(bool, c)

print('-- MultibyteIncrementalEncoder')
e = E()
t(e.encode); t(e.encode, 1); t(e.encode, 'a', 'x'); t(e.encode, 'a', final=2); t(e.encode, 'a', None); t(e.encode, X()); t(e.encode, Y()); t(e.encode, input='a', final=True); t(e.encode, 'a', 1, 2); t(e.encode, 'a', x=1)
t(e.setstate, 'a'); t(e.setstate, -1); t(e.setstate, 1 << 200); t(e.setstate, 255); t(e.getstate); t(lambda: e.setstate()); t(lambda: e.reset(1)); t(e.setstate, True); t(e.getstate); t(e.setstate, None); t(e.setstate, 1.0); t(lambda: e.getstate(1)); t(lambda: e.setstate(state=0))
t(e.setstate, (1 << 136) - 1); t(e.setstate, 1 << 136); t(e.setstate, 9); t(e.setstate, 8); t(e.getstate); t(e.setstate, 0); t(e.reset)
t(m.MultibyteIncrementalEncoder.encode, 5, 'x'); t(m.MultibyteIncrementalEncoder.encode); t(m.MultibyteIncrementalEncoder.encode, D(), 'x')
class F:
    def __bool__(self): raise KeyError('f')
t(e.encode, 'a', F()); t(e.encode, 'a', final=[])
t(pickle.dumps, e); t(copy.copy, e); t(setattr, e, 'x', 1); t(getattr, e, 'x'); t(type, weakref.ref(e))

print('-- errors')
for o in (E(), D(), R(None), W(None)):
    t(getattr, o, 'errors'); t(setattr, o, 'errors', 1); t(delattr, o, 'errors'); t(setattr, o, 'errors', 'x\0'); t(getattr, o, 'errors'); t(setattr, o, 'errors', 'foo'); t(getattr, o, 'errors')
    t(setattr, o, 'errors', '\udc80'); t(setattr, o, 'errors', 'strict\0abc'); t(getattr, o, 'errors'); t(setattr, o, 'errors', ''); t(getattr, o, 'errors'); t(setattr, o, 'errors', None); t(setattr, o, 'errors', S('ignore')); t(type, o.errors)
    t(setattr, o, 'errors', S('bar')); t(type, o.errors); t(getattr, o, 'errors'); t(setattr, o, 'errors', '\u3042'); t(getattr, o, 'errors')
e = E('foo'); t(e.encode, 'a'); t(e.encode, '\xff'); e.errors = ''; t(e.encode, '\xff'); e.errors = 'ignore'; t(e.encode, 'a\xffb'); e.errors = 'replace'; t(e.encode, 'a\xffb'); e.errors = 'strict'; t(e.encode, 'a\xffb')
t(type, E(S('ignore')).errors); t(type, E(S('foo')).errors)

print('-- MultibyteIncrementalDecoder')
d = D()
t(d.decode); t(d.decode, 'a'); t(d.decode, b'a', final=[]); t(d.decode, b'a', F()); t(d.decode, 'a', F()); t(d.decode, input=b'a', final=1); t(d.decode, b'a', 1, 2); t(d.decode, bytearray(b'ab')); t(d.decode, memoryview(b'abc')[::2])
t(d.setstate, 1); t(d.setstate, ()); t(d.setstate, (b'', 1, 2)); t(d.setstate, ('', 1)); t(d.setstate, (b'', '')); t(d.setstate, (b'123456789', 0)); t(d.setstate, (b'', -1)); t(d.setstate, (b'', 1 << 64)); t(d.getstate)
t(d.setstate, (bytearray(b''), 0)); t(d.setstate, [b'', 0]); t(d.setstate, (b'12345678', (1 << 64) - 1)); t(d.getstate); t(d.setstate, (b'123456789', -1)); t(d.setstate, (b'', True)); t(d.getstate); t(lambda: d.setstate()); t(lambda: d.reset(1)); t(d.reset); t(d.getstate)
class BS(bytes): pass
class T(tuple): pass
t(d.setstate, T((BS(b'\x82'), 0))); t(d.getstate); t(type, d.getstate()[0]); t(d.decode, b'\xa0')

print('-- MultibyteStreamReader')
r = R(io.BytesIO(b'abc'))
t(r.read, 'a'); t(r.read, 1.0); t(r.read, None); t(r.read, 1 << 70); t(r.read, 1, 2); t(r.readline, 'a'); t(r.readlines, 'a'); t(type, r.stream); t(setattr, r, 'stream', 1); t(delattr, r, 'stream'); t(lambda: r.read(size=1)); t(r.read, True)
t(r.read, -(1 << 70)); t(r.readline, 1 << 70); t(r.readlines, 1 << 70); t(lambda: r.reset(1)); t(r.reset); t(r.readline, 1, 2); t(r.readlines, 1, 2); t(lambda: r.readline(sizeobj=1))
r = R(io.StringIO('abc')); t(r.read); t(r.read, 0); t(r.readline); t(r.readlines)
r = R(None); t(r.read); t(r.read, 0); t(r.readline, 0); t(r.readlines, 0); t(r.readline); t(r.readlines)
class Stream:
    def __init__(self, *results): self.results = list(results)
    def read(self, *args):
        print('read', args)
        return self.results.pop(0)
    def readline(self, *args):
        print('readline', args)
        return self.results.pop(0)
    def write(self, data):
        print('write', data)
        return 'ignored'
t(R(Stream(b'ab')).read); t(R(Stream(b'ab')).read, None); t(R(Stream(b'ab')).read, -1); t(R(Stream(b'ab')).read, -5); t(R(Stream(b'ab')).read, 7); t(R(Stream(b'ab')).read, (1 << 32) + 3); t(R(Stream(b'ab')).read, 1 << 31); t(R(Stream(b'ab')).read, True)
t(R(Stream(bytearray(b'ab'))).read); t(R(Stream(None)).read); t(R(Stream(BS(b'ab'))).read); t(R(Stream(memoryview(b'ab'))).readline); t(R(Stream()).read)
t(R(Stream(b'a\nb\r\nc')).readlines); t(R(Stream(b'a\nb\r\nc')).readlines, 3); t(R(Stream(b'a\nb')).readline); t(R(Stream(b'a\nb')).readline, 2); t(R(Stream(b'')).readlines)

print('-- MultibyteStreamWriter')
w = W(io.BytesIO())
t(w.write); t(w.write, 1); t(w.writelines, 1); t(w.writelines, 'ab'); t(w.writelines, [1, 2]); t(w.stream.getvalue); t(w.reset, 1); t(w.write, strobj='a')
t(w.write, 'a', 'b'); t(w.write, 'a', x=1); t(w.write, x=1); t(w.writelines); t(w.writelines, [], []); t(w.writelines, [], x=1); t(w.reset, x=1); t(w.write, *'abc', y=2); t(w.write, x=1, y=2); t(w.writelines, x=1, y=2)
t(w.writelines, {}); t(w.writelines, {'a': 1}); t(w.writelines, ('a', 'b')); t(w.writelines, iter('ab')); t(w.writelines, set()); t(w.writelines, None); t(w.writelines, b'ab'); t(w.writelines, range(3)); t(w.stream.getvalue)
class Seq:
    def __getitem__(self, i): return 'xyz'[i]
t(w.writelines, Seq())
class Seq:
    def __len__(self): return 2
    def __getitem__(self, i):
        print('getitem', i)
        return 'xyz'[i]
t(w.writelines, Seq()); t(w.stream.getvalue)
lines = ['a', 'b', 'c']
class Shrinking:
    def write(self, data):
        print('write', data)
        del lines[-1:]
t(W(Shrinking()).writelines, lines)
t(W(None).write, 'a'); t(W(None).write, ''); t(W(None).writelines, []); t(W(None).reset); t(W(Stream()).write, 'a'); t(W(Stream()).write, ''); t(W(Stream()).write, '\xff'); t(W(Stream(), 'replace').write, '\xff'); t(W(Stream()).write, X())

print('-- getcodec goes through _multibytecodec')
saved = m.__create_codec
capsules = []
m.__create_codec = lambda capsule: capsules.append(capsule) or ('mine', type(capsule).__name__)
t(_codecs_jp.getcodec, 'cp932'); t(repr, capsules[0]); t(_codecs_jp.getcodec, 'nosuch')
del m.__create_codec
t(_codecs_jp.getcodec, 'cp932')
m.__create_codec = saved
t(lambda: saved(capsules[0]).encode('\uff71')); t(type, _codecs_jp.getcodec('cp932'))
sys.modules['_multibytecodec'] = None
t(_codecs_jp.getcodec, 'cp932'); t(_codecs_jp.getcodec, 'nosuch')
sys.modules['_multibytecodec'] = m
