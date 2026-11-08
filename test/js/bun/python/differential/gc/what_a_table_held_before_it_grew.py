# A dict or a set grows: it goes on to a larger table, and the one that it leaves holds nothing. What has been taken out of the container since is finalized at the next
# collection, wherever the old table may still be found.
import gc

class C:
    def __init__(self, name): self.name = name
    def __del__(self): print('  finalized', self.name)

def attempt(what, source):
    print(what)
    exec(source, {'C': C, 'gc': gc})
    print('  exec() has returned')

# The namespace of the code itself.
attempt('imports', "c = C('c'); import json, decimal; del c; gc.collect(); print('  collected')")
attempt('assignments', "c = C('c'); a1 = a2 = a3 = a4 = a5 = a6 = 0; del c; gc.collect(); print('  collected')")
for count in (1, 2, 3, 5, 8, 13, 21, 34, 55, 200):
    names = ' = '.join('n%d' % i for i in range(count))
    attempt('%d names' % count, "c = C('c'); %s = 0; del c; gc.collect(); print('  collected')" % names)
attempt('a connection', '''
import sqlite3, warnings
c = sqlite3.connect(':memory:')
import os, decimal
warnings.simplefilter('always')
warnings.showwarning = lambda message, category, *rest: print('  warned', category.__name__)
del c
gc.collect()
print('  collected')
warnings.resetwarnings()
del warnings.showwarning
''')
print('a connection, in a namespace that begins empty')
exec('''
import sqlite3, os
c = sqlite3.connect(':memory:')
import gc, warnings
warnings.simplefilter('always')
warnings.showwarning = lambda *a, **k: print('  warned')
del c
gc.collect()
print('  collected')
warnings.resetwarnings()
del warnings.showwarning
''', dict())

# Containers of the program's.
attempt('a dict', "d = {'c': C('c')}\nfor i in range(20): d[i] = i\ndel d['c']; gc.collect(); print('  collected')")
attempt('a dict, the value replaced', "d = {'c': C('c')}\nfor i in range(20): d[i] = i\nd['c'] = None; gc.collect(); print('  collected')")
attempt('a dict, the key', "d = {C('c'): 1}\nfor i in range(20): d[i] = i\nfor k in list(d):\n    if isinstance(k, C): del d[k]\ndel k; gc.collect(); print('  collected')")
attempt('a dict that gets a key that is no str', "d = {'c': C('c'), 'e': 1}\nd[1.5] = 2\ndel d['c']; gc.collect(); print('  collected')")
attempt('the attributes of an instance', "class O: pass\no = O(); o.c = C('c'); vars(o)\nfor i in range(20): setattr(o, 'a%d' % i, i)\ndel o.c; gc.collect(); print('  collected')")
attempt('the attributes of a class', "class O: c = C('c')\nfor i in range(40): setattr(O, 'a%d' % i, i)\ndel O.c; gc.collect(); print('  collected')")
attempt('a set', "s = {C('c')}\nfor i in range(40): s.add(i)\nfor x in list(s):\n    if isinstance(x, C): s.discard(x)\ndel x; gc.collect(); print('  collected')")
attempt('a set that shrinks', "s = set(range(200)); s.add(C('c'))\nfor i in range(200): s.discard(i)\ns.update(range(3)); s |= {7}\nfor x in list(s):\n    if isinstance(x, C): s.discard(x)\ndel x; gc.collect(); print('  collected')")
attempt('a deque', "from collections import deque\nq = deque([C('c')])\nfor i in range(40): q.append(i)\nq.popleft(); gc.collect(); print('  collected')")

# What is still in the container is still there, in its order.
d = {}
s = set()
for i in range(3000):
    d[str(i)] = C
    d[i] = [i]
    s.add((i,))
    if not i % 500:
        gc.collect()
print(len(d), len(s), list(d)[:4], list(d)[-2:], sum(v[0] for k, v in d.items() if type(k) is int), sorted(s)[-1])

# The table that clear() leaves is another matter: that is how the container lets go of its items, one by one, at that point of the program.
first = {'p': C('p'), 's': None}
second = {'s': None, 'q': C('q')}
first['s'] = second['s'] = C('shared')
first.clear()
second.clear()
gc.collect()

# A container that has grown, many times over, lets go of its items in its own order when it goes.
class Noted:
    def __init__(self, name): self.name = name
    def __del__(self): noted.append(self.name)
for count in (8, 9, 20, 100, 1000):
    noted = []
    d = {}
    for i in range(count):
        d[i] = Noted(i)
    del d
    gc.collect()
    print(count, noted == list(range(count)), noted[:5])
    noted = []
    s = set()
    for i in range(count):
        s.add(Noted(i))
    order = [item.name for item in s]
    del s
    gc.collect()
    print(count, 'set', noted == order)
