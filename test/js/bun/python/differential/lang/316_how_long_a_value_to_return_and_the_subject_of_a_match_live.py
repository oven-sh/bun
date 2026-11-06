# How long what has no name lives: the value of a `return` while a `finally` clause runs, also one that goes on to leave in a way of its own; the subject of a `match`; the iterator of a loop.
import gc, weakref, warnings
warnings.simplefilter('ignore')
class C:
    def __iter__(s): return s
    def __next__(s): return 1
    def __enter__(s): return s
    def __exit__(s, *a): seen.append(('exit', alive())); return False
def alive():
    gc.collect()
    return W() is not None
def make():
    global W
    o = C(); W = weakref.ref(o)
    return o
def p(tag=''): seen.append(alive()); return True
SRC = {
 'clause': 'try:\n    return make()\nfinally:\n    p()',
 'clause, several lines': 'try:\n    return (\n        make())\nfinally:\n    p()',
 'clause that returns': 'try:\n    return make()\nfinally:\n    p()\n    return 1',
 'clause that may return': 'try:\n    return make()\nfinally:\n    p()\n    if p():\n        p()\n        return 1\n    p()',
 'clause that breaks': 'for i in (1, 2):\n    try:\n        return make()\n    finally:\n        p()\n        break\np()',
 'clause that continues': 'for i in (1, 2):\n    try:\n        return make()\n    finally:\n        p()\n        continue\np()',
 'clause that raises': 'try:\n    try:\n        return make()\n    finally:\n        p()\n        raise KeyError\nexcept KeyError:\n    p()',
 'two clauses': 'try:\n    try:\n        return make()\n    finally:\n        p()\nfinally:\n    p()\n    return 1',
 'clause with a loop': 'try:\n    return make()\nfinally:\n    for i in (1, 2):\n        p()\n    return 1',
 'clause with a try': 'try:\n    return make()\nfinally:\n    try:\n        p()\n        raise KeyError\n    except KeyError:\n        p()\n    return 1',
 'break through an outer clause': 'for i in (1, 2):\n    try:\n        try:\n            return make()\n        finally:\n            p()\n            break\n    finally:\n        p()\np()',
 'continue through an outer clause': 'for i in (1, 2):\n    try:\n        try:\n            return make()\n        finally:\n            p()\n            continue\n    finally:\n        p()\np()',
 'break through an outer clause, the loop last': 'for i in (1, 2):\n    try:\n        try:\n            return make()\n        finally:\n            break\n    finally:\n        p()',
 'gen: break through an outer clause that yields': 'for i in (1, 2):\n    try:\n        try:\n            return make()\n        finally:\n            break\n    finally:\n        yield p()\n        p()\np()',
 'return through an outer clause': 'try:\n    try:\n        return make()\n    finally:\n        p()\n        return 1\nfinally:\n    p()',
 'with': 'with C():\n    return make()',
 'with, several lines': 'with C():\n    return (\n        make())',
 'loop and clause': 'for i in make():\n    try:\n        return 1\n    finally:\n        p()',
 'loop and clause, a value': 'for i in make():\n    try:\n        return C()\n    finally:\n        p()',
 'gen: yield in the clause': 'try:\n    return make()\nfinally:\n    yield p()\n    p()',
 'gen: yield in the clause that returns': 'try:\n    return make()\nfinally:\n    yield p()\n    p()\n    return 1',
 'gen: yield behind what decides': 'try:\n    return make()\nfinally:\n    if p():\n        yield p()\n        p()\n        return 1',
 'match: guard of the last case': 'match make():\n    case C() if p():\n        p()',
 'match: guard, default follows': 'match make():\n    case C() if p():\n        p()\n    case _:\n        pass',
 'match: guard, a case follows': 'match make():\n    case C() if p():\n        p()\n    case C():\n        pass',
 'match: body of the default': 'match make():\n    case 1:\n        pass\n    case _:\n        p()',
 'match: capture': 'match make():\n    case 1:\n        pass\n    case x:\n        p()\n        del x\n        p()',
 'match: return in a case, clause': 'try:\n    match make():\n        case C() if p():\n            return 1\n        case _:\n            pass\nfinally:\n    p()',
 'match in match': 'match make():\n    case C():\n        match 1:\n            case 1 if p():\n                p()\n    case _:\n        pass',
}
def indent(t): return '\n'.join('    ' + l for l in t.split('\n'))
for name, body in SRC.items():
    ns = dict(globals())
    exec('def f():\n' + indent(body), ns)
    seen = ns['seen'] = []
    globals()['seen'] = seen
    r = ns['f']()
    if hasattr(r, 'send'):
        try:
            while True:
                r.send(None); seen.append(('suspended', alive()))
        except StopIteration as e: r = e.value
    r = type(r).__name__
    print(name, '|', seen, r)
