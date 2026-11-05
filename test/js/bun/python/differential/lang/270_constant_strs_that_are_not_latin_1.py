# What the compiler works out of constant strs with characters beyond Latin-1, and what it leaves alone.
SOURCES = '''
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

for source in SOURCES.strip().splitlines():
    code = compile('x = ' + source, '<test>', 'exec')
    shown = [c if not isinstance(c, str) or len(c) < 20 else (len(c), c[:2]) for c in code.co_consts]
    namespace = {}
    exec(code, namespace)
    x = namespace['x']
    print(ascii(source), ascii(shown), ascii(x if not isinstance(x, str) or len(x) < 20 else (len(x), x[:2])))
