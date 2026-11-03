import symtable

src = '''
import sys
from os import path as p
glob = 1
def outer(a, b=2, *args, c, **kw):
    "doc"
    global glob
    x = a
    def inner(y):
        nonlocal x
        x = y + glob + free_global
        return [x + i for i in range(y)]
    lam = lambda q: q + x
    return inner
class K(Base, metaclass=M):
    attr: int = 1
    other = attr
    def method(self):
        return __class__, self.attr
    @staticmethod
    def sm(): pass
    @classmethod
    def cm(cls): pass
    async def am(self): pass
    def gen(self): yield
    nested = [z for z in other]
    class Inner: pass
def generic[T: int, *Ts, **P](v: T = 1) -> T:
    return v
class G[U]:
    def m(self, u: U): pass
type Alias[V] = list[V]
ann: int
'''
def show(t, indent=0):
    pad = ' ' * indent
    print(pad + repr(t).replace(str(t.get_id()), 'ID'))
    print(pad, t.get_type(), t.get_name(), t.get_lineno(), t.is_optimized(), t.is_nested(), t.has_children(), sorted(t.get_identifiers()))
    if isinstance(t, symtable.Function):
        print(pad, 'function', t.get_parameters(), sorted(t.get_locals()), sorted(t.get_globals()), sorted(t.get_nonlocals()), sorted(t.get_frees()), sorted(t.get_cells()))
    if isinstance(t, symtable.Class):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            print(pad, 'class', t.get_methods())
    for s in sorted(t.get_symbols(), key=lambda s: s.get_name()):
        print(pad, ' ', repr(s), s.is_referenced(), s.is_parameter(), s.is_type_parameter(), s.is_global(), s.is_nonlocal(), s.is_declared_global(), s.is_local(), s.is_annotated(),
              s.is_free(), s.is_free_class(), s.is_imported(), s.is_assigned(), s.is_comp_iter(), s.is_comp_cell(), s.is_namespace(), len(s.get_namespaces()))
    for c in t.get_children():
        show(c, indent + 2)
top = symtable.symtable(src, 'file.py', 'exec')
show(top)
print(top.lookup('outer').get_namespace().get_name(), top.lookup('K').get_namespace().get_type())
print(symtable.symtable('x + y', 'e', 'eval').get_identifiers())
try:
    top.lookup('nope')
except KeyError as e:
    print('KeyError', e)
try:
    symtable.symtable('def f(x, x): pass', 'bad.py', 'exec')
except SyntaxError as e:
    print(type(e).__name__, e)
print(top.get_children()[0] is top.get_children()[0], symtable.SymbolTableType.FUNCTION)
