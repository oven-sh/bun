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
}
KINDS = "import sys\nclass A:\n    def __init__(self, n, *holds): self.n = n; self.holds = holds\n    def __del__(self): sys.__stdout__.write(self.n + ' ')\n"
CODE = "from kinds import A\ndef f(): pass\nown = A('%s')\n"
WITH_MODULES = {
    # The namespace of a program without a function is no cycle: it goes by reference counts, and what it held is where a cycle is entered.
    'a program without a function: a cycle entered at the holder': "import kinds\nc = kinds.A('child'); h = kinds.A('holder', c); c.back = h; del c\n",
    'a program without a function: the child in a cycle has a name': "import kinds\nc = kinds.A('child'); h = kinds.A('holder', c); c.back = h\n",
    'a program without a function: what hangs off a cycle': "import kinds\nh = kinds.A('holder', kinds.A('child')); h.me = h\n",
    # (CPython's collector is made to come once behind the imports, as in any program of some size.)
    'a program with a function, and modules with functions': "import kinds, m1, m2\nkeep = [[i] for i in range(3000)]\ndef f(): pass\nmine = kinds.A('main.holder', kinds.A('main.child'))\n",
}

with tempfile.TemporaryDirectory() as base:
    for module, text in { 'program': PROGRAM, 'kinds': KINDS, 'm1': CODE.replace('%s', 'm1'), 'm2': CODE.replace('%s', 'm2') }.items():
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
