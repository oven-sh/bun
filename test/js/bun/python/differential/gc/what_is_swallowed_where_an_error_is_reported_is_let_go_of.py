# An exception is being printed, and what it is printed to raises: that is swallowed. It is gone then, with its traceback, the frames in that and their variables. In one thread; nothing is raised afterwards,
# native code calls nothing of the program's, and nobody asks for a collection.
import sys, weakref

class Local: pass
def calls(n, a, b, c, d, e, f): return calls(n - 1, b, c, d, e, f, a) if n else None
def is_let_go_of(watch):
    # The program goes on: it calls functions of its own (frames that are over are still memory until others come to lie there), and makes garbage until a collector comes.
    i = 0; junk = None
    while watch() is not None and i < 20000:
        calls(50, 1, 2, 3, 4, 5, 6); junk = [None] * 4000; i += 1
    return watch() is None

class Broken:
    watch = None
    def write(self, text):
        local = Local(); self.watch = weakref.ref(local)
        raise RuntimeError('no')
    def flush(self): pass

real = sys.stderr
sys.stderr = broken = Broken()
sys.__excepthook__(ValueError, ValueError('x'), None)
sys.stderr = real
print('sys.stderr.write() has raised while an exception was printed:', broken.watch is not None)
print('its variable is gone:', is_let_go_of(broken.watch))
