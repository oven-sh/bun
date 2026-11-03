import socket, os, errno, io, gc, warnings, tempfile, array, sys
def t(f):
    try: print(repr(f()))
    except BaseException as x: print(type(x).__name__ + ':', x, getattr(x, 'errno', None))
def norm(o, *socks):
    r = repr(o)
    for s in socks:
        r = r.replace('fd=%d,' % s.fileno(), 'fd=N,')
    import re
    return re.sub(r"\('127\.0\.0\.1', \d+\)", "('127.0.0.1', P)", r)
print(socket.AF_INET, repr(socket.AF_INET), socket.SOCK_STREAM, repr(socket.SOCK_DGRAM), repr(socket.MSG_PEEK), repr(socket.AI_PASSIVE), socket.AF_INET == 2, type(socket.AF_UNIX).__name__)
print(repr(socket.MSG_PEEK | socket.MSG_OOB), repr(socket.AddressFamily(10)), repr(socket.SocketKind(1)), socket.SOMAXCONN > 0, socket.has_ipv6, socket.has_dualstack_ipv6())
print(socket.error is OSError, socket.timeout is TimeoutError, socket.herror.__mro__[1], socket.gaierror.__name__, socket.SocketType is socket.socket.__mro__[1])
s = socket.socket()
print(norm(s, s), s.family, s.type, s.proto, repr(s.family), repr(s.type), type(s).__mro__)
print(s.getsockname(), s.get_inheritable(), s.gettimeout(), s.getblocking(), s._closed, s._io_refs)
s.set_inheritable(True); print(s.get_inheritable(), os.get_inheritable(s.fileno())); s.set_inheritable(False)
s.close(); print(repr(s), s._closed, s.fileno()); s.close()
t(lambda: s.getsockname())
with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as u: print(u.type, u._closed)
print(u._closed)
import pickle, copy
s = socket.socket(); t(lambda: pickle.dumps(s)); t(lambda: copy.copy(s)); s.close()
srv = socket.create_server(('127.0.0.1', 0)); port = srv.getsockname()[1]
print(norm(srv, srv), srv.getsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR))
c = socket.create_connection(('127.0.0.1', port), timeout=5); print(c.gettimeout(), c.family, c.type)
a, addr = srv.accept(); print(type(a).__name__, addr == c.getsockname(), a.family, a.type, a.gettimeout(), a.getblocking(), a.get_inheritable())
print(norm(a, a).replace(str(port), 'SP'))
c.sendall(b'line one\nline two\n')
f = a.makefile('r'); print(type(f).__name__, f.readline(), a._io_refs, f.name == a.fileno(), f.mode)
g = a.makefile('rwb', buffering=0); print(type(g).__name__, g.mode, g.readable(), g.writable(), g.seekable(), g.fileno() == a.fileno(), g.name == a.fileno(), a._io_refs)
h = a.makefile('wb'); print(type(h).__name__, h.write(b'reply\n'), h.flush(), c.recv(100))
print(f.readline()); 
t(lambda: a.makefile('x')); t(lambda: a.makefile('r', buffering=0)); gc.collect()
a.close(); print(a._closed, a.fileno() != -1, a._io_refs); f.close(); g.close(); print(a.fileno() != -1); h.close(); print(a.fileno(), g.closed, repr(g.name))
t(lambda: g.fileno()); t(lambda: g.read(1)); t(lambda: g.readable())
print(c.recv(10)); c.close()
# SocketIO and timeouts
c = socket.create_connection(('127.0.0.1', port)); a, _ = srv.accept(); a.settimeout(0.05); r = a.makefile('rb'); t(lambda: r.read(1)); t(lambda: r.read(1)); r.close()
a.setblocking(False); r = a.makefile('rb', buffering=0); print(r.read(1), r.readinto(bytearray(1))); r.close(); a.close(); c.close()
# dup, detach, fromfd
c = socket.create_connection(('127.0.0.1', port)); a, _ = srv.accept()
d = c.dup(); print(type(d).__name__, d.fileno() != c.fileno(), d.family, d.type, d.getpeername() == c.getpeername(), d.get_inheritable()); c.settimeout(3); e = c.dup(); print(e.gettimeout()); e.close()
x = socket.fromfd(c.fileno(), socket.AF_INET, socket.SOCK_STREAM); print(x.fileno() != c.fileno(), x.getpeername() == c.getpeername()); x.close()
fd = d.detach(); print(d._closed, d.fileno()); y = socket.socket(fileno=fd); print(y.family, y.type, y.proto, y.getpeername() == c.getpeername()); y.close()
a.close(); c.close()
# sendfile
with tempfile.TemporaryFile() as tf:
    tf.write(b'0123456789' * 1000); tf.flush(); tf.seek(0)
    c = socket.create_connection(('127.0.0.1', port)); a, _ = srv.accept()
    print(c.sendfile(tf), tf.tell()); got = b''
    while len(got) < 10000: got += a.recv(65536)
    print(len(got), got[:12]); print(c.sendfile(tf, offset=9990), a.recv(100), c.sendfile(tf, 5, 3), a.recv(100))
    t(lambda: c.sendfile(io.StringIO('x'))); t(lambda: c.sendfile(tf, count=0)); print(c.sendfile(io.BytesIO(b'fallback')), a.recv(100))
    c.setblocking(False); t(lambda: c.sendfile(tf)); a.close(); c.close()
srv.close()
# socketpair, send_fds, recv_fds
a, b = socket.socketpair(); print(type(a).__name__, a.family, a.type, norm(a, a)); r, w = os.pipe()
print(socket.send_fds(a, [b'fds'], [r, w])); msg, fds, flags, addr = socket.recv_fds(b, 10, 4); print(msg, len(fds), flags, addr); [os.close(x) for x in fds + [r, w]]
a.close(); b.close()
print(socket.gethostbyname('127.0.0.1'))
print([(repr(f), repr(k), p, n, x) for f, k, p, n, x in socket.getaddrinfo('127.0.0.1', 80, type=socket.SOCK_STREAM)])
print(socket.getaddrinfo('::1', 80, socket.AF_INET6, socket.SOCK_DGRAM)[0][4])
t(lambda: socket.create_connection(('127.0.0.1', port), timeout=2))
t(lambda: socket.create_connection(('127.0.0.1', port), timeout=2, all_errors=True))
t(lambda: socket.create_server(('127.0.0.1', 0), family=socket.AF_UNIX))
sb = socket.create_server(('127.0.0.1', 0), backlog=1, reuse_port=True); print(sb.getsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT)); sb.close()
print(socket.socket(socket.AF_INET, socket.SOCK_STREAM | socket.SOCK_NONBLOCK).type)
x = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); print(repr(x.family), norm(x, x)); x.close()
x = socket.socket(socket.AF_NETLINK, socket.SOCK_RAW); print(repr(x.family), x.getsockname()); x.close()
print(socket.inet_aton('1.2.3.4'), socket.inet_ntoa(b'\1\2\3\4'), socket.htons(1), socket.CMSG_LEN(4), socket.if_nametoindex('lo'))
print(sorted(socket.__all__) == sorted(set(socket.__all__)), 'socket' in socket.__all__, 'AF_INET' in socket.__all__, 'create_server' in socket.__all__, len(socket.__all__) > 400)
