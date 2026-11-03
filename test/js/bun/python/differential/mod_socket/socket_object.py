import _socket as S, os, errno
def t(f):
    try: print(repr(f()))
    except BaseException as x: print(type(x).__name__ + ':', x, getattr(x, 'errno', None))
def norm(s, fd): return repr(s).replace('fd=%d,' % fd, 'fd=N,')
s = S.socket()
print(s.family == S.AF_INET, s.type == S.SOCK_STREAM, s.proto, s.timeout, s.fileno() > 2, norm(s, s.fileno()))
print(os.get_inheritable(s.fileno()), os.get_blocking(s.fileno()))
print(s.getsockname())
t(s.getpeername)
fd = s.fileno()
print(s.close(), s.fileno(), repr(s), s.close())
t(lambda: os.fstat(fd))
for f in [s.getsockname, s.getpeername, s._accept, lambda: s.recv(1), lambda: s.send(b'x'), lambda: s.sendall(b'x'), lambda: s.bind(('127.0.0.1', 0)), lambda: s.listen(), lambda: s.connect(('127.0.0.1', 1)),
          lambda: s.connect_ex(('127.0.0.1', 1)), lambda: s.setblocking(True), lambda: s.settimeout(1), lambda: s.getsockopt(1, 2), lambda: s.setsockopt(1, 2, 1), lambda: s.shutdown(0),
          lambda: s.recv_into(bytearray(1)), lambda: s.recvfrom(1), lambda: s.recvfrom_into(bytearray(1)), lambda: s.recvmsg(1), lambda: s.recvmsg_into([bytearray(1)]), lambda: s.sendmsg([b'x']),
          lambda: s.sendto(b'x', ('127.0.0.1', 1)), s.detach, s.gettimeout, s.getblocking]:
    t(f)
t(lambda: s.recv(0)); t(lambda: s.recv_into(bytearray(0))); t(lambda: s.recvfrom(0))
for fam, typ, pro in [(S.AF_INET, S.SOCK_DGRAM, 0), (S.AF_INET6, S.SOCK_STREAM, 0), (S.AF_UNIX, S.SOCK_STREAM, 0), (S.AF_UNIX, S.SOCK_DGRAM, 0), (S.AF_INET, S.SOCK_STREAM, S.IPPROTO_TCP), (S.AF_INET, S.SOCK_DGRAM, S.IPPROTO_UDP),
                      (S.AF_UNIX, S.SOCK_SEQPACKET, 0), (S.AF_INET, S.SOCK_STREAM | S.SOCK_NONBLOCK, 0), (S.AF_INET, S.SOCK_STREAM | S.SOCK_CLOEXEC, 0), (S.AF_INET, S.SOCK_DGRAM | S.SOCK_NONBLOCK | S.SOCK_CLOEXEC, 0)]:
    x = S.socket(fam, typ, pro)
    print(x.family, x.type, x.proto, x.timeout, x.getblocking(), os.get_blocking(x.fileno()), os.get_inheritable(x.fileno()), x.getsockname(), norm(x, x.fileno()))
    y = S.socket(fileno=S.dup(x.fileno()))
    print(y.family, y.type, y.proto, y.timeout, os.get_inheritable(y.fileno()), os.get_blocking(y.fileno()))
    z = S.socket(S.AF_UNIX, S.SOCK_RAW, 7, S.dup(x.fileno()))
    print(z.family, z.type, z.proto)
    x.close(); y.close(); z.close()
print(S.socket(family=S.AF_UNIX, type=S.SOCK_DGRAM, proto=0, fileno=None).type == S.SOCK_DGRAM)
x = S.socket(-1, -1, -1); print(x.family, x.type, x.proto); x.close()
# detach
x = S.socket(); fd = x.fileno(); print(x.detach() == fd, x.fileno(), x.detach()); os.fstat(fd); S.close(fd); t(lambda: S.close(fd))
# dup
x = S.socket(); d = S.dup(x.fileno()); print(d != x.fileno(), os.get_inheritable(d)); S.close(d); x.close()
# blocking and timeouts
x = S.socket()
for v in [None, 0, 0.0, 1, 1.5, 0.25, 1e-9, 1e-12, 10**9, True, False]:
    x.settimeout(v); print(repr(v), repr(x.gettimeout()), repr(x.timeout), x.getblocking(), os.get_blocking(x.fileno()))
for v in [True, False, 1, 0, 'a', '', [], [0], None]:
    x.setblocking(v); print(repr(v), x.gettimeout(), x.getblocking(), os.get_blocking(x.fileno()))
class B:
    def __bool__(self): raise KeyError('no')
t(lambda: x.setblocking(B()))
import fractions, decimal
x.settimeout(fractions.Fraction(1, 4)); print(x.gettimeout()); x.settimeout(decimal.Decimal('0.5')); print(x.gettimeout())
class F:
    def __float__(self): return 2.5
x.settimeout(F()); print(x.gettimeout())
class I:
    def __index__(self): return 7
x.settimeout(I()); print(x.gettimeout())
# options
print(x.getsockopt(S.SOL_SOCKET, S.SO_REUSEADDR), x.setsockopt(S.SOL_SOCKET, S.SO_REUSEADDR, 1), x.getsockopt(S.SOL_SOCKET, S.SO_REUSEADDR))
print(x.getsockopt(S.SOL_SOCKET, S.SO_TYPE) == S.SOCK_STREAM, x.getsockopt(S.SOL_SOCKET, S.SO_ERROR), x.getsockopt(S.SOL_SOCKET, S.SO_ACCEPTCONN))
print(x.getsockopt(S.SOL_SOCKET, S.SO_REUSEADDR, 4), x.getsockopt(S.SOL_SOCKET, S.SO_REUSEADDR, 16), x.getsockopt(S.SOL_SOCKET, S.SO_REUSEADDR, 1), x.getsockopt(S.SOL_SOCKET, S.SO_LINGER, 8))
import struct
x.setsockopt(S.SOL_SOCKET, S.SO_LINGER, struct.pack('ii', 1, 5)); print(struct.unpack('ii', x.getsockopt(S.SOL_SOCKET, S.SO_LINGER, 8)))
x.setsockopt(S.SOL_SOCKET, S.SO_LINGER, bytearray(struct.pack('ii', 0, 0))); print(struct.unpack('ii', x.getsockopt(S.SOL_SOCKET, S.SO_LINGER, 1024)))
x.setsockopt(S.SOL_SOCKET, S.SO_KEEPALIVE, True); print(x.getsockopt(S.SOL_SOCKET, S.SO_KEEPALIVE)); x.setsockopt(S.SOL_SOCKET, S.SO_KEEPALIVE, I()); print(x.getsockopt(S.SOL_SOCKET, S.SO_KEEPALIVE))
x.setsockopt(S.IPPROTO_TCP, S.TCP_NODELAY, 1); print(x.getsockopt(S.IPPROTO_TCP, S.TCP_NODELAY))
x.setsockopt(S.SOL_SOCKET, S.SO_RCVBUF, 8192); print(x.getsockopt(S.SOL_SOCKET, S.SO_RCVBUF) >= 8192)
t(lambda: x.setsockopt(S.SOL_SOCKET, S.SO_LINGER, b'x'))
t(lambda: x.setsockopt(S.SOL_SOCKET, 12345, 1))
t(lambda: x.getsockopt(S.SOL_SOCKET, 12345))
t(lambda: x.setsockopt(S.SOL_SOCKET, S.SO_REUSEADDR, None, 0))
t(lambda: x.getsockopt(S.IPPROTO_TCP, S.TCP_CONGESTION, 16).rstrip(b'\0') in (b'cubic', b'bbr', b'reno'))
x.close()
# calling __init__ again
x = S.socket(); a = x.fileno(); x.__init__(S.AF_UNIX); print(x.family == S.AF_UNIX, x.fileno() != a); S.close(a); x.close()
x = S.socket(); x.close(); x.__init__(); print(x.fileno() > 2); x.close()
print(bool(S.socket.__new__(S.socket)), S.socket.__new__(S.socket) == S.socket.__new__(S.socket))
