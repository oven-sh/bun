import gc, weakref, sys
log = []
class Node:
    def __init__(self, name, *children):
        self.name = name; self.children = list(children); self.closed = False
    def __del__(self):
        log.append((self.name, [c.name + ("(closed)" if c.closed else "") for c in self.children]))
        self.closed = True

def show(title):
    gc.collect()
    print(title, log); log.clear()

# child made first, then the parent
c = Node("child"); p = Node("parent", c); del c, p
show("child first:")
# parent made first, child attached later
p = Node("parent"); p.children.append(Node("child")); del p
show("parent first:")
# three levels, through containers without finalizers
a = Node("a"); b = Node("b"); a.children.append(b); b.extra = {"k": [Node("c")]}; b.children.append(b.extra["k"][0]); del a, b
show("three levels:")
# a diamond
d = Node("d"); l = Node("l", d); r = Node("r", d); t = Node("t", l, r); del d, l, r, t
show("diamond:")
# a cycle with something hanging off it
x = Node("x"); y = Node("y", x); x.children.append(y); h = Node("hanging"); x.children.append(h); del x, y, h
gc.collect(); print("cycle:", sorted(n for n, _ in log), log[-1][0] if log else None); log.clear()
# a parent that finds itself a home keeps its children from being finalized
keep = []
class Phoenix(Node):
    def __del__(self):
        super().__del__(); keep.append(self)
p = Phoenix("phoenix", Node("kept child")); del p
show("resurrection:")
print(keep[0].children[0].closed)
keep.clear()
show("then:")
# a long chain
head = None
for i in range(2000):
    head = Node(str(i), *([head] if head else []))
del head
gc.collect()
print("chain:", len(log), [n for n, _ in log[:3]], [n for n, _ in log[-2:]], all("(closed)" not in "".join(c) for _, c in log)); log.clear()
# a file used by the finalizer of its owner
import tempfile, os
path = tempfile.mktemp()
class Writer:
    def __init__(self): self.f = open(path, "w")
    def __del__(self): self.f.write("written by __del__"); self.f.close()
f = open(path + "2", "w")
class Writer2:
    def __init__(self, f): self.f = f
    def __del__(self): self.f.write("written by __del__ too"); self.f.close()
Writer(); w = Writer2(f); del w, f
gc.collect()
print(open(path).read(), "|", open(path + "2").read())
os.remove(path); os.remove(path + "2")
