import select
print(sorted(n for n in dir(select) if not n.startswith('__')))
print(sorted((k, getattr(select, k)) for k in dir(select) if k.isupper()))
p = select.poll(); e = select.epoll()
print(type(p), sorted(n for n in dir(p) if not n.startswith('__')), type(p).__mro__)
print(type(e), sorted(n for n in dir(e) if not n.startswith('__')), type(e).__mro__)
print(select.error is OSError, repr(e).split(' at ')[0], repr(p).split(' at ')[0])
print('__del__' in dir(e), '__del__' in dir(p), '__enter__' in dir(e), '__exit__' in dir(e))
def t(f):
    try: print(repr(f()))
    except BaseException as x: print(type(x).__name__ + ':', x)
t(lambda: type(p)())
t(lambda: select.poll(1))
def sube():
    class E(select.epoll): pass
t(sube)
def sub():
    class P(type(p)): pass
t(sub)
t(lambda: hash(e) == hash(e))
e.close()
