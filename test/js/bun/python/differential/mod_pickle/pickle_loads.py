import pickle, _pickle, io, collections, sys, copyreg, pickletools

def show(f, *a, **k):
    try:
        r = f(*a, **k)
        print(repr(r))
    except BaseException as e:
        print(type(e).__name__, e, type(e.__context__).__name__)

class C:
    def __init__(self, a=1): self.a = a
    def __repr__(self): return 'C(%r)' % (sorted(self.__dict__.items()),)
class Old:
    def __getinitargs__(self): return ()
    def __init__(self, *a): self.args = a
    def __repr__(self): return 'Old(%r)' % (self.args,)
class SL:
    __slots__ = ('x', '__dict__')
    def __repr__(self): return 'SL(%r, %r)' % (getattr(self, 'x', None), self.__dict__)
class App:
    def __init__(self): self.v = []
    def append(self, x): self.v.append(x)
    def __repr__(self): return 'App(%r)' % (self.v,)
class Ext(App):
    def extend(self, x): self.v.append(list(x))
class Add:
    def __init__(self): self.v = []
    def add(self, x): self.v.append(x)
    def __repr__(self): return 'Add(%r)' % (self.v,)
class SI:
    def __init__(self): self.v = []
    def __setitem__(self, k, v): self.v.append((k, v))
    def __repr__(self): return 'SI(%r)' % (self.v,)

L = pickle.loads
good = [
    b'N.', b'I0\n.', b'I1\n.', b'I-5\n.', b'I00\n.', b'I01\n.', b'I010\n.', b'I 5\n.', b'I+5\n.', b'I12345678901234567890\n.', b'I5 \n.', b'I0x10\n.', b'I1_0\n.',
    b'L5L\n.', b'L5\n.', b'L-5L\n.', b'L123456789012345678901234567890L\n.', b'L 5L\n.', b'J\xff\xff\xff\xff.', b'J\x00\x00\x00\x80.', b'K\xff.', b'M\xff\xff.',
    b'\x8a\x00.', b'\x8a\x01\xff.', b'\x8a\x01\x7f.', b'\x8a\x02\x00\x80.', b'\x8a\x02\xff\x00.', b'\x8a\x09\x00\x00\x00\x00\x00\x00\x00\x00\x01.', b'\x8b\x00\x00\x00\x00.', b'\x8b\x02\x00\x00\x00\x01\x02.',
    b'F1.5\n.', b'F1\n.', b'F-0.0\n.', b'Finf\n.', b'Fnan\n.', b'F1e5\n.', b'F 1.5\n.', b'G?\xf8\x00\x00\x00\x00\x00\x00.', b'G\x7f\xf0\x00\x00\x00\x00\x00\x00.', b'G\x00\x00\x00\x00\x00\x00\x00\x00.', b'G@\x00\x00\x00\x00\x00\x00\x00.',
    b"S'abc'\n.", b'S"abc"\n.', b"S''\n.", b"S'a\\n\\x41\\''\n.", b"S'\\\\'\n.", b'U\x03abc.', b'T\x03\x00\x00\x00abc.', b'U\x00.',
    b'Vabc\n.', b'V\n.', b'V\\u00e9\\U0001f600\n.', b'V\xe9\n.', b'V\\\\\n.', b'X\x03\x00\x00\x00abc.', b'X\x02\x00\x00\x00\xc3\xa9.', b'X\x04\x00\x00\x00\xf0\x9f\x98\x80.', b'X\x03\x00\x00\x00\xed\xa0\x80.', b'\x8c\x03abc.', b'\x8c\x00.',
    b'\x8d\x03\x00\x00\x00\x00\x00\x00\x00abc.', b'C\x03abc.', b'B\x03\x00\x00\x00abc.', b'\x8e\x03\x00\x00\x00\x00\x00\x00\x00abc.', b'\x96\x03\x00\x00\x00\x00\x00\x00\x00abc.', b'C\x00.',
    b').', b'K\x01\x85.', b'K\x01K\x02\x86.', b'K\x01K\x02K\x03\x87.', b'(K\x01K\x02t.', b'(t.', b'].', b'(l.', b'(K\x01K\x02l.', b'}.', b'(d.', b'(K\x01K\x02d.', b'\x8f.', b'(\x91.', b'(K\x01K\x02K\x01\x91.',
    b']K\x01a.', b'](K\x01K\x02e.', b'](e.', b'}K\x01K\x02s.', b'}(K\x01K\x02K\x03K\x04u.', b'}(u.', b'\x8f(K\x01K\x02\x90.', b'\x8f(\x90.',
    b'\x88.', b'\x89.', b'K\x012.', b'K\x01K\x020.', b'K\x01(K\x02K\x031.', b'K\x01(0.', b'(K\x010K\x02t.',
    b'K\x05p0\n0g0\n.', b'K\x05q\x000h\x00.', b'K\x05r\x00\x00\x00\x000j\x00\x00\x00\x00.', b'K\x05\x940h\x00.', b'K\x05p100\n0g100\n.', b'K\x05q\xff0h\xff.', b'K\x05r\x00\x00\x01\x000j\x00\x00\x01\x00.', b'K\x05p 7\n0g7 \n.',
    b'K\x05q\x05K\x06\x94K\x07\x94(h\x05h\x00h\x01t.', b'K\x05r\xff\xff\xff\x7f0K\x06\x940j\xff\xff\xff\x7fh\x00\x86.', b'K\x05p99999999999\n0g99999999999\n.',
    b'cbuiltins\nint\n.', b'c__builtin__\nint\n.', b'c__builtin__\nunicode\n.', b'ccollections\nOrderedDict\n.', b'\x8c\x08builtins\x8c\x03int\x93.', b'\x80\x04\x8c\x08builtins\x8c\x0ddict.fromkeys\x93.' and b'N.',
    b'cbuiltins\nint\n(S"12"\ntR.', b'cbuiltins\nint\n)R.', b'cbuiltins\ncomplex\nK\x01K\x02\x86R.',
    b'c__main__\nC\n)\x81.', b'c__main__\nC\n)\x81}X\x01\x00\x00\x00bK\x02sb.', b'c__main__\nC\n)}\x92.', b'c__main__\nC\nK\x05\x85R.', b'(c__main__\nC\no.', b'(c__main__\nC\nK\x07o.', b'(i__main__\nC\n.', b'(K\x07i__main__\nC\n.',
    b'(c__main__\nOld\no.', b'(i__main__\nOld\n.', b'(K\x01i__main__\nOld\n.',
    b'c__main__\nSL\n)\x81N}X\x01\x00\x00\x00xK\x01s\x86b.', b'c__main__\nSL\n)\x81}X\x01\x00\x00\x00dK\x02s}X\x01\x00\x00\x00xK\x01s\x86b.', b'c__main__\nC\n)\x81Nb.', b'c__main__\nC\n)\x81NN\x86b.',
    b'c__main__\nApp\n)RK\x01a.', b'c__main__\nApp\n)R(K\x01K\x02e.', b'c__main__\nExt\n)R(K\x01K\x02e.', b'c__main__\nExt\n)RK\x01a.', b'c__main__\nAdd\n)R(K\x01K\x02\x90.', b'c__main__\nSI\n)R(K\x01K\x02K\x03K\x04u.', b'c__main__\nSI\n)RK\x01K\x02s.',
    b'\x80\x00N.', b'\x80\x05N.', b'\x80\x02\x80\x03N.', b'N.garbage', b'\x80\x04\x95\x02\x00\x00\x00\x00\x00\x00\x00N.', b'\x80\x04\x95\x01\x00\x00\x00\x00\x00\x00\x00N.', b'\x80\x04\x95\x00\x00\x00\x00\x00\x00\x00\x00N.',
    b'\x80\x04\x95\x01\x00\x00\x00\x00\x00\x00\x00N\x95\x01\x00\x00\x00\x00\x00\x00\x00.', b'\x95\x03\x00\x00\x00\x00\x00\x00\x00K\x01.trailing',
]
for d in good:
    show(L, d)

bad = [
    b'', b'N', b'\x80', b'\x80\x06N.', b'\x80\xffN.', b'.', b'?', b'\x00', b'\xff', b"'", b'\\', b'z.', b' ', b'\n',
    b'I', b'I\n', b'I\n.', b'Iabc\n.', b'I1', b'I1.5\n.', b'I--1\n.', b'L', b'L\n.', b'LL\n.', b'Labc\n.', b'LabcL\n.', b'L1.5L\n.', b'J\x00', b'K', b'M\x00',
    b'\x8a', b'\x8a\x02\x00', b'\x8b\x00\x00\x00', b'\x8b\xff\xff\xff\xff.', b'\x8b\xff\xff\xff\x7f.', b'F', b'F\n.', b'Fabc\n.', b'F1.5x\n.', b'F1.5', b'F1e999\n.', b'G\x00',
    b'S', b"S\n.", b"Sabc\n.", b"S'abc\n.", b"S'abc\"\n.", b"S'\n.", b"S'abc'", b"S'\\x'\n.", b"S'\xe9'\n.", b'U', b'U\x03ab', b'T\x03\x00\x00', b'T\xff\xff\xff\xff.', b'T\xff\xff\xff\x7f.', b'U\x01\xe9.',
    b'V', b'Vabc', b'V\\u12\n.', b'V\\U00110000\n.', b'X', b'X\x03\x00\x00\x00ab', b'X\x01\x00\x00\x00\xff.', b'X\x02\x00\x00\x00\xc3(.', b'X\xff\xff\xff\xff.', b'\x8c', b'\x8c\x03ab', b'\x8c\x01\xff.',
    b'\x8d\x03\x00\x00\x00\x00\x00\x00\x00ab', b'\x8d\xff\xff\xff\xff\xff\xff\xff\xff.', b'\x8d\xff\xff\xff\xff\xff\xff\xff\x7f.', b'\x8d\x00\x00\x00\x00\x00\x00\x00',
    b'C', b'C\x03ab', b'B\x03\x00\x00\x00ab', b'B\xff\xff\xff\xff.', b'\x8e\x03\x00\x00\x00\x00\x00\x00\x00ab', b'\x8e\xff\xff\xff\xff\xff\xff\xff\xff.', b'\x8e\xff\xff\xff\xff\xff\xff\xff\x7f.',
    b'\x96\x03\x00\x00\x00\x00\x00\x00\x00ab', b'\x96\xff\xff\xff\xff\xff\xff\xff\xff.', b'\x96\xff\xff\xff\xff\xff\xff\xff\x7f.', b'\x97.', b'\x98.', b'N\x98.', b'C\x01a\x98.',
    b'\x85.', b'K\x01\x86.', b'K\x01K\x02\x87.', b't.', b'l.', b'd.', b'\x91.', b'(K\x01d.', b'(K\x01\x85.', b'(\x85.', b'(K\x01\x86.', b'K\x01(\x85.', b'(]K\x01d.', b'(]\x91.',
    b'a.', b'K\x01a.', b']a.', b'e.', b'(e.', b'K\x01(K\x02e.', b'NK\x01a.', b's.', b'}s.', b'}K\x01s.', b'u.', b'(u.', b'}(K\x01u.', b'K\x01(K\x02K\x03u.', b'}]K\x01s.', b'\x90.', b'(\x90.', b'K\x01(K\x02\x90.', b'\x8f(]\x90.',
    b'(a.', b'](a.', b'(]a.', b'(s.', b'}(s.', b'(}K\x01s.', b'(}K\x01K\x02s.',
    b'0.', b'1.', b'2.', b'(2.', b'(.', b'((.', b'(0.', b'K\x01(.', b'(K\x01.',
    b'g0\n.', b'g\n.', b'g', b'gabc\n.', b'g-1\n.', b'g99999999999999999999999\n.', b'h\x00.', b'h', b'j\x00\x00\x00\x00.', b'j\x00', b'j\xff\xff\xff\xff.',
    b'p0\n.', b'Np\n.', b'Npabc\n.', b'Np-1\n.', b'Np99999999999999999999999\n.', b'Np', b'q\x00.', b'Nq', b'r\x00\x00\x00\x00.', b'Nr\x00', b'\x94.', b'(p0\n.', b'(q\x00.', b'(\x94.', b'(r\x00\x00\x00\x00.',
    b'c', b'c\n', b'c\n\n.', b'cbuiltins\n', b'cbuiltins\n\n.', b'cbuiltins\nint', b'cbuiltins\nnope\n.', b'cnope_module\nx\n.', b'c\xff\nx\n.', b'cbuiltins\n\xff\n.', b'cbuiltins\nint.real\n.', b'\x80\x04cbuiltins\nint.nope\n.', b'\x80\x04cbuiltins\nnope\n.',
    b'\x93.', b'N\x93.', b'NN\x93.', b'\x8c\x08builtinsN\x93.', b'\x8c\x08builtins\x8c\x04nope\x93.', b'\x80\x04\x8c\x08builtins\x8c\x08int.nope\x93.', b'\x8c\x08builtins\x8c\x08int.real\x93.', b'\x80\x04\x8c\x08builtins\x8c\x00\x93.', b'C\x08builtinsC\x03int\x93.',
    b'R.', b'NR.', b'NNR.', b'cbuiltins\nint\nNR.', b'cbuiltins\nint\n]R.', b'N)R.', b'cbuiltins\nint\n(S"x"\ntR.', b'(R.', b'(NR.', b'N(NR.', b'(N)R.',
    b'\x81.', b'N\x81.', b'NN\x81.', b'N)\x81.', b'cbuiltins\nint\nN\x81.', b'cbuiltins\nlen\n)\x81.', b'c__main__\nC\n]\x81.', b'\x92.', b'N\x92.', b'NN\x92.', b'NNN\x92.', b'N)}\x92.', b'c__main__\nC\nN}\x92.', b'c__main__\nC\n)N\x92.', b'c__main__\nC\n)]\x92.',
    b'cbuiltins\nint\n}\x81.', b'ctypes\nGeneratorType\n)\x81.', b'ctypes\nGeneratorType\n)}\x92.',
    b'o.', b'(o.', b'(No.', b'(K\x01K\x02o.', b'i.', b'(i', b'(i\n\n.', b'(ibuiltins\n', b'(ibuiltins\nnope\n.', b'(i\xff\nx\n.', b'i__main__\nC\n.', b'(K\x01K\x02i__main__\nC\n.',
    b'b.', b'Nb.', b'NNb.', b'c__main__\nC\n)\x81K\x01b.', b'c__main__\nC\n)\x81]b.', b'c__main__\nC\n)\x81NK\x01\x86b.', b'c__main__\nC\n)\x81}K\x01K\x02sb.', b'c__main__\nC\n)\x81N}K\x01K\x02s\x86b.', b'K\x01}b.', b'K\x01}X\x01\x00\x00\x00aK\x01sb.', b'(b.', b'(Nb.', b'N(Nb.', b'(NNb.',
    b'P', b'P\n.', b'Pabc\n.', b'P\xff\n.', b'Q.', b'NQ.', b'(Q.',
    b'\x82', b'\x82\x00.', b'\x82\x01.', b'\x83\x00\x00.', b'\x83\x01\x00.', b'\x84\x00\x00\x00\x00.', b'\x84\xff\xff\xff\xff.', b'\x84\x01\x00\x00\x00.', b'\x84\xff\xff\xff\x7f.',
    b'\x95', b'\x95\x00\x00\x00\x00\x00\x00\x00', b'\x95\x05\x00\x00\x00\x00\x00\x00\x00N.', b'\x95\xff\xff\xff\xff\xff\xff\xff\xffN.', b'\x95\xff\xff\xff\xff\xff\xff\xff\x7fN.',
    b'\x95\x01\x00\x00\x00\x00\x00\x00\x00K\x01.', b'\x95\x02\x00\x00\x00\x00\x00\x00\x00C\x03abc.', b'\x95\x0b\x00\x00\x00\x00\x00\x00\x00\x95\x01\x00\x00\x00\x00\x00\x00\x00N.', b'\x95\x02\x00\x00\x00\x00\x00\x00\x00I1\n.', b'\x95\x03\x00\x00\x00\x00\x00\x00\x00\x8c\x03abc.',
    b'\x95\x02\x00\x00\x00\x00\x00\x00\x00\x96\x03\x00\x00\x00\x00\x00\x00\x00abc.', b'\x95\x09\x00\x00\x00\x00\x00\x00\x00\x96\x03\x00\x00\x00\x00\x00\x00\x00abc.', b'\x95\x0a\x00\x00\x00\x00\x00\x00\x00\x96\x03\x00\x00\x00\x00\x00\x00\x00abc.',
]
for d in bad:
    print(d, end=' ')
    show(L, d)

# encoding, errors, fix_imports
for k in [dict(encoding='latin-1'), dict(encoding='bytes'), dict(encoding='utf-8'), dict(encoding='ascii', errors='replace'), dict(encoding='ascii', errors='ignore'), dict(encoding='nope'), dict(errors='nope'), dict(encoding='ASCII')]:
    for d in (b'U\x02\xc3\xa9.', b"S'\\xc3\\xa9'\n.", b'T\x02\x00\x00\x00\xc3\xa9.', b'U\x01a.'):
        show(L, d, **k)
show(L, b'c__builtin__\nunicode\n.', fix_imports=False)
show(L, b'c__builtin__\nunicode\n.', fix_imports=True)
show(L, b'\x80\x03c__builtin__\nunicode\n.')
show(L, b'cexceptions\nStandardError\n.')
show(L, b'cUserDict\nUserDict\n.')
show(L, b'ccPickle\nPickler\n.')
show(L, b'citertools\nizip\n.')
show(L, b'cQueue\nQueue\n.')

# The argument
for a in (bytearray(b'N.'), memoryview(b'K\x05.'), memoryview(b'xK\x05.')[1:], 'N.', 1, None, [78, 46], memoryview(b'K.\x05.')[::2]):
    show(L, a)
show(L)
show(L, b'N.', 1)
show(L, data=b'N.')
show(L, b'N.', foo=1)
show(L, b'N.', encoding=1)
show(L, b'N.', errors=1)
show(L, b'N.', encoding=None)
show(L, b'N.', encoding='a\0')
show(L, b'N.', buffers=1)
show(L, b'N.', buffers=None)
show(L, b'N.', fix_imports=[])

# Out-of-band buffers
show(L, b'\x80\x05\x97.', buffers=[b'abc'])
show(L, b'\x80\x05\x97.', buffers=iter([bytearray(b'abc')]))
show(L, b'\x80\x05\x97\x97\x86.', buffers=[b'a'])
show(L, b'\x80\x05\x97.', buffers=[])
show(L, b'\x80\x05\x97.', buffers=())
show(L, b'\x80\x05\x97.', buffers=None)
show(L, b'\x80\x05\x97\x98.', buffers=[b'abc'])
r = L(b'\x80\x05\x97\x98.', buffers=[bytearray(b'abc')]); print(type(r), r.readonly, bytes(r))
show(L, b'\x80\x05\x97\x98.', buffers=[1])
show(L, b'\x80\x05\x97.', buffers=[1])

# Extension codes
copyreg.add_extension('__main__', 'C', 240)
copyreg.add_extension('collections', 'OrderedDict', 70000)
copyreg.add_extension('__main__', 'nope', 300)
try:
    for p in range(6):
        print(pickle.dumps(C, p), pickle.dumps(collections.OrderedDict, p), pickle.dumps([C, C], p))
    show(L, b'\x82\xf0.')
    show(L, b'\x84\x70\x11\x01\x00.')
    show(L, b'\x83\x2c\x01.')
    print(sorted(copyreg._extension_cache))
finally:
    copyreg.remove_extension('__main__', 'C', 240)
    copyreg.remove_extension('collections', 'OrderedDict', 70000)
    copyreg.remove_extension('__main__', 'nope', 300)
show(L, b'\x82\xf0.')
copyreg._inverted_registry[241] = 5
show(L, b'\x82\xf1.')
copyreg._inverted_registry[241] = (1, 2)
show(L, b'\x82\xf1.')
copyreg._inverted_registry[241] = ('a', 'b', 'c')
show(L, b'\x82\xf1.')
del copyreg._inverted_registry[241]

# Interned keys, identity through the memo
o = L(pickle.dumps(C(5)))
print(list(o.__dict__)[0] is 'a' or list(o.__dict__)[0] == 'a')
a, b = L(pickle.dumps([[1], [1]])); print(a is b)
x = [1]; a, b = L(pickle.dumps([x, x])); print(a is b)
r = L(pickle.dumps((lambda l: (l.append(l), l)[1])([]))); print(r[0] is r)
for p in range(6):
    t = ([],); t[0].append(t)
    r = L(pickle.dumps(t, p)); print(r[0][0] is r, end=' ')
    fs = C(); fs.s = frozenset([fs]) if False else None
    d = {}; d[1] = d
    r = L(pickle.dumps(d, p)); print(r[1] is r, end=' ')
    c = C(); c.me = c
    r = L(pickle.dumps(c, p)); print(r.me is r)
