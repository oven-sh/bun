# detach() of a buffered stream while one of its methods is under way: called by the raw stream from its readinto() or write(), or by another thread while this one
# waits in read(). detach() itself asks for no lock, only the flush() that it calls does, and that of a reader does not, nor one that a subclass has written. In CPython
# a method that goes on to use the raw stream once more ends the process, or raises a SystemError about a null argument. Here it is a ValueError. So what is expected
# was written by hand; a method that is through with the raw stream returns what it returns in CPython.
import array, errno, fcntl, io, os, termios, threading
def show(f):
    try: return 'returned %r' % (f(),)
    except BaseException as e: return '%s(%s)' % (type(e).__name__, e)
class Raw(io.RawIOBase):
    calls = 0
    def readable(self): return True
    def writable(self): return True
    def seekable(self): return True
    def seek(self, *a): return 0
    def tell(self): return 0
    def readinto(self, b):
        self.calls += 1
        if self.calls > 3: return 0
        b[:] = b'.' * len(b)
        return self.act(b)
    def write(self, b):
        self.calls += 1
        if self.calls > 3: return len(b)
        return self.act(b)
class Writer(io.BufferedWriter):
    def flush(self): pass
class Random(io.BufferedRandom):
    def flush(self): pass
def detaches(self, b):
    print(' from within:', show(lambda: type(self.stream.detach()).__name__))
    return len(b)
def detaches_and_is_interrupted(self, b):
    print(' from within:', show(lambda: type(self.stream.detach()).__name__))
    raise InterruptedError(errno.EINTR, 'interrupted')
READS = {
    'read(64)': lambda s: s.read(64), 'read(3)': lambda s: s.read(3), 'read()': lambda s: len(s.read()), 'read1(64)': lambda s: s.read1(64), 'peek()': lambda s: s.peek(),
    'readline()': lambda s: s.readline(), 'readlines()': lambda s: s.readlines(), 'next()': lambda s: next(s), 'readinto(64)': lambda s: s.readinto(bytearray(64)), 'readinto1(64)': lambda s: s.readinto1(bytearray(64)),
}
WRITES = {
    'write(64)': lambda s: s.write(b'x' * 64), 'write(1), flush()': lambda s: (s.write(b'x'), super(type(s), s).flush()), 'write(1), close()': lambda s: (s.write(b'x'), s.close()),
    'write(1), seek(0)': lambda s: (s.write(b'x'), s.seek(0)), 'write(1), tell()': lambda s: (s.write(b'x'), s.tell()), 'write(1), truncate()': lambda s: (s.write(b'x'), s.truncate()),
}
for act in (detaches, detaches_and_is_interrupted):
    for make, uses in ((io.BufferedReader, READS), (Writer, WRITES), (Random, READS | WRITES)):
        for name, use in uses.items():
            raw = Raw(); raw.act = act.__get__(raw); stream = raw.stream = make(raw, 16)
            print(act.__name__, '|', make.__name__, '|', name, '|', show(lambda: use(stream)), '|', show(lambda: use(stream)), flush=True)

# Another thread. Whether it is in the system's read() by then or on its way there, it finds the raw stream gone when it wants more.
r, w = os.pipe()
stream = open(r, 'rb')
said = []
thread = threading.Thread(target=lambda: said.append(show(stream.readline)))
thread.start()
os.write(w, b'abc')
left = array.array('i', [1])
while left[0]:
    fcntl.ioctl(r, termios.FIONREAD, left)
raw = stream.detach()
os.write(w, b'def')
thread.join()
print(said, type(raw).__name__, show(stream.readline))
os.close(w); raw.close()
