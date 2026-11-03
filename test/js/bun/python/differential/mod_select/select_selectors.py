import selectors, socket, os, time, select, re
def t(f):
    try: print(repr(f()))
    except BaseException as x: print(type(x).__name__ + ':', re.sub(r'(fd=|FD )\d+', 'fd=N', str(x)))
print(selectors.DefaultSelector.__name__, sorted(n for n in dir(selectors) if n.endswith('Selector')))
for cls in [selectors.SelectSelector, selectors.PollSelector, selectors.EpollSelector, selectors.DefaultSelector]:
    with cls() as sel:
        a, b = socket.socketpair()
        k = sel.register(a, selectors.EVENT_READ, 'data-a'); print(cls.__name__, k.fileobj is a, k.fd == a.fileno(), k.events, k.data)
        sel.register(b, selectors.EVENT_READ | selectors.EVENT_WRITE, 'data-b')
        print([(key.data, ev) for key, ev in sel.select(0)])
        b.send(b'x')
        print(sorted((key.data, ev) for key, ev in sel.select()))
        print(sorted((key.data, ev) for key, ev in sel.select(1.5)))
        sel.modify(b, selectors.EVENT_READ, 'new-b'); print([(key.data, ev) for key, ev in sel.select(-1)])
        a.recv(1); t0 = time.monotonic(); print(sel.select(0.05)); print(0.04 <= time.monotonic() - t0 < 3)
        print(len(sel.get_map()), sel.get_key(a).data, sel.unregister(a).data, len(sel.get_map()))
        t(lambda: sel.get_key(a)); t(lambda: sel.unregister(a)); t(lambda: sel.register(b, selectors.EVENT_READ)); t(lambda: sel.register(a, 0)); t(lambda: sel.register(-1, 1)); t(lambda: sel.register('x', 1))
        a.close(); print([(key.data, ev) for key, ev in sel.select(1)]); sel.unregister(b); b.close()
        if hasattr(sel, 'fileno'): print(sel.fileno() > 2)
    t(lambda: sel.select(0) if cls is not selectors.SelectSelector and cls is not selectors.PollSelector else None)
# many descriptors
sel = selectors.DefaultSelector(); pairs = [socket.socketpair() for _ in range(50)]
for i, (a, b) in enumerate(pairs): sel.register(a, selectors.EVENT_READ, i)
for a, b in pairs[::5]: b.send(b'!')
print(sorted(key.data for key, ev in sel.select(1)))
for a, b in pairs: sel.unregister(a); a.close(); b.close()
sel.close()
