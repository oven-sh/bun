# Streams over the standard file descriptors, put together as the interpreter does for sys.stdout.
import _io

def make(fd, mode, errors, line_buffering):
    buf = _io.open(fd, mode + 'b', -1, closefd=False)
    buf.raw.name = '<fd %d>' % fd
    stream = _io.TextIOWrapper(buf, 'utf-8', errors, '\n', line_buffering, False)
    stream.mode = mode
    return stream

out = make(1, 'w', 'strict', False)
w = out.write
w(repr(out) + '\n')
w(repr(out.buffer) + '\n')
w(repr(out.buffer.raw) + '\n')
w('%r %r %r %r %r %r\n' % (out.name, out.mode, out.encoding, out.errors, out.line_buffering, out.write_through))
w('%r %r %r %r\n' % (out.fileno(), out.isatty(), out.readable(), out.writable()))
w('%r %r %r\n' % (out.buffer.raw.closefd, out.buffer.raw.mode, out.buffer.mode))
w('héllo €uro \U0001f600\n')
try:
    w('\udc80')
except UnicodeEncodeError as e:
    w('UnicodeEncodeError: %s\n' % e)
try:
    out.read()
except OSError as e:
    w('%s: %s\n' % (type(e).__name__, e))
for i in range(3000):
    w('%d ' % i)
w('\n')
out.flush()
out.buffer.write(b'bytes\n')
out.buffer.flush()
out.buffer.raw.write(b'raw\n')

err = make(1, 'w', 'backslashreplace', True)
err.write('a\udc80b\n')
err.write('no newline')
err.flush()
err.write('\n')

inp = make(0, 'r', 'strict', False)
w('%r %r %r %r\n' % (inp.read(), inp.readline(), inp.readable(), inp.writable()))
inp.close()
w('%r\n' % inp.closed)
out.close()
err.close()
# The file descriptor is still open.
last = _io.FileIO(1, 'w', closefd=False)
last.write(b'still open\n')
