# A namespace is a dict, and a dict may have a key that is no str, hashes like the name m and says that it is equal to it. Then reading, storing and deleting m
# by name all come by that key: what is stored is stored with it, and is what the next read finds.
import builtins, os, subprocess, sys, types, warnings
warnings.simplefilter('ignore')

class Key:
    def __init__(self, name='m'): self.name = name
    def __hash__(self): return hash(self.name)
    def __eq__(self, other): return other == self.name if type(other) is str else self is other
    def __repr__(self): return 'Key(%s)' % self.name

def T(f):
    try: return f()
    except BaseException as e: return '%s: %s' % (type(e).__name__, e)
def items(d): return [(k, v) for k, v in d.items() if not (type(k) is str and k.startswith('__'))]

# How often a key is asked that has the hash of the name and says no. A name is looked for among the locals, the globals and the builtins, one after the other, also where
# the locals are the globals: at the top of a module, in exec() and eval() with one dict.
# (How often also depends on the slots that a search comes by, and so on the hash of the name: in children with a PYTHONHASHSEED.)
def counts():
    asked = []
    class No:
        def __init__(self, name, label): self.name, self.label = name, label
        def __hash__(self): return hash(self.name)
        def __eq__(self, other): asked.append(self.label); return False
    def count(label, f):
        del asked[:]
        r = T(f)
        print(label, '|', ' '.join(asked), '|', r if isinstance(r, (str, int)) else type(r).__name__)
    read = compile('m', '<read>', 'eval')
    statement = compile('r = m', '<statement>', 'exec')
    function = 'def f(): return m\nr = f()'
    for where in ('nowhere', 'globals', 'builtins', 'locals'):
        def spaces():
            b = {No('m', 'b'): 0}
            g = {'__builtins__': b, No('m', 'g'): 0}
            l = {No('m', 'l'): 0}
            {'nowhere': {}, 'globals': g, 'builtins': b, 'locals': l}[where]['m'] = 'found'
            del asked[:]
            return g, l
        g, l = spaces(); count('m is %s: eval(code, g)' % where, lambda: eval(read, g))
        g, l = spaces(); count('m is %s: exec(code, g)' % where, lambda: exec(statement, g))
        g, l = spaces(); count('m is %s: eval(code, g, g)' % where, lambda: eval(read, g, g))
        g, l = spaces(); count('m is %s: eval(code, g, l)' % where, lambda: eval(read, g, l))
        g, l = spaces(); count('m is %s: in a function' % where, lambda: exec(function, g))
        g, l = spaces(); count('m is %s: three times' % where, lambda: [T(lambda: eval(read, g)) for i in range(3)] and None)
        g, l = spaces(); count('m is %s: the body of a class' % where, lambda: exec('class C:\n    r = m', g))
        g, l = spaces(); count('m is %s: del m' % where, lambda: exec('del m', g))
        g, l = spaces(); count('m is %s: m = 1' % where, lambda: exec('m = 1', g))
if sys.argv[1:] == ['counts']:
    counts()
    sys.exit()

# ---- By attribute ----
def a_class(): C = type('C', (), {Key(): 'old'}); return C, C.__dict__
def a_base(): B = type('B', (), {Key(): 'old'}); return type('C', (B,), {}), B.__dict__
def an_instance_of_it(): C = type('C', (), {Key(): 'old'}); return C(), C.__dict__
def a_class_of_a_metaclass(): M = type('M', (type,), {Key(): 'old'}); return M('C', (), {}), M.__dict__
def an_instance(): o = type('C', (), {})(); o.__dict__[Key()] = 'old'; return o, o.__dict__
def a_module(): o = types.ModuleType('mod'); o.__dict__[Key()] = 'old'; return o, o.__dict__
def a_namespace(): o = types.SimpleNamespace(); o.__dict__[Key()] = 'old'; return o, o.__dict__
def a_function():
    def f(): pass
    f.__dict__[Key()] = 'old'; return f, f.__dict__
for make in (a_class, a_base, an_instance_of_it, a_class_of_a_metaclass, an_instance, a_module, a_namespace, a_function):
    o, d = make()
    print(make.__name__, 'read', T(lambda: o.m), T(lambda: getattr(o, 'm')), hasattr(o, 'm'), items(d))
    print('  store', T(lambda: setattr(o, 'm', 'new')), T(lambda: o.m), items(d), items(getattr(o, '__dict__', {})) if d is not getattr(o, '__dict__', None) else '')
    o.m = 'newer'
    print('  store again', T(lambda: o.m), items(d))
    print('  del', T(lambda: delattr(o, 'm')), T(lambda: o.m), items(d))
    print('  del again', T(lambda: delattr(o, 'm')), T(lambda: o.m), items(d))
    o, d = make()
    print('  del first', T(lambda: delattr(o, 'm')), T(lambda: o.m), items(d))
    print('  then store', T(lambda: setattr(o, 'm', 'new')), T(lambda: o.m), items(d))

# ---- By name ----
def run(source, g, l=None): return T(lambda: exec(source, g) if l is None else exec(source, g, l))
for label, source in (('read', 'r = m'), ('store', 'm = "new"; r = m'), ('store twice', 'm = 1; m = 2; r = m'), ('del', 'del m'), ('del, read', 'del m; r = m'), ('del, store', 'del m; m = "new"; r = m'), ('augmented', 'm += "er"; r = m'),
                      ('for', 'for m in "xy": pass\nr = m'), ('import', 'import types as m; r = m.__name__'), ('def', 'def m(): pass\nr = m.__name__'), ('class', 'class m: pass\nr = m.__name__'), ('with', 'import contextlib\nwith contextlib.nullcontext("cm") as m: pass\nr = m'),
                      ('in a function', 'def f(): return m\nr = f()'), ('global in a function', 'def f():\n    global m\n    m = "new"\nf(); r = m'), ('global, del', 'def f():\n    global m\n    del m\nf()'),
                      ('many times', 'def f():\n    global m\n    for i in range(300): m = i\n    return m\nr = f(), m')):
    def shown(d): return [(k, v if isinstance(v, (str, int, tuple)) else type(v).__name__) for k, v in d.items() if k not in ('__builtins__', 'f', 'contextlib')]
    g = {Key(): 'old'}
    print('globals,', label, run(source, g), shown(g))
    g, l = {}, {Key(): 'old'}
    print('locals,', label, run(source, g, l), shown(g), shown(l))
    g, l = {Key(): 'old'}, {}
    print('globals behind locals,', label, run(source, g, l), shown(g), shown(l))

# The body of a class whose namespace comes with such a key.
class Meta(type):
    @classmethod
    def __prepare__(cls, name, bases): return {Key(): 'old'}
def body(source):
    g = {'Meta': Meta}
    r = run('class C(metaclass=Meta):\n' + ''.join('    %s\n' % line for line in source.split('\n')), g)
    return r, items(g['C'].__dict__) if 'C' in g else None
for source in ('r = m', 'm = "new"\nr = m', 'del m', 'del m\nm = "new"', 'def m(self): pass\nr = m.__name__'):
    print('class body,', source.replace('\n', '; '), [(k, v if isinstance(v, str) else type(v).__name__) for k, v in (body(source)[1] or [])], body(source)[0])

# A name of the builtins, in the globals under such a key; and such a key in the builtins of a function.
g = {Key('len'): lambda x: 'mine'}
print('shadowed builtin', run('r = len("abc")\ndef f(): return [len("abc") for i in range(3)]\ns = f()', g), g.get('r'), g.get('s'))
b = dict(vars(builtins)); b[Key('mine')] = 'from the builtins'
g = {'__builtins__': b}
print('in the builtins', run('r = mine\ndef f(): return mine\ns = f()', g), g.get('r'), g.get('s'))

# ---- How often ----
for hashseed in ('0', '1', '12345'):
    child = subprocess.run([sys.executable, __file__, 'counts'], env=dict(os.environ, PYTHONHASHSEED=hashseed), stdout=subprocess.PIPE, text=True)
    print('PYTHONHASHSEED', hashseed, 'status', child.returncode)
    print(child.stdout, end='')
