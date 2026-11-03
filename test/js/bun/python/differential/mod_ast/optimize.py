import _ast as ast

def dump(node):
    if isinstance(node, ast.AST):
        return type(node).__name__ + '(' + ','.join(n + '=' + dump(getattr(node, n)) for n in node._fields + node._attributes) + ')'
    if isinstance(node, list):
        return '[' + ','.join(dump(x) for x in node) + ']'
    return repr(node)

def show(src, mode='exec', flags=ast.PyCF_OPTIMIZED_AST, **kw):
    try:
        print(dump(compile(src, '<t>', mode, flags, **kw)))
    except Exception as e:
        print(type(e).__name__, e)

for opt in (-1, 0, 1, 2):
    for flags in (ast.PyCF_ONLY_AST, ast.PyCF_OPTIMIZED_AST):
        print(opt, flags)
        show('__debug__', 'eval', flags, optimize=opt)
        show('"doc"\nx = __debug__', 'exec', flags, optimize=opt)
        show('"doc"', 'exec', flags, optimize=opt)
        show('def f():\n    """doc\n    more"""\n', 'exec', flags, optimize=opt)
        show('def f():\n    "doc"\n    return 1\nclass C:\n    "doc"\n    x = 1\nasync def g():\n  "d"', 'exec', flags, optimize=opt)
        show('assert __debug__, "m"', 'exec', flags, optimize=opt)
        show('"doc"; 1', 'single', flags, optimize=opt)

for src in ['"%s" % (a,)', '"%s %r %a" % (a, b, c)', '"x%%y%s" % (a,)', '"%5s|%-5s|%.3s|%5.3s|%05s" % (a, b, c, d, e)', '"%d" % (a,)', '"%s" % (a, b)', '"%s %s" % (a,)', '"%s" % a',
            '"%s" % (*a,)', '"" % ()', '"abc" % ()', '"%%" % ()', '"%" % (a,)', '"%s%" % (a,)', '"%123s" % (a,)', '"%12s" % (a,)', '"%.12s" % (a,)', '"%.123s" % (a,)', '"%.s" % (a,)',
            '"%+s% s%#s" % (a, b, c)', 'b"%s" % (a,)', '"%(k)s" % (a,)', '"%*s" % (a, b)', '"é%s😀" % (a,)', '"%s" % ("%s" % (a,),)', 'x = "%s" % (__debug__,)', '"%0s" % (a,)', '"%-s" % (a,)', '"%-0s" % (a,)',
            '1 + 2', '(1, 2)', '-1', 'not True', '"a" "b"', '[1, 2][0]', '2 ** 10', 'a if True else b', 'f"{1}"', 'x in [1, 2]', 'x in {1, 2}',
            '__debug__ = 1', 'del __debug__', 'f(__debug__=1)', 'lambda __debug__: 0', 'a.__debug__', '[__debug__ for x in y]', 'def f(a=__debug__) -> __debug__: pass', 'def f(a: __debug__): pass', 'x: __debug__ = 1',
            'from __future__ import annotations\ndef f(a: __debug__) -> __debug__: pass\nx: __debug__ = __debug__',
            'class C[T: __debug__ = __debug__](__debug__, m=__debug__): pass', 'type X[*T = __debug__, **P = __debug__] = __debug__',
            'match x:\n case -1: pass\n case +1: pass\n case 1+2j: pass\n case -1.5-2j: pass\n case {-1: a, 1-1j: b}: pass\n case C(-1, k=-2): pass\n case [-1, *r] | (-2 as q): pass\n case -0: pass\n case -0.0: pass\n case -2j: pass\n case 0+0j: pass\n case -0.0-0j: pass',
            'match x:\n case -9223372036854775808: pass\n case -9223372036854775809: pass\n case 123456789012345678901234567890+1j: pass\n case -0x8000000000000000: pass\n case 0xffffffffffffffffffff-1j: pass',
            'match __debug__:\n case x if __debug__: __debug__',
            'with __debug__ as x: pass', 'for x in __debug__: pass\nelse: __debug__', 'while __debug__: pass', 'try: pass\nexcept __debug__: __debug__\nfinally: __debug__', 'raise __debug__ from __debug__',
            'f"{__debug__!r:{__debug__}}"', 't"{__debug__:{__debug__}}"', 'x[__debug__:__debug__:__debug__]', '(y := __debug__)', '{__debug__: __debug__, **__debug__}', '{**__debug__ for x in y}', 'await __debug__', 'return __debug__']:
    print(src.replace('\n', '\\n'))
    show(src)

# From trees.
tree = compile('"doc"\nx = "%s" % (__debug__,)', '<t>', 'exec', ast.PyCF_ONLY_AST)
print(dump(compile(tree, '<t>', 'exec', ast.PyCF_ONLY_AST)))
print(dump(compile(tree, '<t>', 'exec', ast.PyCF_OPTIMIZED_AST)))
print(dump(compile(tree, '<t>', 'exec', ast.PyCF_OPTIMIZED_AST, optimize=2)))
print(dump(compile(tree, '<t>', 'exec', ast.PyCF_ONLY_AST, optimize=2)))

# __future__
for src in ['from __future__ import braces', 'from __future__ import nope', 'x = 1\nfrom __future__ import annotations', '"doc"\nfrom __future__ import annotations, division',
            'from __future__ import barry_as_FLUFL\n1 <> 2', 'from __future__ import *', 'from __future__ import annotations as a']:
    show(src, flags=ast.PyCF_ONLY_AST)
