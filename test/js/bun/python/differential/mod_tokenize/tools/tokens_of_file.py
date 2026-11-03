# Prints the tokens of each file named on the command line, from _tokenize itself.
import sys
import _tokenize

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

args = sys.argv[1:]
extra = True
if args and args[0] == '--plain':
    extra = False
    del args[0]
for path in args:
    data = read(path)
    lines = iter(data.splitlines(True))
    it = _tokenize.TokenizerIter(lines.__next__, extra_tokens=extra, encoding='utf-8')
    last = None
    try:
        for t in it:
            # The line is long and mostly the same as that of the token before.
            print(t[0], ascii(t[1]), t[2], t[3], ascii(t[4]) if t[4] != last else '=')
            last = t[4]
    except SyntaxError as e:
        print(type(e).__name__, e.args)
