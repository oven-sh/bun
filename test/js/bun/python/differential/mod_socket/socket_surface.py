import _socket as S
names = [n for n in dir(S) if not n.startswith('__') and n not in ('CAPI', 'IPPROTO_L2TP') and not n.startswith('RDS_')]
print(names)
print([(n, getattr(S, n)) for n in names if isinstance(getattr(S, n), int)])
s = S.socket()
print(sorted(n for n in dir(s) if not n.startswith('__') and n != 'sendmsg_afalg'))
print([n for n in dir(s) if n.startswith('__') and n not in dir(object) and n != '__module__'])
print(S.socket.__mro__, S.SocketType is S.socket, S.socket.__name__, S.socket.__qualname__, S.socket.__module__)
print(S.herror.__mro__, S.gaierror.__mro__, S.timeout, S.error, S.has_ipv6)
print(S.herror.__name__, S.herror.__module__, S.herror.__qualname__, S.gaierror.__name__, S.gaierror.__module__)
print(repr(S.herror(1, 'x')), str(S.herror(1, 'x')), S.herror(1, 'x').errno, S.herror(1, 'x').strerror, S.gaierror(-2, 'y').args)
for n in names:
    f = getattr(S, n)
    if callable(f) and not isinstance(f, type):
        print(n, type(f).__name__, f.__name__, f.__module__, f.__qualname__, f.__self__ is S)
for n in ['inet_aton', 'if_nametoindex', 'CMSG_LEN', 'gethostbyname', 'getnameinfo', 'htons', 'sethostname', 'inet_pton', 'socketpair', 'inet_ntoa', 'if_indextoname', 'ntohl']:
    print(n, getattr(S, n).__text_signature__)
for n in ['recv', 'send', 'sendall', 'bind', 'setsockopt', 'close', 'shutdown', 'sendmsg', 'recvmsg', 'settimeout', 'listen', 'sendto', 'connect', 'fileno', 'detach', '_accept', 'getsockopt', 'recvfrom', 'recvmsg_into']:
    m = getattr(S.socket, n)
    print(n, type(m).__name__, m.__text_signature__, m.__qualname__)
print(type(S.socket.family).__name__, type(S.socket.timeout).__name__, type(S.socket.__del__).__name__, type(S.socket.__init__).__name__)
s.close()
class Sub(S.socket):
    __slots__ = ['__weakref__', 'a']
x = Sub(); x.a = 5; print(x.a, x.family, isinstance(x, S.socket), repr(x).split('fd=')[0])
import weakref; r = weakref.ref(x); print(r() is x)
try: x.b = 1
except AttributeError as e: print('AttributeError')
x.close()
class Sub2(S.socket): pass
y = Sub2(S.AF_UNIX); y.b = 1; print(y.__dict__, y.family == S.AF_UNIX); y.close()
try:
    class Bad(S.socket, dict): pass
except TypeError as e: print('TypeError:', e)
