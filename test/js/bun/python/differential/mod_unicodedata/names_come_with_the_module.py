# The names of characters come with the module unicodedata: it is imported when one is first needed, and that can fail.
import subprocess
import sys

programs = {
    "literal": r"""
import sys
print('unicodedata' in sys.modules)
print(ascii(eval(r"'\N{SOFT HYPHEN}'")), 'unicodedata' in sys.modules)
""",
    "no names needed": r"""
import sys
eval(r"'\x41A'"); b'\\x41'.decode('unicode_escape'); 'a'.encode('ascii', 'namereplace')
print('unicodedata' in sys.modules)
""",
    "unicode_escape": r"""
import sys
print(ascii(b'\\N{SOFT HYPHEN}'.decode('unicode_escape')), 'unicodedata' in sys.modules)
""",
    "namereplace": r"""
import sys
print('\xad'.encode('ascii', 'namereplace'), 'unicodedata' in sys.modules)
""",
    "blocked, literal": r"""
import sys
sys.modules['unicodedata'] = None
try:
    eval(r"'\N{SOFT HYPHEN}'")
except SyntaxError as e:
    print(type(e).__name__, e.msg, e.lineno, e.offset, e.end_offset)
try:
    compile(r"x = f'{1}\N{SOFT HYPHEN}'", "<x>", "exec")
except SyntaxError as e:
    print(type(e).__name__, e.msg, e.lineno, e.offset, e.end_offset)
print(eval(r"b'\N{SOFT HYPHEN}'"), eval(r"r'\N{SOFT HYPHEN}'"))
""",
    "blocked, unicode_escape": r"""
import sys
sys.modules['unicodedata'] = None
for errors in ('strict', 'ignore', 'replace'):
    try:
        print(b'a\\N{SOFT HYPHEN}'.decode('unicode_escape', errors))
    except Exception as e:
        print(type(e).__name__, e, type(e.__context__).__name__)
""",
    "blocked, namereplace": r"""
import sys
sys.modules['unicodedata'] = None
try:
    print('\xad'.encode('ascii', 'namereplace'))
except Exception as e:
    print(type(e).__name__, e)
""",
    "blocked later": r"""
import sys
print(ascii(eval(r"'\N{SOFT HYPHEN}'")))
sys.modules['unicodedata'] = None
print(ascii(eval(r"'\N{DIGIT ONE}'")), b'\\N{DIGIT TWO}'.decode('unicode_escape'), '\xad'.encode('ascii', 'namereplace'))
""",
    "dropped": r"""
import gc, sys
assert '\N{GRINNING FACE}'.encode('ascii', errors='namereplace') == b'\\N{GRINNING FACE}'
compile(r"x = '\N{LATIN CAPITAL LETTER A}'", '<x>', 'exec')
del sys.modules['unicodedata']
gc.collect()
assert '\N{WINKING FACE}'.encode('ascii', errors='namereplace') == b'\\N{WINKING FACE}'
compile(r"x = '\N{LATIN CAPITAL LETTER B}'", '<x>', 'exec')
print('unicodedata' in sys.modules)
""",
    "unblocked": r"""
import sys
sys.modules['unicodedata'] = None
try:
    eval(r"'\N{SOFT HYPHEN}'")
except SyntaxError as e:
    print(e.msg)
del sys.modules['unicodedata']
print(ascii(eval(r"'\N{SOFT HYPHEN}'")), 'unicodedata' in sys.modules)
""",
}
for name, program in programs.items():
    result = subprocess.run([sys.executable, "-I", "-c", program], capture_output=True, text=True)
    print("==", name, result.returncode)
    print(result.stdout, end="")
    print(result.stderr[-300:], end="")
