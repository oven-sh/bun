#!/usr/bin/env python3
"""name_sample.py <the output of /usr/bin/sample> <the executable file> [command]: macOS shows all compiled code of an executable built with `bun build --compile --aot` under one symbol, BUN_COMPILED.
This gives every such frame its function, the file:line:column of the call site and the frames inlined there (code_in_image.py beside this file reads the image's own tables). It only reads the two files and runs nothing.
  tree [part of a thread's name = main-thread] [least count = 3]   the call graph again, named
  top [thread]                                                      self and inclusive counts by function
  own [thread]                                                      every busy sample goes to the innermost compiled function on its stack, split by what the leaf is: native | stub | compiled | regular (expression)
  under <regular expression of a native symbol> [thread]            who calls it: the compiled frames above each hit, innermost first
  pages [thread]                                                    distinct addresses, functions and pages of the samples in compiled code; distances from caller to callee
`sample` joins the leaves of one symbol ("+ 196926024,198472520,..."): such a count goes to the first address."""
import collections, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from code_in_image import Image

LINE = re.compile(r'^([ +!:|]*?)(\d+) (.*?)(?:  \(in ([^)]*)\))?(?: \+ ([\d,.]+))?(?:  \[(0x[0-9a-f,x.]+)\])?\s*$')

class Node:
    __slots__ = ('count', 'symbol', 'lib', 'address', 'children', 'parent', 'frames', 'kind', 'code')
    def __init__(s, count, symbol, lib, address, parent): s.count = count; s.symbol = symbol; s.lib = lib; s.address = address; s.children = []; s.parent = parent; s.frames = None; s.kind = 'native'; s.code = None
    def self_count(s): return s.count - sum(c.count for c in s.children)

def parse(path):
    threads = []; stack = []; on = False
    for raw in open(path, errors='replace'):
        line = raw.rstrip('\n')
        if line.startswith('Call graph:'): on = True; continue
        if not on: continue
        if line.startswith('Total number in stack') or line.startswith('Sort by top of stack') or line.startswith('Binary Images'): break
        if not line.strip(): continue
        m = LINE.match(line)
        if not m: continue
        depth = len(m.group(1)); a = m.group(6); a = int(a.split(',')[0], 16) if a else None
        while stack and stack[-1][0] >= depth: stack.pop()
        parent = stack[-1][1] if stack else None; n = Node(int(m.group(2)), m.group(3).strip(), m.group(4), a, parent)
        (parent.children if parent else threads).append(n); stack.append((depth, n))
    return threads

def short(p): return p.replace('/$bunfs/root/', '')

def name_all(threads, im, code_base):
    def walk(n, is_leaf_possible=True):
        if n.symbol == 'BUN_COMPILED' and n.address is not None:
            o = n.address - code_base; n.code = o; f = im.function_at(o) if 0 <= o else None
            if f and not im.region(o).startswith('shared'):
                n.kind = 'compiled'; n.frames = im.stack_at(f[0], o - f[1])
                n.symbol = ' < '.join('%s %s:%d:%d%s' % (x[0] or '(anonymous)', short(x[1]), x[2], x[3], x[4]) for x in n.frames)
            elif 0 <= o < im.code_size:
                r = im.region(o); n.kind = 'stub' if r.startswith('shared') else r.split()[0]; n.symbol = '[' + (im.stub_at(o) if n.kind == 'stub' else r) + ']'
        for c in n.children: walk(c)
    for t in threads: walk(t)

def pick(threads, sub): return [t for t in threads if sub in t.symbol]

def demangle(s):
    s = re.sub(r'\(.*', '', s) if not s.startswith('[') and ' < ' not in s and ':' in s and '::' in s else s
    m = re.match(r'_RNv.*?(\d+)([a-z_0-9]+)$', s)
    return s

def function_key(n):
    if n.kind == 'compiled': x = n.frames[-1]; return '%s %s' % (x[0] or '(anonymous)', short(x[1]))
    return n.symbol

def main():
    sample, exe = sys.argv[1:3]; cmd = sys.argv[3] if len(sys.argv) > 3 else 'top'; args = sys.argv[4:]
    im = Image(exe); threads = parse(sample)
    base = None
    for raw in open(sample, errors='replace'):
        m = re.search(r'BUN_COMPILED  \(in [^)]*\) \+ (\d+)  \[(0x[0-9a-f]+)\]', raw)
        if m: base = int(m.group(2), 16) - int(m.group(1)); break
    # BUN_COMPILED is the first byte of the section __BUN,__bun, which holds the image behind a head of its own.
    import struct
    sect = None; m = im.m; count = struct.unpack_from('<I', m, 16)[0]; at = 32
    for _ in range(count):
        command, size = struct.unpack_from('<II', m, at)
        if command == 0x19:
            for k in range(struct.unpack_from('<I', m, at + 64)[0]):
                s = at + 72 + 80 * k
                if m[s:s + 16].rstrip(b'\0') == b'__bun': sect = struct.unpack_from('<I', m, s + 48)[0]
        at += size
    if sect is None: raise SystemExit('no section __bun in ' + exe)
    code_base = base + (im.base - sect) + im.code_offset
    name_all(threads, im, code_base)
    if cmd == 'tree':
        sub = args[0] if args else 'main-thread'; least = int(args[1]) if len(args) > 1 else 3
        def show(n, d):
            if n.count < least: return
            s = n.self_count(); print('%s%d%s %s' % (' ' * d, n.count, (' (self %d)' % s) if s and n.children else '', n.symbol[:400]))
            for c in sorted(n.children, key=lambda c: -c.count): show(c, d + 1)
        for t in pick(threads, sub): show(t, 0)
    elif cmd == 'top':
        sub = args[0] if args else 'main-thread'; selfs = collections.Counter(); incl = collections.Counter(); inner = collections.Counter()
        def walk(n, seen):
            k = function_key(n); s = n.self_count(); selfs[k] += s
            if n.kind == 'compiled' and s: x = n.frames[0]; inner['%s %s:%d' % (x[0] or '(anonymous)', short(x[1]), x[2])] += s
            new = k not in seen
            if new: incl[k] += n.count; seen = seen | {k}
            for c in n.children: walk(c, seen)
        for t in pick(threads, sub): walk(t, frozenset())
        print('== self'); [print('%5d  %s' % (v, k[:200])) for k, v in selfs.most_common(60) if v]
        print('== self of compiled code by the innermost inlined frame and line'); [print('%5d  %s' % (v, k[:200])) for k, v in inner.most_common(40)]
        print('== inclusive'); [print('%5d  %s' % (v, k[:200])) for k, v in incl.most_common(120)]
    elif cmd == 'own':
        # every busy sample goes to the innermost compiled function on its stack (what it calls in the engine, the stubs and the system counts as its own), and is split by what the leaf is
        sub = args[0] if args else 'main-thread'; own = collections.Counter(); leafkind = collections.Counter(); split = collections.defaultdict(collections.Counter)
        def walk(n, holder):
            if n.kind == 'compiled': x = n.frames[0]; holder = '%s %s' % (x[0] or '(anonymous)', short(x[1]))
            s = n.self_count()
            if s and n.symbol != 'kevent64':
                own[holder] += s; k = n.kind if n.kind != 'native' else 'native'; leafkind[k] += s; split[holder][n.symbol.split('(')[0][:60] if n.kind == 'native' else n.kind] += s
            for c in n.children: walk(c, holder)
        for t in pick(threads, sub): walk(t, '(no compiled frame)')
        print('busy samples %d; the leaf is: %s' % (sum(own.values()), dict(leafkind)))
        for k, v in own.most_common(45): print('%5d  %-90s %s' % (v, k[:90], ', '.join('%s %d' % kv for kv in split[k].most_common(4))))
    elif cmd == 'under':
        rx = re.compile(args[0]); sub = args[1] if len(args) > 1 else 'main-thread'; hits = collections.Counter()
        def walk(n):
            if rx.search(n.symbol):
                up = []; p = n.parent
                while p is not None and len(up) < 4:
                    if p.kind == 'compiled': up.append(p.symbol)
                    p = p.parent
                hits[(n.symbol.split('(')[0], '\n          '.join(up))] += n.count; return
            for c in n.children: walk(c)
        for t in pick(threads, sub): walk(t)
        for (s, up), v in hits.most_common(): print('%5d %s\n          %s' % (v, s, up))
    elif cmd == 'pages':
        sub = args[0] if args else 'main-thread'; addresses = collections.Counter(); kinds = collections.Counter(); edges = collections.Counter()
        def walk(n):
            s = n.self_count()
            if n.code is not None and s: addresses[n.code] += s; kinds[n.kind] += s
            for c in n.children:
                if n.code is not None and c.code is not None: edges[(n.code, c.code, n.kind, c.kind)] += c.count
                walk(c)
        for t in pick(threads, sub): walk(t)
        print('self samples in the image\'s code: %d on %d addresses; by kind %s' % (sum(addresses.values()), len(addresses), dict(kinds)))
        fns = {im.function_at(a)[0] for a in addresses if im.function_at(a) and not im.region(a).startswith('shared')}
        print('functions %d | 64 B lines %d | 4 KB pages %d | 16 KB pages %d | 2 MB %d' % (len(fns), len({a >> 6 for a in addresses}), len({a >> 12 for a in addresses}), len({a >> 14 for a in addresses}), len({a >> 21 for a in addresses})))
        every = set()
        def all_codes(n):
            if n.code is not None: every.add(n.code)
            for c in n.children: all_codes(c)
        for t in pick(threads, sub): all_codes(t)
        print('every compiled address on any stack (self or return): %d | functions %d | 4 KB %d | 16 KB %d | 2 MB %d' % (len(every), len({im.function_at(a)[0] for a in every if im.function_at(a) and not im.region(a).startswith('shared')}), len({a >> 12 for a in every}), len({a >> 14 for a in every}), len({a >> 21 for a in every})))
        d = sorted(abs(a - b) for (a, b, ka, kb) in edges if ka == 'compiled' and kb == 'compiled')
        if d: print('caller to callee, function to function, %d distinct edges: median %d KB | quarter %d KB | three quarters %d KB | within 16 KB %d | within 1 MB %d | over 32 MB %d' % (len(d), d[len(d) // 2] >> 10, d[len(d) // 4] >> 10, d[3 * len(d) // 4] >> 10, sum(x < 16384 for x in d), sum(x < 1 << 20 for x in d), sum(x > 32 << 20 for x in d)))
        d = sorted(abs(a - b) for (a, b, ka, kb) in edges if 'stub' in (ka, kb) and ka != kb)
        if d: print('function to shared code or back, %d distinct edges: median %d MB' % (len(d), d[len(d) // 2] >> 20))
if __name__ == '__main__': main()
