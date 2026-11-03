# A backslash where the text, a line or a string ends: what the lexer says, in each mode of compile().
try:
    def show(source, mode):
        try:
            compile(source, "<s>", mode)
            print(repr(source), mode, "compiles")
        except SyntaxError as e:
            print(repr(source), mode, type(e).__name__, repr(e.msg), e.lineno, e.offset, e.end_lineno, e.end_offset, repr(e.text), e._metadata[:2] if e._metadata else None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(source, mode):')
try:
    for source in ["\\", "\\\n", "\\ ", "\\x", " \\", "x\\", "x \\", "x = \\", "\\\n\\", "\\\n\\\n", "\\\n\\ ", "x\\\n\\", "(\\", "(\\\n", "(\\ ", "'\\", "'\\'", "f'{\\}'", "f'{\\", "f'{x\\}'", "f'{x \\\n}'", "f'''{\\\n}'''",
                   "f'{\\\n}'", "t'{\\}'", "#\\", "x #\\\n", "\n\\", "\n\n\\", "if x:\n  \\", "if x:\n\\", "if x:\n  y\n\\", "if x:\n  y\n \\", "\\\nx", "\\\n x", "  \\\nx", "x\\\n\n", "\\\r\n", "\\\r", "x = 1\\\n+ 2", "\\\n" * 5, "\\\n" * 5 + "\\",
                   "x = '''\\", "x = '''\\\n", "\x0c\\", "\t\\", "\\\\", "\\\n\\\\", "a\\b", "1\\", "1\\\n2", ".\\", "...\\", "a.\\\nb", "a.\\", "@\\", "def\\", "def f(\\", "lambda\\", "lambda:\\"]:
        for mode in ("exec", "eval", "single"):
            try: show(source, mode)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(source, mode)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for source in ["\\\\", "\\\\\\n", "\\\\ ", "\\\\x", " \\\\", "x\\\\", "x \\\\", "x =...')
try:
    for source in ("\\", "x\\", "(\\", "f'{\\}'"):
        for call in (eval, exec):
            try:
                call(source)
            except SyntaxError as e:
                print('call.__name__ [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'call=' + (repr(call) if type(call) in (str, int, float, bytes, bool, type(None)) or (type(call) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in call)) else call.__name__ if type(call) is type else type(call).__name__) + '] =>', call.__name__)
                print('repr(source) [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'call=' + (repr(call) if type(call) in (str, int, float, bytes, bool, type(None)) or (type(call) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in call)) else call.__name__ if type(call) is type else type(call).__name__) + '] =>', repr(source))
                print('e.msg [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'call=' + (repr(call) if type(call) in (str, int, float, bytes, bool, type(None)) or (type(call) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in call)) else call.__name__ if type(call) is type else type(call).__name__) + '] =>', e.msg)
                print('e.lineno [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'call=' + (repr(call) if type(call) in (str, int, float, bytes, bool, type(None)) or (type(call) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in call)) else call.__name__ if type(call) is type else type(call).__name__) + '] =>', e.lineno)
                print('e.offset [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + ", " + 'call=' + (repr(call) if type(call) in (str, int, float, bytes, bool, type(None)) or (type(call) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in call)) else call.__name__ if type(call) is type else type(call).__name__) + '] =>', e.offset)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for source in ("\\\\", "x\\\\", "(\\\\", "f\'{\\\\}\'"):')
