# Prints the symbol table of each file named on the command line, from _symtable itself.
import sys
import _symtable
sys.setrecursionlimit(20000)

def read(path):
    import posix
    fd = posix.open(path, posix.O_RDONLY)
    chunks = []
    while True:
        chunk = posix.read(fd, 1 << 20)
        if not chunk:
            break
        chunks.append(chunk)
    posix.close(fd)
    return b''.join(chunks)

def dump(e, indent):
    print(' ' * indent + e.name, e.type, e.nested, e.lineno, e.varnames, sorted(e.symbols.items()))
    for c in e.children:
        dump(c, indent + 1)

for path in sys.argv[1:]:
    try:
        dump(_symtable.symtable(read(path), path, 'exec'), 0)
    except (SyntaxError, RecursionError) as e:
        print(type(e).__name__, e)
