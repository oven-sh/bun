# gc.collect(), and a resize that finds exports, empty the registers that the code of each frame will not read again. Here
# they are called in the middle of all kinds of expressions and statements, whose operands had better survive.
import gc
buf = bytearray(b'x'); held = memoryview(buf)
calls = 0
def c(v):
    global calls
    calls += 1
    if calls % 40 == 0: gc.collect()
    view = held                 # found in this frame, after all the frames have been gone through
    try: buf.append(1)
    except BufferError: pass
    return v
def new(*a): return ['n', *a]
def f(*a, **k): return (a, sorted(k.items()))
class O:
    def __init__(self, v): self.v = v
    def m(self, *a, **k): return (self.v, a, sorted(k.items()))
    def __enter__(self): return c([self.v, 'enter'])
    def __exit__(self, *e): c(None); return self.v == 'swallow'
    def __getitem__(self, k): return c((self.v, k))
    def __add__(self, o): return c(O([self.v, o.v]))
    def __repr__(self): return 'O(%r)' % (self.v,)
print(c(new(1)) + c(new(2)) * c(2), c('a') + c('b') + c('c'), (c(new(1)), c(new(2)), (c(new(3)), [c(new(4))])), {c('k'): c(new(5)), **c({'z': new(6)})}, {c('s1'), c('s2')} == {'s1', 's2'})
print(f(c(new(1)), *c([new(2), new(3)]), k=c(new(4)), **c({'z': new(5)})), f(*c([new(1)]), *c((new(2),))), O(new(0)).m(c(new(1)), x=c(new(2))), c(O(new(9))).m(c(new(1))))
print([c(new(i)) for i in range(3)], [[c((i, j)) for j in c(range(2))] for i in c(range(2))], {c(str(i)): c(new(i)) for i in range(2)}, sorted({c(str(i)) for i in range(3)}), list(c(new(i)) for i in c(range(2))), [x for x in c([new(1), new(2)]) if c(x)])
x = [new(0), new(1), new(2), new(3)]
print(x[c(0)][c(1)], x[c(1):c(3)], c(x)[c(-1)], O('o')[c(new(1))], O('o')[c(1):c(2)], O(new(1)) + O(new(2)) + O(new(3)))
x[c(0)] += c(['+']); x[c(1)][c(0)] = c(new('set')); print(x)
o = O(new(1)); o.v += c(['a']); o.w = c(new(2)); print(o.v, o.w, c(o).v, getattr(c(o), c('w')))
print(c(1) < c(2) < c(3), c(new(1)) and c(new(2)), c([]) or c(new(3)), c(new(1)) if c(True) else c(new(2)), not c([]), c(new(1)) is not c(None), c('a') in c(['a']), (y := c(new(7))), y)
print(f"{c(new(1))}{c('a')!r:>{c(5)}}|{c(3.5):{c('.')}{c(2)}f}", '%s-%s' % (c(new(1)), c(new(2))), '{}{k}'.format(c(new(1)), k=c(new(2))))
a, *b, d = c([new(1), new(2), new(3), new(4)]); (p, q), r = c((new(1)[:2], new(2))); print(a, b, d, p, q, r)
with O(new('w1')) as v1, O(new('w2')) as v2:
    print(c(v1), c(v2))
with O('swallow') as v:
    raise KeyError(c(new('k')))
def tryit(n):
    out = []
    try:
        out.append(c(new('try', n)))
        if n == 1: raise ValueError(c(new('boom')))
        if n == 2: return c(out + ['returned'])
    except ValueError as e:
        out.append(c(e.args))
        if n == 1: out.append(c(new('handled')))
    else:
        out.append(c(new('else')))
    finally:
        out.append(c(new('finally')))
    return c(out)
print(tryit(0), tryit(1), tryit(2))
def nested():
    try:
        try:
            raise KeyError(c(new(1)))
        finally:
            c(new(2))
    except KeyError as e:
        try:
            raise ValueError(c(new(3))) from c(e)
        except ValueError as e2:
            return c((e2.args, e2.__cause__.args, type(e2.__context__).__name__))
print(nested())
out = []
for i in c([new(1), new(2), new(3)]):
    if c(i[1]) == 2: continue
    for j in c(range(c(2))):
        out.append(c((i, j)))
        if c(j): break
    else:
        out.append('no break')
else:
    out.append(c('done'))
print(out)
n = 0
while c(n) < c(3):
    n += c(1)
print(n)
def gen(k):
    got = yield c(new('first', k))
    got2 = yield c(new('second', got))
    try:
        yield from c([new(1), new(2)])
        yield from sub(c(new('arg')))
    finally:
        c(new('closing'))
    return c(new('result', got2))
def sub(a):
    r = yield c(a)
    yield c([a, r])
g = gen(c(new('k'))); print(next(g), g.send(c(new('s1'))), g.send(c(new('s2'))), next(g), next(g), g.send(c(new('s3'))))
try: next(g)
except StopIteration as e: print(c(e.value))
g = gen(1); next(g); c(None); g.close(); print(list(zip(gen(1), c(range(2)))))
async def co(v):
    return c(new('co', await aw(c(v))))
class aw:
    def __init__(self, v): self.v = v
    def __await__(self):
        r = yield c(new('suspended', self.v))
        return c([self.v, r])
k = co(new('v')); print(k.send(None))
try: k.send(c(new('resumed')))
except StopIteration as e: print(e.value)
def deco(tag):
    return lambda fn: c((tag, fn))
@deco(c(new('d1')))
@deco(c(new('d2')))
def decorated(a=c(new('default')), *, kw=c(new('kwdefault'))): pass
print(decorated[0], decorated[1][0], decorated[1][1].__defaults__, decorated[1][1].__kwdefaults__)
class K(c(O), metaclass=c(type)):
    attr = c(new('attr'))
    other = [c(i) for i in range(2)]
    def meth(self, a=c(new('md'))): return c(a)
print(K.attr, K.other, K(1).meth(), K.__mro__[1].__name__)
def closure():
    cell = c(new('cell'))
    def inner(): return c(cell)
    return c(inner)
print(closure()(), (lambda a, b=c(new('lb')): c((a, b)))(c(new('la'))))
def matcher(v):
    match c(v):
        case [a, b] if c(a):
            return c(('two', a, b))
        case {'k': val, **rest}:
            return c(('map', val, rest))
        case O(v=inner):
            return c(('obj', inner))
        case str() | int() as s:
            return c(('scalar', s))
        case _:
            return c('other')
print(matcher([new(1), new(2)]), matcher({'k': new(1), 'z': new(2)}), matcher(O(new(3))), matcher('s'), matcher([0, 1]), matcher(None))
def rec(n, acc): return c(acc) if not n else rec(n - 1, c(acc + [new(n)]))
print(rec(5, []))
print(sorted(c([new(3), new(1), new(2)]), key=lambda v: c(v[1])), list(map(lambda v: c(v), c([new(1)]))), max(c([new(1), new(2)]), key=lambda v: c(v)), sum(c([[1], [2]]), c([])))
del x[c(0)], x[c(0):c(1)]; print(x)
assert c(new(1)), c('message')
import sys as s1, os.path as s2; print(c(s1).__name__, c(s2).__name__ in ('posixpath', 'ntpath'))
print(len(buf), held.tobytes())
