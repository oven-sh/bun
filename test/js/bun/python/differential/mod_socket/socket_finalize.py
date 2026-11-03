import _socket, socket, gc, warnings, os, sys
def fdopen(fd):
    try: os.fstat(fd); return True
    except OSError: return False
def run(make):
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter('always')
        s = make(); fd = s.fileno(); r = repr(s)
        del s; gc.collect()
        print(fdopen(fd), sorted((x.category.__name__, str(x.message) == 'unclosed ' + r, x.source is None) for x in w))
run(_socket.socket)
run(socket.socket)
run(lambda: socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM))
run(lambda: _socket.socketpair()[0])
run(lambda: socket.socketpair()[1])
# closed or detached: nothing to say
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    s = socket.socket(); s.close(); del s
    s = socket.socket(); fd = s.detach(); del s
    s = _socket.socket.__new__(_socket.socket); del s
    gc.collect(); print(len(w), fdopen(fd)); os.close(fd)
# the warning as an error is reported, not raised
import io, contextlib
def hook(u): print('unraisable:', type(u.exc_value).__name__, u.err_msg.split('<')[0], u.object)
sys.unraisablehook = hook
with warnings.catch_warnings():
    warnings.simplefilter('error')
    s = socket.socket(); fd = s.fileno(); del s; gc.collect(); print(fdopen(fd))
# ignored
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('ignore')
    s = socket.socket(); fd = s.fileno(); del s; gc.collect(); print(fdopen(fd), len(w))
# a subclass with a finalizer of its own
class S(socket.socket):
    def __del__(self):
        print('S.__del__', self.fileno() != -1); super().__del__()
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    s = S(); fd = s.fileno(); del s; gc.collect(); print(fdopen(fd), len(w))
    s = S(); s.close(); del s; gc.collect(); print(len(w))
# called by hand
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    s = _socket.socket(); fd = s.fileno(); s.__del__(); print(s.fileno(), fdopen(fd), len(w)); s.__del__(); print(len(w))
# an accepted connection that is dropped
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    srv = socket.create_server(('127.0.0.1', 0)); c = socket.create_connection(srv.getsockname()); a, _ = srv.accept(); fd = a.fileno(); del a; gc.collect()
    print(fdopen(fd), len(w), c.recv(1)); c.close(); srv.close()
# a file made from it keeps the descriptor
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    a, b = socket.socketpair(); f = a.makefile('rb'); fd = a.fileno(); a.close(); del a; gc.collect(); print(fdopen(fd), len(w)); b.send(b'x'); print(f.read(1)); f.close(); print(fdopen(fd)); b.close()
