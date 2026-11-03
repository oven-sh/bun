# What the module and its two types look like from outside.
import _bz2, bz2, copy, inspect, pickle, sys, weakref
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k))
        i = s.find(' at 0x')
        print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
print(_bz2.__name__, _bz2.__doc__, sorted(n for n in dir(_bz2) if not n.startswith('__')))
C, D = _bz2.BZ2Compressor, _bz2.BZ2Decompressor
print(bz2.BZ2Compressor is C, bz2.BZ2Decompressor is D)
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
for n in ('eof', 'needs_input', 'unused_data'):
    print(n, getattr(d, n)); t(setattr, d, n, 1); t(delattr, d, n)
    t(vars(D)[n].__get__, None, D); t(vars(D)[n].__get__, 5); t(vars(D)[n].__get__, C())
t(C.compress, D(), b''); t(C.flush, D()); t(D.decompress, C(), b''); t(C.compress, 5, b''); t(D.decompress, None, b'')
print(type(C().compress), C().compress.__name__, C().compress.__qualname__, C().compress.__self__.__class__)
print(C().compress.__text_signature__, D().decompress.__text_signature__)
print(bz2.__all__)
