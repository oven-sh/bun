# sys.stdin, sys.stdout, sys.stderr and builtins.open, as the interpreter sets them up. (Run with pipes, and /dev/null as stdin.)
import sys
print('_io' in sys.modules, 'io' in sys.modules)
import _io, builtins
print(open is _io.open, builtins.open is _io.open, open.__module__, open.__name__, repr(open))

for name in ('stdin', 'stdout', 'stderr'):
    s = getattr(sys, name)
    print(name, repr(s), s is getattr(sys, '__%s__' % name))
    print('  ', type(s) is _io.TextIOWrapper, s.name, s.mode, s.encoding, s.errors, s.line_buffering, s.write_through, s.newlines, s.closed, s.fileno(), s.isatty())
    print('  ', s.readable(), s.writable(), s.seekable())
    b = s.buffer
    print('  ', repr(b), type(b).__name__, b.name, b.mode, b.closed, b.fileno(), b.readable(), b.writable())
    r = b.raw
    print('  ', repr(r), type(r).__name__, r.name, r.mode, r.closefd, r.closed, r.fileno())
    print('  ', sorted(s.__dict__), sorted(b.__dict__), sorted(r.__dict__))

print('--- reading at the end of the input')
print(repr(sys.stdin.read()), repr(sys.stdin.readline()), list(sys.stdin), sys.stdin.buffer.read(), sys.stdin.buffer.raw.read())
try:
    input()
except EOFError as e:
    print('EOFError:', e)
try:
    input('prompt> ')
except EOFError as e:
    print()
    print('EOFError:', e)
for f, a in ((sys.stdin.write, 'x'), (sys.stdout.read, 1), (sys.stdout.readline, -1), (sys.stderr.read, 1)):
    try:
        f(a)
    except Exception as e:
        print(type(e).__name__, type(e).__mro__[1].__name__, e)

print('--- text and bytes, in order')
print('one')
sys.stdout.flush()
sys.stdout.buffer.write(b'two\n')
sys.stdout.buffer.flush()
print('three', end='')
print(file=sys.stdout)
print(sys.stdout.write('four\n'), sys.stdout.writelines(['five\n', 'six\n']))
print('caf\xe9 € \U0001f600', 'lone \udc80 byte')
print('a', 'b', sep='\r\n', end='\r')
print()
sys.stdout.flush()
sys.stdout.buffer.raw.write(b'raw\n')

print('--- reconfigure')
sys.stdout.reconfigure(errors='backslashreplace')
print(sys.stdout.errors, 'lone \udc80 surrogate')
sys.stdout.reconfigure(encoding='ascii', errors='xmlcharrefreplace', line_buffering=True)
print(sys.stdout.encoding, sys.stdout.errors, sys.stdout.line_buffering, 'caf\xe9')
sys.stdout.reconfigure(encoding='utf-8', errors='strict', newline='\r\n', line_buffering=False)
print('crlf')
sys.stdout.reconfigure(newline='\n')
try:
    print('\udc80')
except UnicodeEncodeError as e:
    print()
    print('UnicodeEncodeError:', e)

print('--- another object as sys.stdout')
class Upper:
    def __init__(self, to): self.to = to
    def write(self, text): return self.to.write(text.upper())
    def flush(self): self.to.flush()
old = sys.stdout
sys.stdout = Upper(old)
print('shouted')
sys.stdout = None
print('nowhere')
del sys.stdout
try:
    print('lost')
except RuntimeError as e:
    old.write('RuntimeError: %s\n' % e)
sys.stdout = old

print('--- a wrapper of its own around the same buffer')
sys.stdout.flush()
w = _io.TextIOWrapper(sys.stdout.buffer, encoding='latin-1', newline='\n', write_through=True)
w.write('latin \xe9\n')
print(w.detach() is sys.stdout.buffer)
print('--- what is pending when sys.stdout is replaced for good is not lost')
sys.stderr.write('')
sys.stdout = _io.StringIO()
print('into the StringIO')
