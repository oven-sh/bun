# Native code asks an object of the program's for something, the code of the program raises, and the native code goes on without an answer: IOBase.__del__() asks for `closed`. The exception is gone then, with
# its traceback, the frames in that and their variables. In one thread; nothing is raised afterwards, native code calls nothing of the program's, and nobody asks for a collection.
import io, weakref

class Local: pass
watch = []
class File(io.IOBase):
    @property
    def closed(self):
        local = Local(); watch.append(weakref.ref(local))
        raise RuntimeError('no')
def calls(n, a, b, c, d, e, f): return calls(n - 1, b, c, d, e, f, a) if n else None

file = File()
io.IOBase.__del__(file)
# The program goes on: it calls functions of its own (frames that are over are still memory until others come to lie there), and makes garbage until a collector comes.
i = 0; junk = None
while watch[0]() is not None and i < 20000:
    calls(50, 1, 2, 3, 4, 5, 6); junk = [None] * 4000; i += 1
print('the variable of the frame that raised is gone:', watch[0]() is None)
