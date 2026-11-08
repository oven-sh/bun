# marshal.load() numbers the objects that the data refers back to, in a list. For a frozenset a place is kept first and filled when the set is complete; the file is read in between, and gc.get_objects() hands its readinto() the list.
import gc, marshal
N = 50
data = b'[' + (N + 1).to_bytes(4, 'little') + b''.join(b'\xe9' + i.to_bytes(4, 'little') for i in range(N)) + b'\xbe' + (1).to_bytes(4, 'little') + b'i' + (7).to_bytes(4, 'little')
class File:
    def __init__(self, clears): self.at = 0; self.clears = clears; self.seen = []
    def read(self, n=-1): return b''
    def readinto(self, b):
        n = len(b)
        if self.at == len(data) - 5:            # The next is the one item of the frozenset.
            for o in gc.get_objects():
                if type(o) is list and id(o) not in before and len(o) == N + 1 and o[:N] == list(range(N)):
                    self.seen.append(len(o))
                    if self.clears: o.clear()
        b[:n] = data[self.at:self.at + n]; self.at += n
        return n
for clears in (False, True):
    file = File(clears); before = {id(o) for o in gc.get_objects() if type(o) is list}
    try: r = marshal.load(file); print('a', type(r).__name__, 'of', len(r), 'that ends with', r[-1])
    except SystemError as e: print('SystemError:', e)
    print('seen from readinto():', file.seen)
