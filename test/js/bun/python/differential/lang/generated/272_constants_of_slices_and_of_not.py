# To CPython's compiler -1 is no literal, and () is none: what it makes of slices and of `not` shows in the constants.
try: SOURCES = '''
x = y[-2:]
x = y[:-2]
x = y[-3:-2]
x = y[::-2]
x = y[1:-2]
x = y[-1:]
x = y[:-1]
x = y[::-1]
x = y[1:2]
x = y[1:2:3]
x = y[-2:5:7]
x = "abcdef"[-2:]
x = "abcdef"[:-2]
x = "abcdef"[::-1]
x = "abcdef"[::-2]
x = "abcdef"[1:-2]
x = "abcdef"[-2]
x = "abcdef"[+2:]
x = "abcdef"[~2:]
x = "abcdef"[1+1:]
x = (1, 2, 3)[-2:]
x = y[-2:, 1]
x = y[1:2, -3]
y[-2:] = x
del y[-2:]
y[-2:] += x
x = y[-2.5:]
x = y[-2j:]
x = y[not 1:]
x = y[(1, 2):]
x = y[None:-2]
x = y[True:-2]
not ()
x = not ()
x = not (1, 2)
x = not 1
x = not ""
x = not "a"
x = not None
x = not 1.5
x = not b""
x = not not ()
x = not (1,)
x = () or 1
x = () and 1
if not (): pass
if (): pass
if not (1, 2): x = 1
while not (): break
x = 1 if not () else 2
x = 1 if () else 2
x = [a for a in y if not ()]
assert not ()
assert (), "m"
x = not ...
x = not (1, 2)[0]
x = not -1
x = not 300
x = -300
x = not -300
x = ~()
x = (not (), 1)
x = (not 5, 1)
def f(): return not ()
def f(): not ()
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SOURCES = ''' x = y[-2:] x = y[:-2] x = y[-3:-2] x = y[::-2] x = y[1:...")


try:
    def consts(code):
        out = [code.co_consts]
        for c in code.co_consts:
            if hasattr(c, 'co_consts'):
                out.append(consts(c))
        return [tuple('code' if hasattr(c, 'co_consts') else c for c in out[0])] + out[1:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def consts(code):')


try:
    for source in SOURCES.strip().splitlines():
        try: print('source [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', source)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: source')
        try: print("consts(compile(source, '<test>', 'exec')) [" + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', consts(compile(source, '<test>', 'exec')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: consts(compile(source, '<test>', 'exec'))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for source in SOURCES.strip().splitlines():')
