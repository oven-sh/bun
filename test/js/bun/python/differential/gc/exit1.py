import sys, tempfile, os
class Node:
    def __init__(self, name, *children):
        self.name = name; self.children = list(children); self.closed = False
    def __del__(self):
        print("del", self.name, [c.name + ("(closed)" if c.closed else "") for c in self.children])
        self.closed = True
child = Node("child")
parent = Node("parent", child)
def uses_globals():   # a cycle through the globals
    return parent
first = Node("first")
second = Node("second")
path = tempfile.mktemp()
f = open(path, "w")
class Owner:
    def __init__(self, f): self.f = f
    def __del__(self):
        self.f.write("flushed at exit"); self.f.close()
        print(open(path).read()); os.remove(path)
owner = Owner(f)
x = Node("in a cycle"); x.children.append(x)
print("end of the module")
