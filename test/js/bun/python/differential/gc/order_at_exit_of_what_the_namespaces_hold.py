# What a program still holds when it ends. A function makes the namespace of its module a cycle, so all of this is for the collector, which calls the finalizers in the order of its lists. The
# collection before the modules go has put each object behind what refers to it: so a holder goes before what only it holds. That much CPython does in every program. The rest of its order depends on when
# its collector has come: these are the scenes in which it does not show. Each is a process of its own.
import os, subprocess, sys, tempfile

PROGRAM = r'''
import collections, io, os, sys
def say(*a): os.write(1, (' '.join(map(str, a)) + ' ').encode())
class T:
    def __init__(self, name, *holds): self.name = name; self.holds = holds
    def __del__(self): say(self.name)
class P:                # It has no finalizer.
    def __init__(self, *holds): self.holds = holds
class Raw(io.RawIOBase):
    def writable(self): return True
    def write(self, b): say('Raw.write', bytes(b)); return len(b)
    def close(self): say('Raw.close'); super().close()
class Writer(io.BufferedWriter):
    def close(self): say('Writer.close'); super().close()
    def flush(self): say('Writer.flush'); super().flush()
class Sink:             # Nor has this.
    def __init__(self, file): self.file = file; self.closed = False
    def writable(self): return True
    def write(self, b): return self.file.write(b)
    def flush(self): self.file.flush()
    def close(self): self.closed = True
def generator_with_arguments(a, b): yield 1
def closure_over(x): return lambda: x
exec(sys.argv[1])
say('end:')
'''
SCENES = {
    'a writer over a raw file of the program': "f = io.BufferedWriter(Raw()); f.write(b'xyz')",
    'text over a writer over a raw file of the program': "f = io.TextIOWrapper(io.BufferedWriter(Raw()), encoding='utf-8'); f.write('xyz')",
    'a writer of the program over a raw file of the program': "f = Writer(Raw()); f.write(b'xyz')",
    'a writer over a plain object over a file': "f = io.BufferedWriter(Sink(io.FileIO(1, 'w', closefd=False))); f.write(b'written ')",
    'the raw file has a name too, and the earlier one': "raw = Raw(); f = io.BufferedWriter(raw); f.write(b'xyz')",
    'three, one in the other': "h = T('holder', T('child', T('grandchild')))",
    'six, one in the other': "h = T(0, T(1, T(2, T(3, T(4, T(5))))))",
    'two names': "a = T('a'); b = T('b')",
    'sys._xoptions is gone': "t = T('t'); del sys._xoptions",
    'the name of the child is deleted': "c = T('child'); h = T('holder', c); del c",
    'the child has a name': "c = T('child'); h = T('holder', c)",
    'the child has a name and was made later': "h = T('holder'); c = T('child'); h.holds = (c,)",
    'three names, each holds the one before': "g = T('g'); c = T('c', g); h = T('h', c)",
    'a cycle of two': "a = T('a'); b = T('b', a); a.holds = (b,)",
    'a cycle of two, and what hangs off it': "c = T('child'); a = T('a'); b = T('b', a, c); a.holds = (b,); del c",
    'a cycle of holder and child, entered at the holder': "c = T('child'); h = T('holder', c); c.back = h; del c",
    'a cycle of three, entered at the youngest': "a = T('a'); b = T('b', a); c = T('c', b); a.holds = (c,); del a, b",
    'a cycle of three, entered in the middle': "a = T('a'); b = T('b', a); c = T('c', b); a.holds = (c,); del a, c",
    'a cycle of three, entered at two': "a = T('a'); b = T('b', a); c = T('c', b); a.holds = (c,); del b",
    'a writer and a raw file that knows its writer': "raw = Raw(); f = io.BufferedWriter(raw); raw.owner = f; del raw; f.write(b'xyz')",
    'what hangs off the cycle of a class': "class C: held = T('holder', T('child'))",
    'text over a writer over a raw file that knows the text': "raw = Raw(); t = io.TextIOWrapper(io.BufferedWriter(raw), encoding='utf-8'); raw.owner = t; del raw; t.write('xyz')",
    'a chain with links both ways, entered at the youngest': "n1 = T('n1'); n2 = T('n2'); n3 = T('n3'); n1.next = n2; n2.prev = n1; n2.next = n3; n3.prev = n2; head = n3; del n1, n2, n3",
    'a chain with links both ways, entered at the oldest': "n1 = T('n1'); n2 = T('n2'); n3 = T('n3'); n1.next = n2; n2.prev = n1; n2.next = n3; n3.prev = n2; head = n1; del n1, n2, n3",
    'a tree with links to the parent, children made first': "a = T('a'); b = T('b'); p = T('p'); p.a = a; p.b = b; a.parent = p; b.parent = p; del a, b",
    'a tree with links to the parent, parent made first': "p = T('p'); a = T('a'); b = T('b'); p.a = a; p.b = b; a.parent = p; b.parent = p; del a, b",
    'what hangs off a cycle of two, entered at the younger': "a = T('a'); b = T('b', a); a.holds = (b, T('below a', T('below that'))); del a",
    'a cycle that a holder holds': "c1 = T('c1'); c2 = T('c2', c1); c1.holds = (c2,); h = T('h', c2); del c1, c2",
    'a raw file that knows its writer, and an older holder of the raw file': "raw = Raw(); x = T('x', raw); f = io.BufferedWriter(raw); raw.owner = f; del raw; f.write(b'xyz')",
    'the same with plain objects': "c = T('c'); x = T('x', c); h = T('h', c); c.back = h; del c",
    # (When the other holder's turn comes is another matter: it says nothing.)
    'the same, the other holder is in a list': "class Quiet(T): __del__ = lambda self: None\nraw = Raw(); l = [Quiet('x', raw)]; f = io.BufferedWriter(raw); raw.owner = f; del raw; f.write(b'xyz')",
    'a child that knows its parent, and an older registry that holds the child': "child = T('child'); registry = T('registry', child); parent = T('parent', child); child.parent = parent; del child",
    'two cycles, one holds the other': "a = T('a'); b = T('b', a); a.holds = (b,); c = T('c'); d = T('d', c); c.holds = (d, a); top = T('top', d); del a, b, c, d",
    'a ring of four entered at the third': "r1 = T('r1'); r2 = T('r2', r1); r3 = T('r3', r2); r4 = T('r4', r3); r1.holds = (r4,); keep = r3; del r1, r2, r3, r4",
    'a writer and another over one raw file that knows both': "raw = Raw(); w = io.BufferedWriter(raw); other = T('other', raw); raw.users = [w, other]; del raw; w.write(b'xyz')",
    # The name has to be its own.
    'the child is in a list that has a name': "c = T('child'); l = [c]; p = T('parent', c); del c",
    'the child is in a list that has a name and was made later': "c = T('child'); p = T('parent', c); l = [c]; del c",
    'the child is in a dict that has a name': "c = T('child'); d = {'k': c}; p = T('parent', c); del c",
    'the child is in a plain object that has a name': "c = T('child'); q = P(c); p = T('parent', c); del c",
    'the child is deep in a list that has a name': "c = T('child'); l = [[[c]]]; p = T('parent', c); del c",
    'an older list that has a name holds the raw file too': "raw = Raw(); l = [raw]; f = io.BufferedWriter(raw); del raw; f.write(b'xyz')",
    # Where objects hold one another, the circle is opened where the names lead into it; where they lead into it at two places that are equally near, at the younger.
    # (When the turns of the two holders come is another matter: they say nothing.)
    'a holder of the writer and a younger holder of the raw file, which knows its writer': "class Quiet(T): __del__ = lambda self: None\nraw = Raw(); w = io.BufferedWriter(raw); y = Quiet('y', w); x = Quiet('x', raw); raw.owner = w; w.write(b'xyz'); del raw, w",
    'the same, the holder of the writer is the younger and has the earlier name': "class Quiet(T): __del__ = lambda self: None\ny = x = None; raw = Raw(); x = Quiet('x', raw); w = io.BufferedWriter(raw); y = Quiet('y', w); raw.owner = w; w.write(b'xyz'); del raw, w",
    'two in lists hold one another, the list of the younger has the earlier name': "a = T('a'); b = T('b', a); a.holds = (b,); lb = [b]; la = [a]; del a, b",
    'the writer is an attribute of a plain object with a name, and an older object holds the raw file, which knows its writer': "class App: pass\nraw = Raw(); x = T('x', raw); app = App(); app.out = io.BufferedWriter(raw); raw.owner = app.out; del raw; app.out.write(b'xyz')",
    'the writer is in a list with a name, and an older object holds the raw file, which knows its writer': "raw = Raw(); x = T('x', raw); fs = [io.BufferedWriter(raw)]; raw.owner = fs[0]; del raw; fs[0].write(b'xyz')",
    'the writer and the other holder of the raw file are in lists': "raw = Raw(); xs = [T('x', raw)]; fs = [io.BufferedWriter(raw)]; raw.owner = fs[0]; del raw; fs[0].write(b'xyz')",
    'the parent holds a list with a name that holds the child': "c = T('child'); l = [c]; p = T('parent', l); del c",
    'the parent holds a list, in a list with a name, that holds the child': "c = T('child'); l = [[c]]; p = T('parent', l[0]); del c",
    'a registry in a plain object with a name holds parent and child, which know the registry': "class P: pass\napp = P(); app.reg = P(); app.reg.all = []\nc = T('child'); c.reg = app.reg; app.reg.all.append(c); p = T('parent', c); p.reg = app.reg; app.reg.all.append(p); del c, p",
    'the same with a writer and its raw file': "class P: pass\napp = P(); app.reg = P(); app.reg.all = []\nraw = Raw(); raw.reg = app.reg; app.reg.all.append(raw); f = io.BufferedWriter(raw); app.reg.all.append(f); del raw; f.write(b'xyz'); del f",
    'an owner holds a holder of the raw file, and behind that a list with the writer': "app = T('app'); raw = Raw(); app.x = T('x', raw); app.files = [io.BufferedWriter(raw)]; raw.owner = app.files[0]; app.files[0].write(b'xyz'); del raw",
    'inside a circle: the owner leads to the raw file by one that knows the owner, and to the writer by a list': "app = T('app'); raw = Raw(); a = T('a', raw); a.app = app; app.a = a; app.files = [io.BufferedWriter(raw)]; raw.owner = app.files[0]; raw.app = app; app.files[0].write(b'xyz'); apps = [app]; del raw, app, a",
    'raw files in one list, their writers in a list with an earlier name; the raw file knows its writer': "ws = []; raws = [Raw()]; ws.append(io.BufferedWriter(raws[0])); raws[0].owner = ws[0]; ws[0].write(b'xyz')",
    'a raw file and its writer in one list; the raw file knows its writer': "l = [Raw()]; l.append(io.BufferedWriter(l[0])); l[0].owner = l[1]; l[1].write(b'xyz')",
    'a parent, and a child that was given the parent, in one list': "nodes = [T('parent')]; nodes.append(T('child', nodes[0])); nodes[0].holds = (nodes[1],)",
    'a child, and a parent that was given the child, which knows the parent, in one list': "nodes = [T('child')]; nodes.append(T('parent', nodes[0])); nodes[0].back = nodes[1]",
    'an object that refers to itself': "a = T('a'); a.me = a",
    'an object that refers to itself, and a holder of it': "a = T('a'); a.me = a; b = T('b', a); del a",
    'an object that refers to itself, a holder of it, and what it holds': "c = T('c'); a = T('a', c); a.me = a; b = T('b', a); del a, c",
    'a holder of a list with a raw file and its writer; the raw file knows its writer': "raw = Raw(); w = io.BufferedWriter(raw); raw.owner = w; w.write(b'xyz'); x = T('x', [raw, w]); del raw, w",
    'a holder of the older of two that hold one another': "a = T('a'); b = T('b', a); a.holds = (b,); x = T('x', a); del a, b",
    'four, one in the other, in a list; the last knows the third and the second, the second the first': "d = T('d'); c = T('c', d); d.back = c; b = T('b', c); d.up = b; a = T('a', b); b.up = a; l = [a]; del a, b, c, d",
    'a list holds two, and the younger knows the list': "b = T('b'); a = T('a'); l = [a, b]; a.l = l; del a, b",
    'a chain of twelve with links both ways, entered at the youngest': "n = [T(i) for i in range(12)]\nfor i in range(11): n[i].next = n[i + 1]; n[i + 1].prev = n[i]\nh = [n[11]]; del n, i",
    # (The cell of a closure leads to the writer too, from a generator that has a name and nothing to close.)
    'a generator hands on to one whose finally writes to a writer': "def writes(f):\n    try: yield 1\n    finally: f.write(b'xyz')\ng = (lambda f: (lambda: (yield from writes(f)))())(io.BufferedWriter(Raw())); next(g)",
    'two writers over one raw file': "raw = Raw(); a = io.BufferedWriter(raw); b = io.BufferedWriter(raw); del raw; a.write(b'aaa'); b.write(b'bbb')",
    'the second holder is made later': "a = T('a', T('child')); b = T('b', a.holds[0])",
    'two holders of a list': "c = T('child'); k = [c]; a = T('a', k); b = T('b', k); del c, k",
    'two holders': "c = T('child'); a = T('a', c); b = T('b', c); del c",
    'a diamond': "d = T('bottom'); l = T('left', d); r = T('right', d); t = T('top'); t.l = l; t.r = r; del d, l, r",
    'attributes': "h = T('holder'); h.x = T('x'); h.y = T('y')",
    'ten attributes': "h = T('h')\nfor i in range(10): setattr(h, 'a%d' % i, T(i))",
    'a dict and a list': "a = {'x': T('in the dict')}; l = [T('in the list')]",
    'a dict in an object': "h = T('holder', {'k': T('child')})",
    'a list in an object': "h = T('holder', [T('child')])",
    'a plain object in an object': "h = T('holder', P(P(T('child'))))",
    'a closure in an object': "h = T('holder', closure_over(T('child')))",
    'a deque': "d = collections.deque([T(0), T(1), T(2)])",
    'a deque and a list': "d = collections.deque([T('in the deque')]); l = [T('in the list')]",
    'a generator and the program share an object': "s = T('shared'); it = generator_with_arguments(s, T('b')); next(it); z = T('z')",
    # Every way from the names to the older object leads through the holder, and by way of plain cells that hold one another: what holds one of them holds what hangs off the others.
    'an older object in a cycle of lists below a holder with a name': "res = T('res'); a = []; b = []; a.append(b); b.append(a); b.append(res); res.back = b; doc = T('doc', a); del res, a, b",
    'the same, the holder is in a list with a name': "res = T('res'); a = []; b = []; a.append(b); b.append(a); b.append(res); res.back = b; docs = [T('doc', a)]; del res, a, b",
    'an older object hangs off a cycle of lists below a holder with a name': "res = T('res'); a = []; b = []; a.append(b); b.append(a); b.append(res); doc = T('doc', a); del res, a, b",
    'a younger object in a cycle of lists below a holder with a name': "doc = T('doc'); a = []; b = []; a.append(b); b.append(a); res = T('res'); b.append(res); res.back = b; doc.holds = (a,); del res, a, b",
    'a raw file in a cycle of lists that the owner of its writer holds': "raw = Raw(); a = []; b = []; a.append(b); b.append(a); b.append(raw); raw.back = b; w = io.BufferedWriter(raw); w.write(b'xyz'); own = T('own', w, a); del raw, a, b, w",
    'a document over a tree of plain nodes with links to the parents; a leaf has an older resource that knows its node': "res = T('res'); root = P(); leaf = P(); root.child = leaf; leaf.parent = root; leaf.res = res; res.node = leaf; doc = T('doc', root); del res, root, leaf",
    'the same, the resource does not know its node': "res = T('res'); root = P(); leaf = P(); root.child = leaf; leaf.parent = root; leaf.res = res; doc = T('doc', root); del res, root, leaf",
    'two lists that hold one another, each with a holder of its own and an older object': "c1 = T('c1'); c2 = T('c2'); l1 = [c1]; l2 = [c2]; l1.append(l2); l2.append(l1); a = T('a', l1); b = T('b', l2); del c1, c2, l1, l2",
    'two hold one list of a cycle of lists in which an object is that holds an older one': "old = T('old'); res = T('res', old); a = []; b = []; a.append(b); b.append(a); b.append(res); res.back = b; d1 = T('d1', a); d2 = T('d2', a); del old, res, a, b",
    'two hold one list of a cycle of lists off which an object hangs that holds an older one': "old = T('old'); res = T('res', old); a = []; b = []; a.append(b); b.append(a); b.append(res); d1 = T('d1', a); d2 = T('d2', a); del old, res, a, b",
    'one document over two cycles of lists, in each an older object': "r1 = T('r1'); r2 = T('r2'); a = []; b = []; a.append(b); b.append(a); b.append(r1); r1.back = b; c = []; d = []; c.append(d); d.append(c); d.append(r2); r2.back = d; doc = T('doc', c, a); del r1, r2, a, b, c, d",
    # The same in circles of more than 64 cells, which are opened in other ways.
    'a document over a chain of a hundred plain nodes with links back; the last has an older resource that knows its node': "res = T('res'); nodes = [P() for i in range(100)]\nfor a, b in zip(nodes, nodes[1:]): a.child = b; b.parent = a\nnodes[-1].res = res; res.node = nodes[-1]; doc = T('doc', nodes[0]); del res, nodes, a, b",
    'the same, every tenth node has an older resource that knows its node': "rs = [T('r%d' % i) for i in range(10)]; nodes = [P() for i in range(100)]\nfor a, b in zip(nodes, nodes[1:]): a.child = b; b.parent = a\nfor i, r in enumerate(rs): nodes[10 * i + 9].res = r; r.node = nodes[10 * i + 9]\ndoc = T('doc', nodes[0]); del rs, nodes, a, b, i, r",
    'a doubly linked list of seventy objects; the last holds a cycle of lists that leads back to it, off which hangs an object older than the last': "nodes = [T(i) for i in range(69)]; res = T('res'); nodes.append(T(69))\nfor x, y in zip(nodes, nodes[1:]): x.next = y; y.prev = x\na = []; b = []; a.append(b); b.append(a); b.append(res); res.back = b; b.append(nodes[-1]); nodes[-1].a = a\nkeep = [nodes[0]]; del nodes, res, a, b, x, y",
    'two such circles: the resource of the last of seventy plain nodes holds a doubly linked list of a hundred objects that were made from the last to the first': "class P: pass\nes = [T(i) for i in reversed(range(100))]; es.reverse()\nfor x, y in zip(es, es[1:]): x.next = y; y.prev = x\nres = T('res', es[0]); nodes = [P() for i in range(70)]\nfor a, b in zip(nodes, nodes[1:]): a.child = b; b.parent = a\nnodes[-1].res = res; res.node = nodes[-1]; doc = T('doc', nodes[0]); del es, x, y, res, nodes, a, b",
    # One that is not opened, for want of looks, and that only a list with a name holds. (The links are slots: in CPython no dict lies between, which would go with the circle and let go of what hangs off it.)
    'no looks: a list with a name holds one of a ring of seventy objects; off the thirty-sixth hangs an older one': "import sys; sys._xoptions['finalization_order_looks'] = '0'\nclass Q(T): __slots__ = ('held', 'next')\nold = T('old'); ring = [Q(i) for i in range(70)]; ring[35].held = old\nfor x, y in zip(ring, ring[1:] + ring[:1]): x.next = y\nkeep = [ring[0]]; del old, ring, x, y",
    # What no name leads to is entered from the holders down, and a holder may be a cycle of plain cells.
    'a cycle of lists that nothing holds refers to the older of two objects that know each other': "x = T('x'); y = T('y'); x.o = y; y.o = x; a = []; b = [a]; a.append(b); a.append(x); del x, y, a, b",
}
KINDS = """import io, sys
class A:
    def __init__(self, n, *holds): self.n = n; self.holds = holds
    def __del__(self): sys.__stdout__.write(self.n + ' ')
class Raw(io.RawIOBase):
    def writable(self): return True
    def write(self, b): sys.__stdout__.write('Raw.write %r ' % bytes(b)); return len(b)
    def close(self): sys.__stdout__.write('Raw.close '); super().close()
class Sink:             # It has no finalizer.
    closed = False
    def writable(self): return True
    def write(self, b): sys.__stdout__.write(bytes(b).decode()); return len(b)
    def flush(self): pass
    def close(self): pass
"""
CODE = "from kinds import A\ndef f(): pass\nown = A('%s')\n"
WITH_MODULES = {
    # The namespace of a program without a function is no cycle: it goes by reference counts, and what it held is where a cycle is entered.
    'a program without a function: a cycle entered at the holder': "import kinds\nc = kinds.A('child'); h = kinds.A('holder', c); c.back = h; del c\n",
    'a program without a function: the child in a cycle has a name': "import kinds\nc = kinds.A('child'); h = kinds.A('holder', c); c.back = h\n",
    'a program without a function: what hangs off a cycle': "import kinds\nh = kinds.A('holder', kinds.A('child')); h.me = h\n",
    # (Nothing is left that holds the lists.)
    'a program without a function: off a cycle of lists with names hangs an object that holds an older one': "import kinds\ny = kinds.A('y'); x = kinds.A('x', y); a = []; b = [a]; a.append(b); a.append(x); del x, y\n",
    'a program without a function: in a cycle of lists with names is an object that holds an older one': "import kinds\ny = kinds.A('y'); x = kinds.A('x', y); a = [x]; b = [a]; a.append(b); x.back = a; del x, y\n",
    # (One finalizer that is code of the program, and one that is not.)
    'a program without a function: a raw file that knows its writer': "import io, kinds\nr = kinds.Raw(); w = io.BufferedWriter(r); r.owner = w; del r; w.write(b'xyz')\n",
    'a program without a function: a writer and its raw file': "import io, kinds\nw = io.BufferedWriter(kinds.Raw()); w.write(b'xyz')\n",
    # (Only the namespace says that the raw file is where the two are entered. It is no cycle, and has gone by reference counts.)
    'a program without a function: the raw file has the name, and knows its writer, which nothing else holds': "import io, kinds\nraw = kinds.Raw(); raw.owner = io.BufferedWriter(raw); raw.owner.write(b'xyz')\n",
    # (The holder goes by reference counts, and the two in the same round: had they waited for the next, they would stand in the lists in another order.)
    'a program without a function: a holder of a list with a raw file and its writer': "import io, kinds\nraw = kinds.Raw(); w = io.BufferedWriter(raw); raw.owner = w; w.write(b'xyz'); x = kinds.A('x', [raw, w]); del raw, w\n",
    # (The way from the names leads through what reference counts have freed.)
    'a program without a function: a holder of the older of two that hold one another': "import kinds\na = kinds.A('a'); b = kinds.A('b', a); a.holds = (b,); x = kinds.A('x', a); del a, b\n",
    'a program without a function: an object that refers to itself, a holder of it, and what it holds': "import kinds\nc = kinds.A('c'); a = kinds.A('a', c); a.me = a; b = kinds.A('b', a); del a, c\n",
    # (No finalizer that is code of the program: only what the three writers lead to is looked at, and neither the namespace nor the list is among that.)
    'a program without a function: a writer with a name leads to two that know one another, the second of which knows the first writer': "import io, kinds\nsh = kinds.Sink(); sa = kinds.Sink(); sb = kinds.Sink(); h = io.BufferedWriter(sh); a = io.BufferedWriter(sa); b = io.BufferedWriter(sb); sh.next = a; sa.next = b; sb.back = a; sb.top = h; h.write(b'h '); a.write(b'a '); b.write(b'b '); del sh, sa, sb, a, b\n",
    'a program without a function: a writer in a list leads to two that know one another': "import io, kinds\nsh = kinds.Sink(); sa = kinds.Sink(); sb = kinds.Sink(); h = io.BufferedWriter(sh); a = io.BufferedWriter(sa); b = io.BufferedWriter(sb); sh.next = a; sa.next = b; sb.back = a; h.write(b'h '); a.write(b'a '); b.write(b'b '); l = [h]; del sh, sa, sb, a, b, h\n",
    # (One finalizer that is code of the program: only what the two lead to is looked at, and the list is not among that.)
    'a program without a function: a raw file and its writer in one list': "import io, kinds\nl = [kinds.Raw()]; l.append(io.BufferedWriter(l[0])); l[0].owner = l[1]; l[1].write(b'xyz')\n",
    # (CPython's collector is made to come once behind the imports, as in any program of some size.)
    'a program with a function, and modules with functions': "import kinds, m1, m2\nkeep = [[i] for i in range(3000)]\ndef f(): pass\nmine = kinds.A('main.holder', kinds.A('main.child'))\n",
    # Which module is the last in sys.modules is not to matter.
    'a program with a function, and three modules with functions': "import kinds, m1, m2, m3\nkeep = [[i] for i in range(3000)]\ndef f(): pass\nmine = kinds.A('main.holder', kinds.A('main.child'))\n",
    'a program with a function, and modules with functions, the first of which is put last': "import kinds, m1, m2\nsys.modules['m1'] = sys.modules.pop('m1')\nkeep = [[i] for i in range(3000)]\ndef f(): pass\nmine = kinds.A('main.holder', kinds.A('main.child'))\n",
    'a program with a function, and modules, the last of which has no function': "import kinds, m1, m2, without_function\nkeep = [[i] for i in range(3000)]\ndef f(): pass\nmine = kinds.A('main.holder', kinds.A('main.child'))\n",
    'a suspended generator in the last module': "import with_generator\ndef f(): pass\n",
}

with tempfile.TemporaryDirectory() as base:
    for module, text in { 'program': PROGRAM, 'kinds': KINDS, 'm1': CODE.replace('%s', 'm1'), 'm2': CODE.replace('%s', 'm2'), 'm3': CODE.replace('%s', 'm3'),
                          'without_function': "from kinds import A\nown = A('without_function')\n",
                          'with_generator': "import os\ndef generator():\n    try: yield 1\n    finally: os.write(1, b'the finally of the generator')\ng = generator(); next(g)\n" }.items():
        with open(os.path.join(base, module + '.py'), 'w') as file:
            file.write(text)
    commands = [(name, [os.path.join(base, 'program.py'), text]) for name, text in SCENES.items()]
    for number, (name, text) in enumerate(WITH_MODULES.items()):
        path = os.path.join(base, 'with_modules_%d.py' % number)
        with open(path, 'w') as file:
            file.write('import sys; sys.path.insert(0, %r)\n' % base + text)
        commands.append((name, [path]))
    for first in range(0, len(commands), 8):
        children = [(name, subprocess.Popen([sys.executable, '-I', '-B'] + command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)) for name, command in commands[first:first + 8]]
        for name, child in children:
            text = child.communicate()[0].decode()
            print('%s: status %d: %s' % (name, child.returncode, text.strip()))
