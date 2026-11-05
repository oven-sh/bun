# What the compiler works out of constant strs with characters beyond Latin-1, and what it leaves alone.
try: SOURCES = '''
"Ā" * 5000
5000 * "Ā"
"Ā" * 4096
"Ā" * 4097
"Ā" * 3
3 * "Ā"
"Ā" * 0
"Ā" * -1
"Ā%s" % 1
"Ā%s" % (1,)
"Ā" % ()
"Ā" + "b"
"a" + "Ā"
"Āb"[0]
"Āb"[1]
"Āb"[-1:]
"\U0001f600" * 2048
"\U0001f600" * 5000
"\U0001f600%d" % 1
"\U0001f600a"[0]
("Ā",) * 3
"Ā" < "b"
"Ā" in "Āb"
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SOURCES = \'\'\' "Ā" * 5000 5000 * "Ā" "Ā" * 4096 "Ā" * 4097 "Ā" * 3 3 *...')

try:
    for source in SOURCES.strip().splitlines():
        try: code = compile('x = ' + source, '<test>', 'exec')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: code = compile('x = ' + source, '<test>', 'exec')")
        try: shown = [c if not isinstance(c, str) or len(c) < 20 else (len(c), c[:2]) for c in code.co_consts]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: shown = [c if not isinstance(c, str) or len(c) < 20 else (len(c), c[:...')
        try: namespace = {}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: namespace = {}')
        try: exec(code, namespace)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: exec(code, namespace)')
        try: x = namespace['x']
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: x = namespace['x']")
        try: print('ascii(source) [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', ascii(source))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ascii(source)')
        try: print('ascii(shown) [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', ascii(shown))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ascii(shown)')
        try: print('ascii(x if not isinstance(x, str) or len(x) < 20 else (len(x), x[:2])) [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', ascii(x if not isinstance(x, str) or len(x) < 20 else (len(x), x[:2])))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ascii(x if not isinstance(x, str) or len(x) < 20 else (len(x), x[:2]))')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for source in SOURCES.strip().splitlines():')
