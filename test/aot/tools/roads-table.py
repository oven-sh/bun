#!/usr/bin/env python3
"""roads-table.py <prefix of the stepper's output> <map of the image (F T C U rows)> <output prefix>
From an exact trace (steps-with-doors.c): EVERY CALL OF A STUB OUT OF A COMPILED FUNCTION, BY THE ROAD IT TOOK: the row of stubs it went through until it was back.
What is booked on a call: the instructions in stubs and in native code that ran for it (what a compiled function that it entered ran is that function's own; stub calls out of that function are calls of their own),
and the instructions AT THE SITE: the call itself and the moves of constants and registers right ahead of it (back to the last instruction that is neither `mov r, r`, `mov r32, imm32` nor `lea`), at most four.
<out>.families.txt   by family: calls, instructions in stubs | native | at the site; the share of all instructions of the request
<out>.roads.txt      by family and road: calls, instructions a call, the sum, running share
<out>.listing.txt    for the commonest roads: every instruction in the order it ran (bytes, for a disassembler: see a disassembler)"""
import sys, struct, bisect, collections, re
prefix, image_map, out = sys.argv[1:4]
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
def kind_of(a):
    """call | ret | move (mov r, r . mov r32, imm32 . lea) | other; and for a call its length"""
    k = kinds.get(a)
    if k is not None: return k
    i = a
    while byte_at(i) in PREFIX: i += 1
    if 0x40 <= byte_at(i) <= 0x4f: i += 1
    b = byte_at(i); r = ('other', 0)
    if b == 0xe8: r = ('call', i + 5 - a)
    elif b in (0xc3, 0xc2): r = ('ret', 1)
    elif b in (0x89, 0x8b) and byte_at(i + 1) >= 0xc0: r = ('move', 0)
    elif 0xb8 <= b <= 0xbf: r = ('move', 0)
    elif b == 0x8d: r = ('move', 0)
    kinds[a] = r
    return r
def fold(s):
    """a stub's name is Family[.Form][.n<count>][.Frameless | .StubFrame][.TwoIntegers][(%<register>)][#<immediate>]: dump(PrintStream&, StubKey)"""
    s = re.sub(r'\.n\d+', '.nN', s); s = re.sub(r'#\d+', '#N', s); s = re.sub(r' with arguments$', '', s)
    s = re.sub(r'\(%\w+\)', '', s)
    return s
def family(s):
    """by the names of AOTStubFamilies.def; a stub that only calls a run-time operation ("CallOperation.Value to operationAOTGetById") by the operation's name"""
    s = re.sub(r'^\w*CallOperation\S* to (operation(AOT)?|Raw)?', '', s)
    if re.match(r'GetLength', s): return 'read .length'
    if re.match(r'(Get|Read|TryGet)\w*ById', s): return 'read x.a'
    if re.match(r'((Put|Add|Replace)\w*ById|DefineField|DefineById|DefineOwn)', s): return 'store x.a = v'
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
windows = []; cur = []
for ip in ips:
    if ip: cur.append(ip)
    else:
        if cur: windows.append(cur)
        cur = []
if cur: windows.append(cur)
windows = [w for w in windows if len(w) * 10 > max(len(x) for x in windows)]
n = len(windows)
total = sum(len(w) for w in windows)
by_kind = collections.Counter()
class Visit: pass
R = collections.defaultdict(lambda: [0, 0, 0, 0])      # (family, road): calls, stub, native, site
example = {}
unbooked = collections.Counter()
for w in windows:
    stack = []
    prevk = None; prev = None
    for i, ip in enumerate(w):
        k = W(ip); by_kind[k[0]] += 1
        if stack and (ip == stack[-1].back or (len(stack) > 1 and kind_of(prev)[0] == 'ret' and any(x.back == ip for x in stack))):
            while stack[-1].back != ip: stack.pop()
            v = stack.pop()
            key = (v.family, ' > '.join(v.road))
            e = R[key]; e[0] += 1; e[1] += v.stub; e[2] += v.native; e[3] += v.site
            if key not in example and not v.left: example[key] = v.steps
        if k[0] == 'stub' and prevk is not None and prevk[0] == 'function' and kind_of(prev)[0] == 'call':
            v = Visit(); v.family = family(fold(k[1])); v.road = []; v.back = prev + kind_of(prev)[1]; v.stub = 0; v.native = 0; v.steps = []; v.left = False
            v.site = 1; j = i - 2
            while j >= 0 and v.site < 5 and W(w[j])[0] == 'function' and kind_of(w[j])[0] == 'move': v.site += 1; j -= 1
            stack.append(v)
        if stack and k[0] != 'function':
            v = stack[-1]
            if k[0] == 'stub':
                v.stub += 1; name = fold(k[1])
                if len(v.steps) < 120: v.steps.append(ip)
            else:
                v.native += 1; name = 'C++'; v.left = True
            if (not v.road or v.road[-1] != name) and len(v.road) < 7: v.road.append(name)
        elif stack and k[0] == 'function':
            v = stack[-1]; v.left = True
            if v.road and v.road[-1] != '(a function)' and len(v.road) < 7: v.road.append('(a function)')
        elif k[0] != 'function': unbooked[k[0]] += 1
        prev = ip; prevk = k
o = open(out + '.families.txt', 'w')
P = lambda *a: print(*a, file=o)
P('%d windows; a request: %s instructions: %s' % (n, '{:,.0f}'.format(total / n), ' . '.join('%s %s' % (k, '{:,.0f}'.format(v / n)) for k, v in by_kind.most_common())))
P('not booked on any call of a stub out of a function: ' + ' . '.join('%s %s' % (k, '{:,.0f}'.format(v / n)) for k, v in unbooked.items()))
Fm = collections.defaultdict(lambda: [0, 0, 0, 0])
for (f_, r_), e in R.items():
    for j in range(4): Fm[f_][j] += e[j]
P('%-32s %10s %10s %10s %10s %10s %8s %8s' % ('family', 'calls', 'in stubs', 'in C++', 'at sites', 'sum', 'a call', '% of all'))
for f_, e in sorted(Fm.items(), key=lambda x: -(x[1][1] + x[1][2] + x[1][3])):
    s = e[1] + e[2] + e[3]
    P('%-32s %10.1f %10.0f %10.0f %10.0f %10.0f %8.1f %7.2f%%' % (f_, e[0] / n, e[1] / n, e[2] / n, e[3] / n, s / n, s / e[0], 100 * s / total))
e = [sum(x[j] for x in Fm.values()) for j in range(4)]; s = e[1] + e[2] + e[3]
P('%-32s %10.1f %10.0f %10.0f %10.0f %10.0f %8.1f %7.2f%%' % ('ALL', e[0] / n, e[1] / n, e[2] / n, e[3] / n, s / n, s / e[0], 100 * s / total))
o.close()
o = open(out + '.roads.txt', 'w')
for f_, fe in sorted(Fm.items(), key=lambda x: -(x[1][1] + x[1][2] + x[1][3])):
    fs = fe[1] + fe[2] + fe[3]
    P('==== %s: %.1f calls a request, %.0f instructions (%.2f%% of the request)' % (f_, fe[0] / n, fs / n, 100 * fs / total))
    P('   %9s %7s %7s %6s %9s %6s  road' % ('calls', 'stubs', 'C++', 'site', 'sum', 'run %'))
    run = 0
    for (g, r_), e in sorted(((k, v) for k, v in R.items() if k[0] == f_), key=lambda x: -(x[1][1] + x[1][2] + x[1][3]))[:28]:
        s = e[1] + e[2] + e[3]; run += s
        P('   %9.1f %7.1f %7.1f %6.1f %9.0f %5.0f%%  %s' % (e[0] / n, e[1] / e[0], e[2] / e[0], e[3] / e[0], s / n, 100 * run / fs, r_[:170]))
o.close()
o = open(out + '.listing.txt', 'w')
for key, e in sorted(R.items(), key=lambda x: -x[1][0])[:60]:
    if key not in example: continue
    P('==== %.1f calls a request . %s . %s . %.1f instructions in stubs' % (e[0] / n, key[0], key[1], e[1] / e[0]))
    steps = example[key]
    for j, ip in enumerate(steps):
        length = steps[j + 1] - ip if j + 1 < len(steps) and 0 < steps[j + 1] - ip <= 15 else 15
        k = W(ip)
        P('I\t%s+%#x\t%s\t%d' % (fold(k[1]), k[2], bytes_at(ip, 15).hex(), length if length < 15 else 0))
o.close()
