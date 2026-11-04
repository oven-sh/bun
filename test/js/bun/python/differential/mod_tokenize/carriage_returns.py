# A carriage return that is not followed by a newline, in what readline() gives to tokenize; and in source given to the compiler.
import ast
import io
import tokenize

SOURCES = ("a=1\rb=2\n", "\r\\\n\n\t\t\\\n\n", "\r\\\n\n", "# c\rx = 1\n", "a\r\n", "a\r", "\r", "x = 1 \r+ 2\n", "x = (1,\r2)\n", "  \rx\n",
           "if a:\n  \r\n  b\n", "x\r.y\n", "x\r1\n", "x\r'a'\n", "'a\rb'\n", "f'{a\r}'\n", "x \\\r\n", "a\r\rb\n", "a\r#c\n", "a\r \n", "\ra\n", "a = 1\r\n\rb\n")

for newline in ('\n', ''):
    print('=====', repr(newline))
    for source in SOURCES:
        print(repr(source))
        try:
            for token in tokenize.generate_tokens(io.StringIO(source, newline=newline).readline):
                print('   ', tokenize.tok_name[token.type], repr(token.string), token.start, token.end, repr(token.line))
        except (tokenize.TokenError, SyntaxError) as e:
            print('   ', type(e).__name__, e)

print('===== compile')
for source in SOURCES + ("x = '''a\rb'''", "x = '''a\r\nb'''", "if a:\r    b\r    c\r", "a = 1 \\\rb", "f'''{a}\r{b}'''"):
    try:
        print(repr(source), ast.dump(ast.parse(source), include_attributes=True))
    except SyntaxError as e:
        print(repr(source), 'SyntaxError', e.msg, e.lineno, e.offset, repr(e.text))
