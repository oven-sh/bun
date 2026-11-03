# Writing to a pipe nobody reads from raises BrokenPipeError: the interpreter ignores SIGPIPE.
import _io, posix
r, w = posix.pipe()
posix.close(r)
f = _io.FileIO(w, 'w')
try:
    f.write(b'x')
except OSError as e:
    print(type(e).__name__, e)
f.close()
r, w = posix.pipe()
posix.close(r)
f = _io.open(w, 'w')
f.write('x')
try:
    f.flush()
except OSError as e:
    print(type(e).__name__, e)
try:
    f.close()
except OSError as e:
    print(type(e).__name__, e)
print(f.closed)
