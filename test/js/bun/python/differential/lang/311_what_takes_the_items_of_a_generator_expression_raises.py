# set(), all() and any() of a generator expression go through the generator themselves. If what they do with an item raises, nothing refers to the generator any more: it is closed, and
# what it went through with it, before the exception gets anywhere. The same for built-in functions that are called.
log = []
class Bad:
    def __bool__(self): raise ValueError('bool')
    def __hash__(self): raise ValueError('hash')
    def __lt__(self, o): raise ValueError('lt')
    def __add__(self, o): raise ValueError('add')
    __radd__ = __add__
def src(tag='src'):
    try:
        yield 1
        yield Bad()
        yield 3
    finally:
        log.append('closed ' + tag)
CONSUMERS = ['set', 'all', 'any', 'frozenset', 'sum', 'sorted', 'min', 'max', 'tuple', 'list']
FORMS = ['F(x for x in src())', 'F(x for y in (1,) for x in src())', 'F(x for x in (z for z in src()))', 'F((x for x in src()))', 'r = F(x for x in src())', '[F(x for x in src())]', 'len([F(x for x in src())])',
         'F(x for x in src("a")) or F(x for x in src("b"))', 'F(x for x in src("a") for y in src("b"))', 'F(x for x in\n        src())']
for c in CONSUMERS:
    for f in FORMS:
        text = f.replace('F', c)
        for place in ('module', 'function', 'loop', 'with', 'generator'):
            del log[:]
            body = 'try:\n    %s\nexcept ValueError as e:\n    log.append("caught " + str(e))\nlog.append("after")' % text
            ns = dict(src=src, log=log)
            if place == 'module': code = body
            elif place == 'function': code = 'def f():\n' + '\n'.join('    ' + l for l in body.split('\n')) + '\nf()'
            elif place == 'loop': code = 'def f():\n    for k in (1, 2):\n' + '\n'.join('        ' + l for l in body.split('\n')) + '\nf()'
            elif place == 'with':
                code = 'import contextlib\ndef f():\n    try:\n        with contextlib.nullcontext():\n            %s\n    except ValueError as e:\n        log.append("caught " + str(e))\n    log.append("after")\nf()' % text
            else: code = 'def f():\n' + '\n'.join('    ' + l for l in body.split('\n')) + '\n    yield 1\nlist(f())'
            try: exec(code, ns)
            except BaseException as e: log.append('LEFT %s' % type(e).__name__)
            print(text, '|', place, '|', ' ; '.join(log))
