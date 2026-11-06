# A program that makes objects with finalizers and drops them needs no more memory for making more of them. With reference counts each is freed where it is dropped. A collector that
# finds them dead has to keep them, with all they refer to, until their finalizers have been called, and frees them the next time. What it keeps is garbage: if it took that for the
# program's data and let the heap grow in proportion, the next round would leave more of it, and so on for ever.
# Each scene is a process of its own; all run at once. It makes a quarter of its objects, notes the most memory it has had so far, makes the rest, and says whether that took much more.
import subprocess, sys

calls = 0
class Counts:
    def __del__(self):
        global calls
        calls += 1
class Holds(Counts):
    def __init__(self, rest=None): self.items = [None] * 1000; self.rest = rest
class HoldsBytes(Counts):
    def __init__(self): self.data = bytearray(b'x' * 16000)
class MakesMore(Holds):
    # Collections come while these are being called, and what they find waits behind the rest.
    def __del__(self):
        Counts.__del__(self); [Holds() for _ in range(5)]
def chain(): return Holds(Holds(Holds()))
def generator(items):
    try: yield
    finally:
        global calls
        calls += 1
def suspended():
    g = generator([None] * 1000); next(g); return g

scenes = {'lists': (Holds, 60000), 'bytes': (HoldsBytes, 60000), 'finalizers that make more': (MakesMore, 24000), 'chains': (chain, 20000), 'generators': (suspended, 60000)}
MB = 1 << 20

def most_so_far():
    with open('/proc/self/status') as f:
        for line in f:
            if line.startswith('VmHWM:'): return int(line.split()[1]) * 1024

def run(name):
    make, count = scenes[name]
    def some(n):
        for i in range(n // 20): [make() for _ in range(20)]
    some(count // 4); before = most_so_far()
    some(count - count // 4); grown = most_so_far() - before
    if len(sys.argv) > 2: print(name, 'before', before // MB, 'MB, grown by', grown // MB, 'MB, calls', calls, file=sys.stderr)
    # Where the heap grows without bound: by 150 to 350 MB. Where it does not: by 0 to 25.
    print('%s: three times as many took %s; finalizers were called: %s' % (name, 'much more memory' if grown > 64 * MB else 'no more memory', calls > 0))

if len(sys.argv) > 1 and sys.argv[1] in scenes: run(sys.argv[1])
else:
    children = [subprocess.Popen([sys.executable, __file__, name, *sys.argv[1:]], stdout=subprocess.PIPE) for name in scenes]
    for child in children: sys.stdout.write(child.communicate()[0].decode())
