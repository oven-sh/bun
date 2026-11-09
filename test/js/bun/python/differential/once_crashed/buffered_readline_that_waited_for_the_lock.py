# readline() of a buffered stream looks at the buffer first: the line may be there. If it is not, it takes the lock, and may have to wait for it. What it had seen in the
# buffer it then took from the buffer as it was after the wait, at the position of that time: as many bytes as there had been, from a place where there were fewer, and so
# from behind the buffer. Now it looks again once it has the lock.
import io, threading
class Raw(io.RawIOBase):
    def hook(self, name):
        f = self.__dict__.pop('in_' + name, None)
        if f: f()
    def readable(self): return True
    def seekable(self): return True
    @property
    def closed(self):
        self.hook('closed')
        return False
    def readinto(self, b):
        b[:] = b'a' * len(b); return len(b)
    def seek(self, offset, whence=0):
        self.hook('seek'); return offset
    def tell(self): return 0
for limit in (9000, 8191, 100, 20000):
    raw = Raw(); stream = io.BufferedReader(raw, 8192)
    stream.read(1)
    lines = []; asked = threading.Event()
    def other():
        # The last of the program's that runs before readline() looks at the buffer.
        raw.in_closed = asked.set
        lines.append(stream.readline(limit))
    thread = threading.Thread(target=other)
    # The main thread holds the lock here. It goes on when the other has come to readline(), and moves the position to near the end of the buffer.
    raw.in_seek = lambda: (thread.start(), asked.wait(60))
    stream.seek(100000)
    read = stream.read(8000)
    thread.join()
    print(limit, '|', len(lines[0]), 'bytes, not of the raw stream:', len(lines[0].translate(None, b'a')), '|', len(read), len(read.translate(None, b'a')), flush=True)
