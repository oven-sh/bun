# A backslash where the text, a line or a string ends: what the lexer says, in each mode of compile().
def show(source, mode):
    try:
        compile(source, "<s>", mode)
        print(repr(source), mode, "compiles")
    except SyntaxError as e:
        print(repr(source), mode, type(e).__name__, repr(e.msg), e.lineno, e.offset, e.end_lineno, e.end_offset, repr(e.text), e._metadata[:2] if e._metadata else None)
for source in ["\\", "\\\n", "\\ ", "\\x", " \\", "x\\", "x \\", "x = \\", "\\\n\\", "\\\n\\\n", "\\\n\\ ", "x\\\n\\", "(\\", "(\\\n", "(\\ ", "'\\", "'\\'", "f'{\\}'", "f'{\\", "f'{x\\}'", "f'{x \\\n}'", "f'''{\\\n}'''",
               "f'{\\\n}'", "t'{\\}'", "#\\", "x #\\\n", "\n\\", "\n\n\\", "if x:\n  \\", "if x:\n\\", "if x:\n  y\n\\", "if x:\n  y\n \\", "\\\nx", "\\\n x", "  \\\nx", "x\\\n\n", "\\\r\n", "\\\r", "x = 1\\\n+ 2", "\\\n" * 5, "\\\n" * 5 + "\\",
               "x = '''\\", "x = '''\\\n", "\x0c\\", "\t\\", "\\\\", "\\\n\\\\", "a\\b", "1\\", "1\\\n2", ".\\", "...\\", "a.\\\nb", "a.\\", "@\\", "def\\", "def f(\\", "lambda\\", "lambda:\\"]:
    for mode in ("exec", "eval", "single"):
        show(source, mode)
for source in ("\\", "x\\", "(\\", "f'{\\}'"):
    for call in (eval, exec):
        try:
            call(source)
        except SyntaxError as e:
            print(call.__name__, repr(source), e.msg, e.lineno, e.offset)
