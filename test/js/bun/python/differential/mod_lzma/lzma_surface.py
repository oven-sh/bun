# What the module and its types look like from outside.
import _lzma, lzma, copy, inspect, pickle, weakref
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k))
        i = s.find(' at 0x')
        print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
print(_lzma.__name__, _lzma.__doc__)
for n in sorted(dir(_lzma)):
    if n.startswith('__'): continue
    v = getattr(_lzma, n)
    print(n, v if isinstance(v, int) else type(v).__name__, type(v) is int)
print(sorted(lzma.__all__))
C, D, E = _lzma.LZMACompressor, _lzma.LZMADecompressor, _lzma.LZMAError
print(lzma.LZMACompressor is C, lzma.LZMADecompressor is D, lzma.LZMAError is E)
print(E, E.__name__, E.__qualname__, E.__module__, E.__mro__, E.__doc__, E.__bases__)
e = E('a', 1); print(repr(e), str(e), e.args); t(pickle.loads, pickle.dumps(e)); e.x = 1; print(e.__dict__)
class Sub(E): pass
print(Sub('x'), issubclass(Sub, Exception), weakref.ref(e)() is e)
for T in (C, D):
    print(T, T.__name__, T.__qualname__, T.__module__, T.__mro__, type(T), T.__base__)
    print(sorted(n for n in vars(T) if n != '__module__'))
    print(T.__doc__)
    print(T.__flags__ & (1 << 10) != 0, T.__flags__ & (1 << 8) != 0)
    print(T.__dictoffset__, T.__weakrefoffset__, T.__itemsize__)
    t(getattr, T, '__text_signature__')
    t(inspect.signature, T)
    for n, v in sorted(vars(T).items()):
        if n.startswith('__') and n != '__new__':
            continue
        print(n, type(v).__name__, getattr(v, '__name__', None), getattr(v, '__qualname__', None), getattr(v, '__objclass__', None))
        print(' ', getattr(v, '__text_signature__', None)); print(' ', v.__doc__)
        if callable(v): t(inspect.signature, v)
    def sub():
        class X(T): pass
    t(sub)
    t(setattr, T, 'x', 1); t(delattr, T, '__doc__'); t(setattr, T, 'compress', None)
    o = T()
    t(repr, o)
    print(o == o, o != o, o == T(), bool(o))
    t(setattr, o, 'x', 1); t(getattr, o, '__dict__'); t(weakref.ref, o)
    t(copy.copy, o); t(copy.deepcopy, o)
    for p in range(pickle.HIGHEST_PROTOCOL + 1):
        t(pickle.dumps, o, p)
    t(o.__reduce__); t(o.__reduce_ex__, 2); t(o.__getstate__)
    t(len, o); t(iter, o); t(lambda: o < o); t(lambda: o + o)
    t(T.__new__, T); t(T.__new__, object); t(T.__new__, int); t(object.__new__, T); t(T.__new__)
    t(T.__init__, o); t(T.__init__, o, 1)
d = D()
for n in ('check', 'eof', 'needs_input', 'unused_data'):
    print(n, getattr(d, n)); t(setattr, d, n, 1); t(delattr, d, n)
    t(vars(D)[n].__get__, None, D); t(vars(D)[n].__get__, 5); t(vars(D)[n].__get__, C())
t(C.compress, D(), b''); t(C.flush, D()); t(D.decompress, C(), b''); t(C.compress, 5, b''); t(D.decompress, None, b'')
for f in (_lzma.is_check_supported, _lzma._encode_filter_properties, _lzma._decode_filter_properties):
    print(f, type(f).__name__, f.__name__, f.__qualname__, f.__module__, f.__self__ is _lzma, f.__text_signature__)
    print(f.__doc__); t(inspect.signature, f)
for c in list(range(-2, 18)) + [2**31 - 1, -2**31]:
    print(c, _lzma.is_check_supported(c), end='; ')
print()
t(_lzma.is_check_supported); t(_lzma.is_check_supported, 'a'); t(_lzma.is_check_supported, 1.0); t(_lzma.is_check_supported, 2**31); t(_lzma.is_check_supported, -2**31 - 1)
t(_lzma.is_check_supported, 2**70); t(_lzma.is_check_supported, 1, 2); t(_lzma.is_check_supported, check_id=1); t(_lzma.is_check_supported, None); t(_lzma.is_check_supported, True)
