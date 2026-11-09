# A view is used and dropped; the next statement has an instruction that calls a method of the program's, which resizes the bytearray. The register that the
# instruction will put its result in may still have the view, or what held it: that holds nothing.
import functools
b = bytearray(b'abc')
said = []
def ask(*args, **keywords):
    try:
        b.append(0); b.pop(); said.append('resized')
    except BufferError:
        said.append('BufferError')
    return 1
class Meta(type):
    def __getattr__(cls, name): return ask()
class A(metaclass=Meta):
    def __getattr__(self, name): return ask()
    __add__ = __radd__ = __sub__ = __mul__ = __matmul__ = __or__ = ask
    __eq__ = __ne__ = __lt__ = __ge__ = ask
    __getitem__ = ask
    __hash__ = None
class P:
    "Methods that are no plain functions."
    __add__ = __eq__ = __lt__ = __getitem__ = __getattr__ = functools.partial(ask)
class D:
    def __get__(self, instance, owner): return ask()
class Q:
    x = D()
    y = property(ask)
    z = property(functools.partial(ask))
class R:
    def __radd__(self, other): return ask()
    def __gt__(self, other): return ask()
class G:
    def __getattribute__(self, name): return ask()
def sink(*args): pass
a = A(); p = P(); q = Q(); r = R(); g = G()
EXPRESSIONS = ['a.foo', 'A.foo', 'a + 1', '1 + a', 'a - 1', 'a * 1', 'a @ 1', 'a | 1', 'a == 1', 'a != 1', 'a < 1', 'a >= 1', 'a[0]', 'a[0:1]',
               'p + 1', 'p == 1', 'p < 1', 'p[0]', 'p.foo', 'q.x', 'q.y', 'q.z', '1 + r', '1 < r', 'g.foo', '[] + r']
BEFORE = ['sink(memoryview(b))', 'sink(memoryview(b)[0], memoryview(b)[1], memoryview(b))', 'sink((memoryview(b), 1)[1])']
AROUND = ['sink(%s)', 'sink(1, (2, %s))', 'x = 1 if %s else 2']
for expression in EXPRESSIONS:
    for before in BEFORE:
        for around in AROUND:
            names = dict(globals())
            exec('def f():\n    %s\n    %s\n' % (before, around % expression), names)
            said.clear()
            names['f']()
            if said != ['resized']:
                print(expression, '|', before, '|', around, '|', said)
print(len(EXPRESSIONS) * len(BEFORE) * len(AROUND), 'ways')
