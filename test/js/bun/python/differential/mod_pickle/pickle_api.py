import pickle, _pickle, io, collections, copyreg, sys, gc, weakref, pickletools

def show(f, *a, **k):
    try:
        r = f(*a, **k)
        print(repr(r))
    except BaseException as e:
        print(type(e).__name__, e, getattr(e, '__notes__', None), type(e.__context__).__name__)

P, U = pickle.Pickler, pickle.Unpickler
print(P.__name__, P.__qualname__, P.__module__, P.__bases__, U.__name__, U.__module__)
print(sorted(n for n in dir(P) if not n.startswith('__')), sorted(n for n in dir(U) if not n.startswith('__')))
print(pickle.PickleError.__mro__, pickle.PicklingError.__mro__, pickle.UnpicklingError.__mro__)
print(P.__doc__ == None, U.__doc__ == None, P.__doc__[:40], U.__doc__[:40])

class C:
    def __init__(self, a=1): self.a = a
    def __repr__(self): return 'C(%r)' % (self.a,)

# Construction
show(P); show(P, 1); show(P, None); show(P, io.BytesIO(), 6); show(P, io.BytesIO(), 'a'); show(P, io.BytesIO(), 2**70); show(P, io.BytesIO(), 1.5); show(P, io.BytesIO(), 2, True, 1)
show(P, io.BytesIO(), 5, True, None, 1); show(P, io.BytesIO(), foo=1); show(P, file=1); show(lambda: type(P(file=io.BytesIO(), protocol=-1, fix_imports=0, buffer_callback=None)))
show(U); show(U, 1); show(U, None); show(U, io.BytesIO(), 1); show(U, io.BytesIO(), encoding=1); show(U, io.BytesIO(), errors=1); show(U, io.BytesIO(), encoding='a\0b'); show(U, io.BytesIO(), buffers=1); show(U, io.BytesIO(), foo=1)
show(lambda: type(U(file=io.BytesIO(), fix_imports=0, encoding='x', errors='y', buffers=None)))
class OnlyRead:
    def read(self, n): return b''
class OnlyReadline:
    def readline(self): return b''
show(U, OnlyRead()); show(U, OnlyReadline())
show(P.__new__(P).dump, 1); show(U.__new__(U).load)
class BadInitP(P):
    def __init__(self): pass
class BadInitU(U):
    def __init__(self): pass
show(BadInitP().dump, 1); show(BadInitU().load)
show(BadInitP().clear_memo)

# Attributes
f = io.BytesIO(); p = P(f, 2)
print(p.bin, p.fast)
show(lambda: p.dispatch_table); show(setattr, p, 'foo', 1); show(lambda: p.foo); show(delattr, p, 'dispatch_table'); show(setattr, p, 'fast', 'a'); show(delattr, p, 'fast'); show(delattr, p, 'bin')
show(delattr, p, 'memo'); show(setattr, p, 'memo', 1); show(setattr, p, 'memo', {1: 2}); show(setattr, p, 'memo', {1: (1, 2, 3)}); show(setattr, p, 'memo', {1: ('a', 2)})
p.fast = 5; print(p.fast); p.fast = True; print(p.fast); p.fast = 0; p.bin = 7; print(p.bin); p.bin = 1
p.dispatch_table = {}; print(p.dispatch_table); del p.dispatch_table; show(lambda: p.dispatch_table)
print(P(f, 0).bin, P(f, 1).bin, P(f).bin, type(p.memo).__name__, type(p.memo).__module__)
print(type(P.__dict__['bin']).__name__, type(P.__dict__['memo']).__name__, type(P.__dict__['dispatch_table']).__name__, type(P.__dict__['persistent_id']).__name__, type(P.__dict__['dump']).__name__)
show(hash, p.memo); show(lambda: p.memo == p.memo)
show(p.dump); show(p.dump, 1, 2); show(p.clear_memo, 1); show(lambda: p.__sizeof__() > 0); show(lambda: U(f).__sizeof__() > 0)
show(pickle.dumps, p); show(pickle.dumps, U(f)); show(pickle.dumps, p.memo)
show(setattr, P, 'x', 1)
u = U(io.BytesIO())
show(setattr, u, 'foo', 1); show(lambda: u.foo); show(delattr, u, 'memo'); show(setattr, u, 'memo', 1); show(setattr, u, 'memo', {'a': 1}); show(setattr, u, 'memo', {-1: 1}); show(setattr, u, 'memo', {2**70: 1})
show(lambda: type(u.memo).__name__); show(hash, u.memo); show(u.load, 1); show(u.find_class); show(u.find_class, 'os'); show(u.find_class, 'builtins', 'len'); show(u.find_class, 1, 2); show(u.find_class, 'builtins', 1)
show(u.find_class, 'builtins', 'nope'); show(u.find_class, 'nope_mod', 'x'); show(u.find_class, 'builtins', 'int.real'); show(u.find_class, '__builtin__', 'unicode'); show(u.persistent_load, 1); show(u.persistent_load)

# The memo of a pickler
f = io.BytesIO(); p = P(f, 2)
x = [1, 'abc']
p.dump(x); n1 = f.tell(); p.dump(x); n2 = f.tell()
print(f.getvalue(), n1, n2)
m = p.memo.copy(); print(sorted(v[0] for v in m.values()), [v[1] for k, v in sorted(m.items(), key=lambda kv: kv[1][0])], all(k == id(v[1]) for k, v in m.items()))
print(p.memo.__reduce__()[0], len(p.memo.__reduce__()[1][0]))
p.clear_memo(); print(p.memo.copy()); p.dump(x); print(f.getvalue()[n2:])
p.memo.clear(); print(p.memo.copy())
q = P(io.BytesIO(), 2); p.dump(x); q.memo = p.memo; print(len(q.memo.copy())); q.memo = p.memo.copy(); print(len(q.memo.copy()))
g = io.BytesIO(); q = P(g, 2); q.memo = p.memo; q.dump(x); print(g.getvalue())
g = io.BytesIO(); q = P(g, 2); q.memo = {0: (300, x)}; q.dump([x]); print(g.getvalue())
g = io.BytesIO(); q = P(g, 0); q.memo = {0: (300, x)}; q.dump([x]); print(g.getvalue())
# and of an unpickler
data = pickle.dumps([x, x], 2) + pickle.dumps('second', 2)
u = U(io.BytesIO(data)); print(u.load(), u.memo.copy(), u.load(), u.memo.copy())
print(u.memo.__reduce__()); u.memo.clear(); print(u.memo.copy())
v = U(io.BytesIO(b'K\x01q\x00K\x02q\x07.')); v.load(); w = U(io.BytesIO(b'h\x07.')); w.memo = v.memo; print(w.memo.copy(), w.load())
show(U(io.BytesIO(b'')).load); show(U(io.BytesIO(b'N')).load)

# fast mode
for proto in range(6):
    f = io.BytesIO(); p = P(f, proto); p.fast = 1; p.dump([x, x, (1, 2), {'a': x}, 'abc', b'b', {1}, frozenset([2]), C()]); print(f.getvalue(), p.memo.copy())
l = []; l.append(l)
f = io.BytesIO(); p = P(f, 2); p.fast = 1
try: p.dump(l)
except ValueError as e: print('ValueError', str(e).split(' at ')[0])
d = {}; d[1] = d
try: p.dump(d)
except ValueError as e: print('ValueError', str(e).split(' at ')[0])

# persistent ids
class PP(P):
    def persistent_id(self, obj):
        if isinstance(obj, C): return ('C', obj.a)
        if obj == 'none': return None
        if obj == 'str': return 'the-id'
        if obj == 'boom': raise KeyError('pid')
        if obj == 'uni': return 'é'
        return None
class PU(U):
    def persistent_load(self, pid):
        if pid == 'bad': raise KeyError('pload')
        return ('loaded', pid)
for proto in range(6):
    f = io.BytesIO()
    try:
        PP(f, proto).dump([C(1), 'none', 'str', C(1), 5])
        print(f.getvalue(), PU(io.BytesIO(f.getvalue())).load())
    except BaseException as e: print(type(e).__name__, e)
show(PP(io.BytesIO(), 2).dump, 'boom'); show(PP(io.BytesIO(), 0).dump, 'uni'); show(PP(io.BytesIO(), 1).dump, 'uni')
show(U(io.BytesIO(b'Pabc\n.')).load); show(U(io.BytesIO(b'K\x01Q.')).load); show(PU(io.BytesIO(b'Pbad\n.')).load); show(PU(io.BytesIO(b'P\n.')).load); show(PU(io.BytesIO(b'P\xe9\n.')).load)
f = io.BytesIO(); p = P(f, 2); print(p.persistent_id(1), p.persistent_id.__name__, P.persistent_id(p, 5))
calls = []
def pid(o): calls.append(o); return None
p.persistent_id = pid; print(p.persistent_id is pid); p.dump([1, 'a']); print(calls, f.getvalue())
del p.persistent_id; print(p.persistent_id.__name__, p.persistent_id(3)); del p.persistent_id
p.persistent_id = 5; show(p.dump, 1)
u = U(io.BytesIO(b'K\x07Q.')); u.persistent_load = lambda pid: ('attr', pid); print(u.load()); del u.persistent_load; show(u.persistent_load, 1); del u.persistent_load
class Sup(P):
    def persistent_id(self, obj): return super().persistent_id(obj)
f = io.BytesIO(); Sup(f, 2).dump([1]); print(f.getvalue())
class SupU(U):
    def persistent_load(self, pid): return super().persistent_load(pid)
show(SupU(io.BytesIO(b'K\x07Q.')).load)
class Inst(P):
    def persistent_id(self, obj): raise AssertionError('never')
f = io.BytesIO(); ip = Inst(f, 2); ip.persistent_id = lambda o: None; ip.dump(1); print(f.getvalue())

# dispatch tables, reducer_override
def red_c(o): return (C, (o.a + 100,))
f = io.BytesIO(); p = P(f, 2); p.dispatch_table = {C: red_c}; p.dump(C(1)); print(pickle.loads(f.getvalue()))
class DP(P):
    dispatch_table = {C: red_c}
f = io.BytesIO(); dp = DP(f, 2); print(dp.dispatch_table is DP.dispatch_table); dp.dump(C(2)); print(pickle.loads(f.getvalue()))
f = io.BytesIO(); p = P(f, 2); p.dispatch_table = collections.ChainMap({C: red_c}, copyreg.dispatch_table); p.dump([C(3), 1j]); print(pickle.loads(f.getvalue()))
f = io.BytesIO(); p = P(f, 2); p.dispatch_table = {}; p.dump([C(4), 1j]); print(pickle.loads(f.getvalue()))
p.dispatch_table = 5; show(p.dump, C(1))
class BadMap:
    def __getitem__(self, k): raise ValueError('map')
p.dispatch_table = BadMap(); show(p.dump, C(1))
p.dispatch_table = {C: 5}; show(p.dump, C(1))
p.dispatch_table = {C: lambda o: 5}; show(p.dump, C(1))
copyreg.pickle(C, red_c); print(pickle.loads(pickle.dumps(C(5)))); del copyreg.dispatch_table[C]
class RO(P):
    def reducer_override(self, obj):
        if isinstance(obj, C): return (C, (obj.a * 2,))
        if obj is len: return (C, ('len',))
        if obj == 'x': raise AssertionError('not for str')
        if isinstance(obj, complex): return 'complex'
        if isinstance(obj, range): return 5
        if isinstance(obj, slice): raise KeyError('ro')
        return NotImplemented
for v in (C(4), len, C, [C(1), 'x', 1, (2,)], print, int, 1j, range(2), slice(1)):
    f = io.BytesIO()
    try: RO(f, 2).dump(v); print(pickle.loads(f.getvalue()))
    except BaseException as e: print(type(e).__name__, e, getattr(e, '__notes__', None))
f = io.BytesIO(); p = P(f, 2)
show(setattr, p, 'reducer_override', 1)

# find_class
class FU(U):
    def find_class(self, module, name):
        print('find_class', module, name)
        if name == 'boom': raise KeyError('fc')
        return super().find_class(module, name)
for proto in range(6):
    print(FU(io.BytesIO(pickle.dumps([C, len, collections.OrderedDict, C(1)], proto))).load())
show(FU(io.BytesIO(b'cx\nboom\n.')).load)

# Re-entrancy
class Reenter:
    def __reduce__(self):
        try: the_pickler.dump(1)
        except BaseException as e: print(type(e).__name__, e)
        try: the_pickler.__init__(io.BytesIO())
        except BaseException as e: print(type(e).__name__, e)
        return (int, ())
the_pickler = P(io.BytesIO(), 2); the_pickler.dump(Reenter()); the_pickler.dump(1)
def reload_():
    try: the_unpickler.load()
    except BaseException as e: print(type(e).__name__, e)
    try: the_unpickler.__init__(io.BytesIO())
    except BaseException as e: print(type(e).__name__, e)
    return 7
the_unpickler = U(io.BytesIO(b'c__main__\nreload_\n)R.')); print(the_unpickler.load())
# __init__ again
f1, f2 = io.BytesIO(), io.BytesIO(); p = P(f1, 2); p.dump(x); p.__init__(f2, 0); print(p.memo.copy(), p.bin); p.dump(x); print(f2.getvalue())

# dump, load, files
f = io.BytesIO(); print(pickle.dump([1, 2], f), f.getvalue()); f.seek(0); print(pickle.load(f), f.tell())
f = io.BytesIO(); pickle.dump(1, f, 0); pickle.dump('two', f, 2); pickle.dump([3], f, 4); pickle.dump({4}, f); f.write(b'tail'); f.seek(0)
print([pickle.load(f) for i in range(4)], f.read())
f.seek(0); u = U(f); print([u.load() for i in range(4)], f.read()); show(u.load)
show(pickle.dump); show(pickle.dump, 1); show(pickle.dump, 1, 1); show(pickle.dump, 1, io.BytesIO(), 2, True); show(pickle.dump, 1, io.BytesIO(), 9); show(pickle.dump, obj=1, file=io.BytesIO(), protocol=2, fix_imports=True, buffer_callback=None)
show(pickle.load); show(pickle.load, 1); show(pickle.load, io.BytesIO(b'N.'), 1); show(pickle.load, io.StringIO('N.')); show(pickle.load, file=io.BytesIO(b'N.')); show(pickle.load, io.BytesIO(b'N.'), encoding=1)
show(pickle.dumps); show(pickle.dumps, 1, 2, 3); show(pickle.dumps, 1, protocol=-1); show(pickle.dumps, 1, 2**70); show(pickle.dumps, 1, 'a'); show(pickle.dumps, 1, None, buffer_callback=print); show(pickle.dumps, 1, 4, buffer_callback=print); show(pickle.dumps, 1, foo=1); show(pickle.dumps, obj=1)
class W:
    def __init__(self): self.calls = []
    def write(self, b): self.calls.append((type(b).__name__, len(b)))
class WBad:
    def write(self, b): raise OSError('full')
show(pickle.dump, 1, WBad()); show(P(WBad()).dump, 1)
class R:
    def __init__(self, data, kind=bytes): self.f = io.BytesIO(data); self.kind = kind; self.calls = []
    def read(self, n): self.calls.append(('read', n)); return self.kind(self.f.read(n))
    def readline(self): self.calls.append(('readline',)); return self.kind(self.f.readline())
for proto in range(6):
    r = R(pickle.dumps([1, 'abc', b'xyz', (1.5, None)], proto)); print(pickle.load(r), r.calls)
for kind in (bytearray, memoryview, lambda b: b.decode('latin-1'), lambda b: None, lambda b: list(b)):
    show(pickle.load, R(pickle.dumps([1, 'abc'], 0), kind)); show(pickle.load, R(pickle.dumps([1, 'abc'], 2), kind)); show(pickle.load, R(pickle.dumps([1, b'abc' * 10], 4), kind))
class RShort(R):
    def read(self, n): return self.f.read(max(n - 1, 0))
show(pickle.load, RShort(pickle.dumps([1, 'abc'], 2))); show(pickle.load, RShort(pickle.dumps([1, 'abc'], 4)))
class RErr(R):
    def read(self, n): raise OSError('read')
    def readline(self): raise OSError('readline')
show(pickle.load, RErr(b'N.'))

# Framing
big = ['%0100d' % i for i in range(2000)]
for proto in (3, 4, 5):
    w = W(); pickle.dump(big, w, proto); print(proto, w.calls)
    d = pickle.dumps(big, proto); print(len(d), d.count(b'\x95'), [op.name for op, a, pos in pickletools.genops(d)].count('FRAME'), pickle.loads(d) == big)
for size in (0, 3, 4, 65535, 65536, 65537, 200000):
    for v in (b'b' * size, 'u' * size, bytearray(b'a' * size)):
        w = W(); pickle.dump([1, v, 2], w, 5); d = pickle.dumps([1, v, 2], 5)
        print(size, type(v).__name__, w.calls, len(d), [(op.name, pos) for op, a, pos in pickletools.genops(d) if op.name == 'FRAME'], pickle.loads(d) == [1, v, 2], pickle.load(io.BytesIO(d)) == [1, v, 2], pickle.load(R(d)) == [1, v, 2])
print(pickle.dumps(None, 4), pickle.dumps(1, 4), pickle.dumps(300, 4), pickle.dumps(70000, 4), pickle.dumps('a', 4))

# PickleBuffer
PB = pickle.PickleBuffer
for v in (b'abc', bytearray(b'abc'), memoryview(b'abc'), memoryview(bytearray(b'abcd'))[1:3]):
    for proto in range(6):
        show(pickle.dumps, PB(v), proto)
    bufs = []; d = pickle.dumps([PB(v), PB(v)], 5, buffer_callback=bufs.append); print(d, len(bufs), [bytes(b) for b in bufs]); r = pickle.loads(d, buffers=bufs); print([type(i).__name__ for i in r], [bytes(i) for i in r])
    show(pickle.dumps, PB(v), 5, buffer_callback=lambda b: True); show(pickle.dumps, PB(v), 5, buffer_callback=lambda b: 0)
show(pickle.dumps, PB(memoryview(b'abcdef')[::2]), 5); show(pickle.dumps, PB(b'x'), 5, buffer_callback=lambda b: 1 / 0); show(pickle.dumps, PB(b'x'), 5, buffer_callback=5)
pb = PB(b'x'); pb.release(); show(pickle.dumps, pb, 5)
same = PB(b'shared'); print(pickle.dumps([same, same], 5))
