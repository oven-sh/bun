# next() of a TextIOWrapper turns the telling off. The buffer, asked for more, calls flush() of the wrapper, or what flushes: that turns it on again, in the middle of
# a step that began without it. CPython fails there without an exception: the end to next(), a SystemError to read() and readline(), in words that depend on how often
# the line has run, so they are left out.
import io
def show(f):
    try: return 'returned %r' % (f(),)
    except SystemError: return 'SystemError'
    except BaseException as e: return '%s(%s)' % (type(e).__name__, e)
class Buffer(io.BufferedIOBase):
    calls = 100
    def readable(self): return True
    def writable(self): return True
    def seekable(self): return True
    def read1(self, size=-1):
        self.calls += 1
        if self.calls == self.acts_at: print(' from within:', show(self.act))
        return b'abc\n' if self.calls < 5 else b''
    read = read1
    def write(self, b): return len(b)
    def flush(self): pass
    def tell(self): return 0
    def seek(self, *a): return 0
class Derived(io.TextIOWrapper):
    pass
class WithReadline(io.TextIOWrapper):
    def readline(self, *a): return super().readline(*a)
USES = {
    'next': lambda t: next(t), 'readlines': lambda t: t.readlines(), 'for': lambda t: [line for line in t], 'list': lambda t: list(t),
    'readline': lambda t: t.readline(), 'readline(2)': lambda t: t.readline(2), 'read': lambda t: t.read(), 'read(2)': lambda t: t.read(2), 'read(20)': lambda t: t.read(20),
}
for kind in (io.TextIOWrapper, Derived, WithReadline):
    for act in ('flush', 'detach', 'close', 'tell'):
        for name, use in USES.items():
            # In the first step of all, then in one that follows a next().
            for acts_at in (1, 2):
                buffer = Buffer(); text = kind(buffer, encoding='utf-8'); buffer.act = lambda: type(getattr(text, act)()).__name__; buffer.acts_at = acts_at; buffer.calls = 0
                before = show(lambda: next(text)) if acts_at == 2 else '-'
                print(kind.__name__, '|', act, '|', name, '|', before, '|', show(lambda: use(text)), '|', show(lambda: use(text)), '|', show(text.tell), flush=True)
