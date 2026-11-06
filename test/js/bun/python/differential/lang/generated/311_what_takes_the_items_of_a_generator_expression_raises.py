# set(), all() and any() of a generator expression go through the generator themselves. If what they do with an item raises, nothing refers to the generator any more: it is closed, and
# what it went through with it, before the exception gets anywhere. The same for built-in functions that are called.
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    class Bad:
        def __bool__(self): raise ValueError('bool')
        def __hash__(self): raise ValueError('hash')
        def __lt__(self, o): raise ValueError('lt')
        def __add__(self, o): raise ValueError('add')
        __radd__ = __add__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Bad:')
try:
    def src(tag='src'):
        try:
            yield 1
            yield Bad()
            yield 3
        finally:
            log.append('closed ' + tag)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def src(tag='src'):")
try: CONSUMERS = ['set', 'all', 'any', 'frozenset', 'sum', 'sorted', 'min', 'max', 'tuple', 'list']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: CONSUMERS = ['set', 'all', 'any', 'frozenset', 'sum', 'sorted', 'min'...")
try: FORMS = ['F(x for x in src())', 'F(x for y in (1,) for x in src())', 'F(x for x in (z for z in src()))', 'F((x for x in src()))', 'r = F(x for x in src())', '[F(x for x in src())]', 'len([F(x for x in src())])',
         'F(x for x in src("a")) or F(x for x in src("b"))', 'F(x for x in src("a") for y in src("b"))', 'F(x for x in\n        src())']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: FORMS = ['F(x for x in src())', 'F(x for y in (1,) for x in src())', ...")
try:
    for c in CONSUMERS:
        for f in FORMS:
            try: text = f.replace('F', c)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: text = f.replace('F', c)")
            for place in ('module', 'function', 'loop', 'with', 'generator'):
                try: del log[:]
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del log[:]')
                try: body = 'try:\n    %s\nexcept ValueError as e:\n    log.append("caught " + str(e))\nlog.append("after")' % text
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: body = \'try:\\n %s\\nexcept ValueError as e:\\n log.append("caught " + s...')
                try: ns = dict(src=src, log=log)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = dict(src=src, log=log)')
                if place == 'module': code = body
                elif place == 'function': code = 'def f():\n' + '\n'.join('    ' + l for l in body.split('\n')) + '\nf()'
                elif place == 'loop': code = 'def f():\n    for k in (1, 2):\n' + '\n'.join('        ' + l for l in body.split('\n')) + '\nf()'
                elif place == 'with':
                    try: code = 'import contextlib\ndef f():\n    try:\n        with contextlib.nullcontext():\n            %s\n    except ValueError as e:\n        log.append("caught " + str(e))\n    log.append("after")\nf()' % text
                    except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: code = 'import contextlib\\ndef f():\\n try:\\n with contextlib.nullcont...")
                else: code = 'def f():\n' + '\n'.join('    ' + l for l in body.split('\n')) + '\n    yield 1\nlist(f())'
                try: exec(code, ns)
                except BaseException as e: log.append('LEFT %s' % type(e).__name__)
                try: print('text [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + ", " + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + ", " + 'place=' + (repr(place) if type(place) in (str, int, float, bytes, bool, type(None)) or (type(place) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in place)) else place.__name__ if type(place) is type else type(place).__name__) + '] =>', text)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: text')
                try: print('|', 'place [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + ", " + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + ", " + 'place=' + (repr(place) if type(place) in (str, int, float, bytes, bool, type(None)) or (type(place) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in place)) else place.__name__ if type(place) is type else type(place).__name__) + '] =>', place)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: place')
                try: print('|', "' ; '.join(log) [" + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + ", " + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + ", " + 'place=' + (repr(place) if type(place) in (str, int, float, bytes, bool, type(None)) or (type(place) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in place)) else place.__name__ if type(place) is type else type(place).__name__) + '] =>', ' ; '.join(log))
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' ; '.join(log)")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for c in CONSUMERS:')
