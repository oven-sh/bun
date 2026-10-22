#!/usr/bin/env python3
"""pairs-table.py <prefix of the stepper's output> <map of the image (F T C U rows)> <output prefix> [most instructions between, default 4]
From an exact trace of a server's main thread (steps-with-doors.c): calls of stubs out of ONE compiled function, in ONE frame, that follow one another with few instructions between.
A request = the mean of the windows. For every pair: how the second hangs on the first, read from the registers at the borders of the stubs:
   result>receiver   the first's result is the object the second reads, stores to, calls a method of
   result>operand    the first's result is another operand of the second (what is asked, compared, the key, the value stored, the callee, an argument)
   one receiver      both work on the same object
   apart             none of these
<out>.families.txt  pairs and triples by family and relation: count, instructions in the first | between | in the second, how many of both stayed in the stub they entered ("plain")
<out>.stubs.txt     pairs by the stubs' names
<out>.sites.txt     where the commonest kinds stand: function + offset
<out>.runs.txt      runs of reads of one receiver by length"""
import sys, struct, bisect, collections, re
prefix, image_map, out = sys.argv[1:4]
most = int(sys.argv[4]) if len(sys.argv) > 4 else 4
data = open(prefix + '.ips', 'rb').read()
ips = struct.unpack('<%dQ' % (len(data) // 8), data)
pages = {}
raw = open(prefix + '.pages', 'rb').read()
for i in range(0, len(raw), 4104):
    pages[struct.unpack_from('<Q', raw, i)[0]] = raw[i + 8:i + 4104]
def byte_at(a):
    p = pages.get(a & ~4095)
    return p[a & 4095] if p else 0
def bytes_at(a, n): return bytes(byte_at(a + i) for i in range(n))

T, F, C, U = [], [], [], []
for l in open(image_map, errors='replace'):
    f = l.rstrip('\n').split('\t')
    if f[0] == 'T': T.append((int(f[1]), f[2]))
    elif f[0] == 'C': C.append(int(f[1]))
    elif f[0] == 'F': F.append((int(f[2]), int(f[3]), (f[7] if len(f) > 7 else '?') + ' @' + f[4] + ':' + f[5]))
    elif f[0] == 'U': U.append((int(f[1]), int(f[2]), 'outlined of ' + f[3]))
T.sort(); F = sorted(F + U); C = sorted(C) or [0]
tstarts = [t[0] for t in T]; fstarts = [f[0] for f in F]
first = None
for l in open(prefix + '.perfmap', errors='replace'):
    w = l.split(None, 2)
    if len(w) == 3 and (w[2].startswith('(stubs of compiled code)') or w[2].startswith('stub ')):
        a = int(w[0], 16); first = a if first is None else min(first, a)
base = first - C[0]
end_of_code = max([f[0] + f[1] for f in F] or [0])
for c in C: end_of_code = max(end_of_code, c + T[-1][0] + 4096)
copy_ends = []
for i, c in enumerate(C):
    k = bisect.bisect_right(fstarts, c); copy_ends.append(F[k][0] if k < len(F) else c + T[-1][0] + 65536)
def where(ip):
    o = ip - base
    if o < 0 or o >= end_of_code: return ('native', '', 0)
    k = bisect.bisect_right(C, o) - 1
    if k >= 0 and o < copy_ends[k]:
        r = o - C[k]; j = bisect.bisect_right(tstarts, r) - 1
        if j >= 0: return ('function' if T[j][1].startswith('outlined') else 'stub', T[j][1], r - T[j][0])
    j = bisect.bisect_right(fstarts, o) - 1
    if j >= 0 and o < F[j][0] + F[j][1] + 64: return ('function', F[j][2], o - F[j][0])
    return ('function', '?', 0)
cache = {}
def W(ip):
    w = cache.get(ip)
    if w is None: w = cache[ip] = where(ip)
    return w
PREFIX = {0x2e, 0x3e, 0x66, 0xf2, 0xf3, 0x36, 0x26, 0x64, 0x65}
kinds = {}
def branch(a):
    k = kinds.get(a, 0)
    if k != 0: return k
    i = a
    while byte_at(i) in PREFIX: i += 1
    if 0x40 <= byte_at(i) <= 0x4f: i += 1
    b = byte_at(i); r = None
    if b == 0xeb: r = ('jmp', i + 2 - a)
    elif b == 0xe9: r = ('jmp', i + 5 - a)
    elif b == 0xe8: r = ('call', i + 5 - a)
    elif 0x70 <= b <= 0x7f or b == 0xe3: r = ('jcc', i + 2 - a)
    elif b == 0x0f and 0x80 <= byte_at(i + 1) <= 0x8f: r = ('jcc', i + 6 - a)
    elif b in (0xc3, 0xc2): r = ('ret', 1)
    kinds[a] = r
    return r

NAMES = ['rax', 'rcx', 'rdx', 'rbx', 'rsp', 'rbp', 'rsi', 'rdi', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15', 'flags']
crossings = {}
raw = open(prefix + '.registers', 'rb').read()
for i in range(0, len(raw), 160):
    r = struct.unpack_from('<20Q', raw, i)
    crossings[r[0]] = r

def fold(s):
    """a stub's name is Family[.Form][.n<count>][.Frameless | .StubFrame][.TwoIntegers][(%<register>)][#<immediate>]: dump(PrintStream&, StubKey)"""
    s = re.sub(r'\.n\d+', '.nN', s); s = re.sub(r'#\d+', '#N', s); s = re.sub(r' with arguments$', '', s)
    return s
def family(s):
    """by the names of AOTStubFamilies.def; a stub that only calls a run-time operation ("CallOperation.Value to operationAOTGetById") by the operation's name"""
    s = re.sub(r'^\w*CallOperation\S* to (operation(AOT)?|Raw)?', '', s)
    if re.match(r'GetLength', s): return 'read .length'
    if re.match(r'(Get|Read|TryGet)\w*ById', s): return 'read x.a'
    if re.match(r'((Put|Add|Replace)\w*ById|DefineField|DefineById)', s): return 'store x.a = v'
    if re.match(r'CallMethod', s): return 'call x.a(..)'
    if re.match(r'FindMethod', s): return 'find method'
    if re.match(r'(GetByVal|LoadElement|ElementOrEmpty|ReadBatchedElements|ArrayGet)', s): return 'read x[k]'
    if re.match(r'(PutByVal|DefineByVal|Store\w*Element|ArrayPut)', s): return 'store x[k] = v'
    if re.match(r'(InBy|Has[A-Z])', s): return 'in | has'
    if re.match(r'(Call\b|Call[A-Z]|Construct|SuperConstruct|TailCall|ResolveCallValue|Apply)', s): return 'call f(..)'
    if re.match(r'(StringConstant|NewStringConstant|BuiltinCell)', s): return 'constant'
    if re.match(r'(New|Allocate|ArrayLiteral|Create|Copy|Clone)', s): return 'allocate'
    if re.match(r'ValueIsTruthy|ToBoolean', s): return 'is truthy'
    if re.match(r'(Equal|ValueEqualsLiteral|LooseEqualsLiteral|StringEqualsLiteral|StringsAreEqual|FlatStringsAreEqual|CompareEq|CompareStrictEq)', s): return '=== | =='
    if re.match(r'TypeOf', s): return 'typeof'
    if re.match(r'InstanceOf', s): return 'instanceof'
    if re.match(r'(Binary|Value[A-Z]|Compare|(Add|Sub|Mul|Div)Number|AddStrings|BitNot|Increment|Decrement|To[A-Z]|Concat)', s): return 'arithmetic | compare | convert'
    if re.match(r'(Await|Async|StepGenerator|StartAsyncGenerator|SaveFrame|Resume|Promise|Suspend|Enter|Return)', s): return 'async | frames'
    return 'other'
def receiver_register(s, fam):
    if fam in ('constant', 'allocate', 'async | frames', 'other', 'call f(..)'): return None
    m = re.search(r'\(%(\w+)\)', s)
    return m.group(1) if m else 'rax'
OTHER = ['rax', 'rdi', 'rsi', 'rdx', 'rcx', 'r8']
def reg(r, name): return r[3 + NAMES.index(name)]
def is_cell(v): return v >= 0x10000 and not (v & 0xfffe000000000002)

windows = []; cur = []; number = 0; begun = 0
for ip in ips:
    if ip:
        if not cur: begun = number
        cur.append(ip); number += 1
    else:
        if cur: windows.append((begun, cur))
        cur = []
if cur: windows.append((begun, cur))
windows = [w for w in windows if len(w[1]) * 10 > max(len(x[1]) for x in windows)]
n = len(windows)

class Visit: pass
all_visits = 0
P2 = collections.defaultdict(lambda: [0, 0, 0, 0, 0, 0])   # count, in first, between, in second, both plain, with a jcc between
P2names = collections.Counter(); P2roads = collections.defaultdict(collections.Counter); P2sites = collections.defaultdict(collections.Counter)
P3 = collections.defaultdict(lambda: [0, 0])
runs = collections.Counter(); run_sites = collections.defaultdict(collections.Counter)
by_family = collections.defaultdict(lambda: [0, 0])
def relation(a, b):
    ra = receiver_register(a.folded, a.family); rb = receiver_register(b.folded, b.family)
    if a.result is not None and a.family not in ('is truthy', 'store x.a = v', 'store x[k] = v'):
        if rb and reg(b.registers, rb) == a.result: return 'result>receiver' if b.family in ('read x.a', 'read .length', 'store x.a = v', 'call x.a(..)', 'find method', 'read x[k]', 'store x[k] = v') else 'result>operand'
        if b.family != 'constant' and (not re.search(r'\(%\w+\)', b.folded) or b.family.startswith('store')):
            for o in OTHER:
                if o != rb and (o != 'rax' or rb is None) and reg(b.registers, o) == a.result and (is_cell(a.result) or o != 'rax'): return 'result>operand'
    if ra and rb and reg(a.registers, ra) == reg(b.registers, rb) and is_cell(reg(a.registers, ra)): return 'one receiver'
    return 'apart'
READS = ('read x.a', 'read .length')
def close_run(v):
    if v is not None and v.run > 1: runs[v.run] += 1; run_sites[v.run][v.site[0]] += 1
for begun, w in windows:
    stack = []; last_closed = None
    prevk = None; prev = None
    for i, ip in enumerate(w):
        k = W(ip)
        if stack:
            top = stack[-1]
            if ip == top.back or (len(stack) > 1 and (branch(prev) or ('',))[0] == 'ret' and any(x.back == ip for x in stack)):
                while stack[-1].back != ip: stack.pop()
                v = stack.pop()
                v.returned = i; r = crossings.get(begun + i); v.result = reg(r, 'rax') if r and r[2] == ip else None
                v.cost = v.returned - v.entered
                all_visits += 1; by_family[v.family][0] += 1; by_family[v.family][1] += v.cost
                if v.before is not None:
                    a = v.before; key = (a.family, v.family, v.relation); e = P2[key]
                    e[0] += 1; e[1] += a.cost; e[2] += v.between; e[3] += v.cost; e[4] += a.plain and v.plain; e[5] += v.jcc
                    P2roads[key][(' > '.join(a.road[1:]) or 'plain', ' > '.join(v.road[1:]) or 'plain')] += 1
                    P2names[(a.folded, v.folded, v.relation)] += 1; P2sites[key][(a.site[0], a.site[1], v.site[1])] += 1
                    if a.before is not None:
                        z = a.before; e = P3[(z.family, a.relation, a.family, v.relation, v.family)]; e[0] += 1; e[1] += z.cost + a.cost + v.cost + a.between + v.between
                        a.before = None
                last_closed = v
            elif k[0] != 'stub' or k[1] != top.name:
                top.plain = False
                step_name = fold(k[1]) if k[0] == 'stub' else k[0]
                if len(top.road) < 6 and top.road[-1] != step_name: top.road.append(step_name)
        if k[0] == 'stub' and prevk is not None and prevk[0] == 'function':
            b = branch(prev)
            r = crossings.get(begun + i)
            if b and b[0] == 'call' and r:
                v = Visit(); v.name = k[1]; v.folded = fold(k[1]); v.family = family(v.folded); v.site = (prevk[1], prevk[2]); v.entered = i; v.back = prev + b[1]; v.registers = r
                v.plain = True; v.road = ['']; v.result = None; v.returned = None; v.before = None; v.run = 1; v.relation = None
                a = last_closed
                if a is not None and a.site[0] == v.site[0] and reg(a.registers, 'rsp') == reg(r, 'rsp') and 0 <= i - 1 - a.returned <= most:
                    v.before = a; v.between = i - 1 - a.returned; v.relation = relation(a, v)
                    v.jcc = any((branch(w[x]) or ('',))[0] == 'jcc' for x in range(a.returned, i - 1))
                    if v.relation == 'one receiver' and a.family in READS and v.family in READS: v.run = a.run + 1; a.run = 0
                stack.append(v)
                if a is not None and v.run == 1: close_run(a)
        prev = ip; prevk = k

o = open(out + '.families.txt', 'w')
P = lambda *a: print(*a, file=o)
P('%d windows: %s instructions; calls of stubs out of compiled functions: %.1f a request' % (n, ' . '.join('{:,}'.format(len(x[1])) for x in windows), all_visits / n))
P('-- CALLS BY FAMILY: a request | instructions until the call is back (the call and the return are not counted; what a called function runs is)')
for f_, (c, s) in sorted(by_family.items(), key=lambda x: -x[1][0]): P('   %9.1f %7.1f  %s' % (c / n, s / c, f_))
total = sum(e[0] for e in P2.values())
P('-- PAIRS: the second call follows the first in the same function and frame with at most %d instructions between: %.1f a request' % (most, total / n))
P('   a request | instructions in the first | between | in the second | both plain %% | a conditional jump between %% | first -> second (relation)')
for key, e in sorted(P2.items(), key=lambda x: -x[1][0]):
    if e[0] / n < 3: continue
    P('   %8.1f %7.1f %5.1f %7.1f %5.0f%% %5.0f%%   %s -> %s   (%s)' % (e[0] / n, e[1] / e[0], e[2] / e[0], e[3] / e[0], 100 * e[4] / e[0], 100 * e[5] / e[0], key[0], key[1], key[2]))
P('-- BY RELATION')
rel = collections.Counter()
for key, e in P2.items(): rel[key[2]] += e[0]
for r_, c in rel.most_common(): P('   %8.1f  %s' % (c / n, r_))
P('-- TRIPLES: a request | instructions in all three and between')
for key, e in sorted(P3.items(), key=lambda x: -x[1][0])[:60]:
    P('   %8.1f %7.1f   %s -(%s)-> %s -(%s)-> %s' % (e[0] / n, e[1] / e[0], key[0], key[1], key[2], key[3], key[4]))
o.close()
o = open(out + '.stubs.txt', 'w')
for (a, b, r_), c in P2names.most_common(200): P('   %8.1f  %s -> %s   (%s)' % (c / n, a, b, r_))
o.close()
o = open(out + '.sites.txt', 'w')
for key, e in sorted(P2.items(), key=lambda x: -x[1][0])[:24]:
    P('==== %.1f a request: %s -> %s (%s): %d sites' % (e[0] / n, key[0], key[1], key[2], len(P2sites[key])))
    for (fn, x, y), c in P2sites[key].most_common(25): P('   %8.1f  %s +%#x +%#x' % (c / n, fn[:150], x, y))
o.close()
o = open(out + '.roads.txt', 'w')
for key, e in sorted(P2.items(), key=lambda x: -x[1][0])[:14]:
    P('==== %.1f a request: %s -> %s (%s): the roads behind the stub that is entered: first | second' % (e[0] / n, key[0], key[1], key[2]))
    for (x, y), c in P2roads[key].most_common(16): P('   %8.1f  %s   |   %s' % (c / n, x, y))
o.close()
o = open(out + '.runs.txt', 'w')
P('runs of reads by name of one receiver, each at most %d instructions behind the one before: by length: runs a request' % most)
for l_, c in sorted(runs.items()):
    P('   %3d reads: %8.1f' % (l_, c / n))
    for fn, q in run_sites[l_].most_common(8): P('              %8.1f  %s' % (q / n, fn[:150]))
o.close()
