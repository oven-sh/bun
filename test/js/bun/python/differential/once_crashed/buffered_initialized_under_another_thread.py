# __init__() of a buffered stream calls the raw stream: readable(), writable(), tell(). While it waits in such a call, another thread takes the lock of the stream and
# waits in readinto() or write(). If __init__() then goes on and puts a smaller buffer in place, the other thread goes on with positions of the larger one: read()
# returned memory from behind the buffer, write() copied to memory before it. Here __init__() is refused, as it is if the lock is held when it is called, and has
# written neither the raw stream nor the buffer nor the positions. CPython ends the process in the first case and in the second (it makes the lock anew while it is
# held); in the third it goes on, for it has put its buffer in place before it calls tell(). So what is expected was written by hand.
import io, threading
def show(f):
    try: return 'returned %r' % (f(),)
    except BlockingIOError as e: return 'BlockingIOError, %d written' % e.characters_written
    except BaseException as e: return '%s(%s)' % (type(e).__name__, str(e).partition(' <')[0])
class Raw(io.RawIOBase):
    fill = b'x'
    label = 'the first'
    taken = 0
    # Each of these is called once, by the method of that name, and then forgotten.
    def hook(self, name):
        f = self.__dict__.pop('in_' + name, None)
        if f: f()
    def readable(self): self.hook('readable'); return True
    def writable(self): self.hook('writable'); return True
    def tell(self): self.hook('tell'); return 0
    @property
    def closed(self):
        if threading.current_thread() is not threading.main_thread(): self.hook('closed')
        return False
    def readinto(self, b):
        self.hook('readinto'); b[:] = self.fill * len(b); return len(b)
    def write(self, b):
        if 'in_write' not in self.__dict__: self.taken += len(b); return len(b)
        self.hook('write')
        # It would block.
        return None
def run(stream, raw, other):
    answers = []
    thread = threading.Thread(target=lambda: answers.extend(show(f) for f in other))
    thread.start()
    started.wait(60)
    print(' __init__(raw, 16):', show(lambda: stream.__init__(raw, 16)), flush=True)
    print(' the raw stream is', show(lambda: stream.raw.label), flush=True)
    done.set()
    thread.join()
    for answer in answers: print(' the other thread:', answer, flush=True)
    print(' flush():', show(stream.flush), '| the raw stream has taken', raw.taken, flush=True)
    print(' afterwards:', show(lambda: stream.__init__(raw, 16)), '|', show(lambda: stream.raw is raw), flush=True)

print('a reader that is past its checks when __init__() is called')
started, past, locked, done = (threading.Event() for _ in range(4))
raw = Raw(); stream = io.BufferedReader(raw, 8192)
raw.in_closed = lambda: (started.set(), past.wait(60))
raw.in_readable = lambda: (past.set(), locked.wait(60))
raw.in_readinto = lambda: (locked.set(), done.wait(60))
count = lambda data: (len(data), data.count(b'x'), data.count(b'y'))
run(stream, raw, [lambda: count(stream.read(5000)), lambda: count(stream.read(3000))])

print('a writer: an __init__() within makes the stream fit for use while the outer one waits')
started, locked, done = (threading.Event() for _ in range(3))
raw = Raw(); stream = io.BufferedWriter(raw, 8192)
def blocks():
    raw.in_write = lambda: (locked.set(), done.wait(60))
    return stream.write(b'z' * 8150)
go = threading.Event()
raw.in_writable = lambda: (stream.__init__(raw, 8192), go.set(), locked.wait(60))
started.set()
run(stream, raw, [lambda: go.wait(60), lambda: stream.write(b'a' * 100), blocks])

print('a reader that takes the lock while __init__() asks another raw stream where it is')
started, past, locked, done = (threading.Event() for _ in range(4))
raw = Raw(); stream = io.BufferedReader(raw, 8192)
another = Raw(); another.fill = b'y'; another.label = 'another'
raw.in_closed = lambda: (started.set(), past.wait(60))
another.in_tell = lambda: (past.set(), locked.wait(60))
raw.in_readinto = another.in_readinto = lambda: (locked.set(), done.wait(60))
run(stream, another, [lambda: count(stream.read(5000))])
