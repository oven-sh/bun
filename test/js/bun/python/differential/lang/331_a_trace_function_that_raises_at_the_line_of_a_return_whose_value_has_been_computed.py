# A trace function raises when it is told of the line of a `return (` whose value, with several ways through it, has been computed: which `try`, `with`, loop and handler is it still in?
import sys, warnings
warnings.simplefilter('ignore')
def c(v): return v
class E(Exception): pass
R = {'try except in try finally': '''def f(a, b, d):
    try:
        try:
            return (
                b if a else
                d)
        except E:
            LOG.append('caught'); return 'handled'
    finally:
        LOG.append('finally')
''', 'try finally': '''def f(a, b, d):
    try:
        return (
            b if a else
            d)
    finally:
        LOG.append('finally')
''', 'with in try finally': '''def f(a, b, d):
    try:
        with W():
            return (
                b if a else
                d)
    finally:
        LOG.append('finally')
''', 'loop in try finally': '''def f(a, b, d):
    try:
        for i in gen():
            return (
                b if a else
                d)
    finally:
        LOG.append('finally')
''', 'handler in try finally': '''def f(a, b, d):
    try:
        try:
            raise E
        except E as e:
            return (
                b if a else
                d)
    finally:
        LOG.append('finally')
''', 'try finally in try except': '''def f(a, b, d):
    try:
        try:
            return (
                b if a else
                d)
        finally:
            LOG.append('finally')
    except E:
        LOG.append('caught'); return 'handled'
''', 'two try finally': '''def f(a, b, d):
    try:
        try:
            return (
                b or
                d)
        finally:
            LOG.append('inner')
    finally:
        LOG.append('finally')
''', 'try finally in a with': '''def f(a, b, d):
    with W():
        try:
            return (
                b if a else
                d)
        finally:
            LOG.append('finally')
''', 'try finally in a loop': '''def f(a, b, d):
    for i in gen():
        try:
            return (
                [x for x in (b, d)
                 if a])
        finally:
            LOG.append('finally')
''', 'no ways meet': '''def f(a, b, d):
    try:
        try:
            return (
                c(
                b))
        except E:
            LOG.append('caught'); return 'handled'
    finally:
        LOG.append('finally')
'''}
class W:
    def __enter__(self): return self
    def __exit__(self, *a): LOG.append('exit'); return False
def gen():
    try: yield 1
    finally: LOG.append('closed')
for name, src in R.items():
    for a in (0, 1):
        LOG = []; seen = []
        g = dict(c=c, E=E, W=W, gen=gen, LOG=LOG); exec(compile(src, 'p', 'exec'), g)
        target = [i + 1 for i, l in enumerate(src.split('\n')) if 'return (' in l][0]
        def tr(fr, e, arg):
            if fr.f_code.co_filename != 'p': return None
            if e == 'line':
                seen.append(fr.f_lineno)
                if fr.f_lineno == target and (seen.count(target) == 2 or len(seen) > 1 and seen[-2] > target): seen.append('raise'); raise E
            return tr
        sys.settrace(tr)
        try: r = g['f'](a, 'b', 'd')
        except E: r = 'E came out'
        finally: sys.settrace(None)
        print(name, '|', a, '|', seen, r, LOG)
