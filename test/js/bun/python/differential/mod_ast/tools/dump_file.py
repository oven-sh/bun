# Prints the tree of each file named on the command line, attributes included, without the help of Lib/ast.py.
import sys
import _ast
sys.setrecursionlimit(20000)

def dump(node, out):
    if isinstance(node, _ast.AST):
        cls = type(node)
        out.append(cls.__name__)
        out.append('(')
        first = True
        for name in cls._fields + cls._attributes:
            if not first:
                out.append(',')
            first = False
            out.append(name)
            out.append('=')
            dump(getattr(node, name), out)
        out.append(')')
    elif isinstance(node, list):
        out.append('[')
        first = True
        for item in node:
            if not first:
                out.append(',\n')
            first = False
            dump(item, out)
        out.append(']')
    else:
        out.append(ascii(node))

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

flags = _ast.PyCF_ONLY_AST
args = sys.argv[1:]
if args and args[0] == '--type-comments':
    flags |= _ast.PyCF_TYPE_COMMENTS
    del args[0]
for path in args:
    source = read(path)
    try:
        tree = compile(source, path, 'exec', flags, dont_inherit=True)
    except SyntaxError as e:
        print('SyntaxError', e.msg, e.lineno, e.offset, e.end_lineno, e.end_offset)
        continue
    except (ValueError, RecursionError, MemoryError) as e:
        print(type(e).__name__, e)
        continue
    out = []
    dump(tree, out)
    print(''.join(out))
