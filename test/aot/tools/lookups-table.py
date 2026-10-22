#!/usr/bin/env python3
"""lookups-table.py <prefix of the stepper's output> <map of the image (F T C U I rows)> <output prefix> <the executable or the Bun with its symbols>
From an exact trace with .doors (steps-with-doors.c): EVERY TIME A STUB GOES INTO NATIVE CODE: through which function, for which stub call of which compiled function, with what operands, and what it cost until it was back.
A server that has been warmed should look nothing up in C++ twice: a door that is gone through for the same (receiver's structure, name) in every window HAS FAILED TO LEARN.
<out>.doors.txt     by native function entered: visits a request, instructions until back (native | all)
<out>.lookups.txt   the doors that look a property up: by kind of receiver, name and the stub that was called: visits, instructions, in how many windows, the native functions it went through
<out>.causes.txt    the same summed by kind of receiver and by the row of native functions"""
import sys, struct, bisect, collections, re, subprocess, os
prefix, image_map, out, executable = sys.argv[1:5]
data = open(prefix + '.ips', 'rb').read()
ips = struct.unpack('<%dQ' % (len(data) // 8), data)
pages = {}
raw = open(prefix + '.pages', 'rb').read()
for i in range(0, len(raw), 4104):
    pages[struct.unpack_from('<Q', raw, i)[0]] = raw[i + 8:i + 4104]
def byte_at(a):
    p = pages.get(a & ~4095)
    return p[a & 4095] if p else 0
T, F, C, U, I = [], [], [], [], {}
for l in open(image_map, errors='replace'):
    f = l.rstrip('\n').split('\t')
    if f[0] == 'T': T.append((int(f[1]), f[2]))
    elif f[0] == 'C': C.append(int(f[1]))
    elif f[0] == 'F': F.append((int(f[2]), int(f[3]), (f[7] if len(f) > 7 else '?') + ' @' + f[4] + ':' + f[5]))
    elif f[0] == 'U': U.append((int(f[1]), int(f[2]), 'outlined of ' + f[3]))
    elif f[0] == 'I' and len(f) > 2: I[int(f[1])] = f[2]
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
mappings = []
for l in open(prefix + '.maps'):
    f = l.split()
    a, b = (int(x, 16) for x in f[0].split('-'))
    mappings.append((a, b, int(f[2], 16), f[5] if len(f) > 5 else '', f[1]))
mstarts = [m[0] for m in mappings]
symbols = []
for l in subprocess.run(['nm', '-n', '-C', '--defined-only', executable], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout.decode(errors='replace').splitlines():
    q = l.split(' ', 2)
    if len(q) == 3 and q[1] in 'tTwW': symbols.append((int(q[0], 16), q[2]))
sstarts = [x[0] for x in symbols]
in_maps = executable if any(m[3] == executable for m in mappings) else next((m[3] for m in mappings if m[3].startswith('/') and 'x' in m[4]), None)
pie = b'DYN' in subprocess.run(['readelf', '-h', executable], stdout=subprocess.PIPE).stdout
slide = min((m[0] - m[2] for m in mappings if m[3] == in_maps), default=0) if pie else 0
names = {}
def native_name(ip):
    r = names.get(ip)
    if r is not None: return r
    k = bisect.bisect_right(mstarts, ip) - 1
    m = mappings[k] if k >= 0 and ip < mappings[k][1] else None
    if m is None: r = '?'
    elif m[3] == in_maps and symbols:
        j = bisect.bisect_right(sstarts, ip - slide) - 1
        r = re.sub(r'\(.*', '', symbols[j][1])[:80] if j >= 0 else '?'
        r = re.sub(r'^(bool|void|unsigned int|JSC::JSValue|long) ', '', r)
    else: r = m[3].rsplit('/', 1)[-1] or '?'
    names[ip] = r
    return r
TYPES = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'js-types.txt')).read().split()
def kind(d):
    """the kind of a described value, and what tells one shape from another"""
    if d.startswith('c'):
        f = d[1:].split(':'); t = int(f[0])
        return (TYPES[t][:-4] if t < len(TYPES) else 'type %d' % t), f[1]
    if d.startswith('s') or d == 'rope': return 'a string', ''
    if d.startswith('y'): return 'a symbol', ''
    if d.startswith('i') or d == 'double': return 'a number', ''
    if d in ('v0x6', 'v0x7'): return 'a boolean', ''
    if d == 'v0xa': return 'undefined', ''
    if d == 'v0x2': return 'null', ''
    return d, ''
def identifier(name):
    number = name * 571 % 2048 if name < 2048 else name
    return I.get(number, '#%d' % number)
def fold(s):
    """a stub's name is Family[.Form][.n<count>][.Frameless | .StubFrame][.TwoIntegers][(%<register>)][#<immediate>]: dump(PrintStream&, StubKey)"""
    s = re.sub(r'\.n\d+', '.nN', s); s = re.sub(r'#\d+', '#N', s); s = re.sub(r' with arguments$', '', s); s = re.sub(r'\(%\w+\)', '', s); s = re.sub(r'\.TwoIntegers|WithDirectColumn', '', s)
    return s
doors = {}
for l in open(prefix + '.doors', errors='replace'):
    f = l.rstrip('\n').split('\t')
    doors[int(f[0])] = f
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
n = len(windows); total = sum(len(w[1]) for w in windows)
def is_call(a):
    i = a
    if 0x40 <= byte_at(i) <= 0x4f: i += 1
    return byte_at(i) == 0xe8
D = collections.defaultdict(lambda: [0, 0, 0])
WANTED = os.environ.get('RECEIVER'); FLAT = collections.Counter(); DOOR = re.compile(os.environ['DOOR']) if os.environ.get('DOOR') else None
L = {}
BY_NAME = re.compile(r'operationAOT(GetById|PutById|DefineById|InById|CallMethod|FindMethod|HasOwn)')
BY_KEY = re.compile(r'operationAOT\w*(ByVal|HasOwnProperty)')
def call_length(a):
    """the length of a call instruction at a, or 0"""
    i = a
    if 0x40 <= byte_at(i) <= 0x4f: i += 1
    if byte_at(i) == 0xe8: return i + 5 - a
    if byte_at(i) == 0xff and (byte_at(i + 1) >> 3 & 7) == 2:
        m = byte_at(i + 1); mod = m >> 6; rm = m & 7
        return i + 2 - a + (1 if mod != 3 and rm == 4 else 0) + (1 if mod == 1 else 4 if mod == 2 or (mod == 0 and rm == 5) else 0)
    return 0
def close(d, i, wi):
    e = D[d[4]]; e[0] += 1; e[1] += d[2]; e[2] += i - d[1]
    f = d[3]
    if BY_NAME.match(d[4]) or BY_KEY.match(d[4]):
        first = 3 if d[4].endswith('Plainly') else 4
        rk, shape = kind(f[first])
        if BY_KEY.match(d[4]):
            kk = kind(f[first + 1])[0]; key_text = f[first + 1] if f[first + 1][0] in 'sy' else kk
        else: key_text = '.' + identifier(int(f[8]))
        key = (d[4], rk, shape, key_text, d[6][0])
        x = L.get(key)
        if x is None: x = L[key] = [0, 0, 0, set(), collections.Counter(), collections.Counter()]
        x[0] += 1; x[1] += d[2]; x[2] += i - d[1]; x[3].add(wi); x[4][' > '.join(d[5])] += 1; x[5][d[6][1]] += 1
for wi, (begun, w) in enumerate(windows):
    open_doors = []      # [where it comes back to, start index, native count, door fields, name, path, origin, depth of visits if it was entered by a jump]
    visits = []          # the return addresses of the calls of stubs out of functions that are under way
    origin = ('?', '?'); prevk = None; prev = None
    for i, ip in enumerate(w):
        k = W(ip)
        if visits and k[0] == 'function' and ip in visits:
            while visits[-1] != ip: visits.pop()
            visits.pop()
            while open_doors and open_doors[-1][7] is not None and open_doors[-1][7] > len(visits): close(open_doors.pop(), i, wi)
        if k[0] == 'stub' and prevk is not None and prevk[0] == 'function' and is_call(prev):
            origin = (fold(k[1]), prevk[1]); visits.append(prev + call_length(prev))
        while open_doors and open_doors[-1][7] is None and ip == open_doors[-1][0]: close(open_doors.pop(), i, wi)
        f = doors.get(begun + i)
        if f is not None and k[0] == 'native' and byte_at(int(f[1], 16)) not in (0xc3, 0xc2):
            length = call_length(int(f[1], 16))
            open_doors.append([int(f[1], 16) + length, i, 0, f, native_name(ip), [], origin, None if length else len(visits)])
        if open_doors and k[0] == 'native':
            d = open_doors[-1]; d[2] += 1
            nn = native_name(ip)
            if WANTED and (BY_NAME.match(d[4]) or BY_KEY.match(d[4])) and kind(d[3][3 if d[4].endswith('Plainly') else 4])[0] == WANTED: FLAT[nn] += 1
            if DOOR and DOOR.search(d[4]): FLAT[d[4] + ' | ' + nn] += 1
            if nn not in d[5] and len(d[5]) < 14: d[5].append(nn)
        prev = ip; prevk = k
o = open(out + '.doors.txt', 'w')
P = lambda *a: print(*a, file=o)
P('%d windows; a request: %s instructions. Doors out of stubs into native code: visits a request | native instructions a visit | all instructions until back a visit | the sum of all, %% of the request' % (n, '{:,.0f}'.format(total / n)))
for name, e in sorted(D.items(), key=lambda x: -x[1][2])[:90]:
    P('   %8.1f %9.1f %9.1f %10.0f %6.2f%%  %s' % (e[0] / n, e[1] / e[0], e[2] / e[0], e[2] / n, 100 * e[2] / total, name))
o.close()
o = open(out + '.lookups.txt', 'w')
s = sum(x[2] for x in L.values())
P('LOOKUPS IN C++: %.1f visits a request, %.0f instructions (%.2f%% of the request)' % (sum(x[0] for x in L.values()) / n, s / n, 100 * s / total))
P('   visits a request | instructions a visit | sum a request | windows it came in | door . receiver (structure) . name or key . the stub the function called . the commonest function')
for key, x in sorted(L.items(), key=lambda y: -y[1][2])[:260]:
    P('   %7.1f %8.1f %9.0f  %d/%d  %s . %s%s %s . %s . %s' % (x[0] / n, x[2] / x[0], x[2] / n, len(x[3]), n, key[0].replace('operationAOT', ''), key[1], ' (' + key[2] + ')' if key[2] else '', key[3][:40], key[4], x[5].most_common(1)[0][0][:50]))
    P('                 %s' % x[4].most_common(1)[0][0][:330])
o.close()
o = open(out + '.causes.txt', 'w')
G = collections.defaultdict(lambda: [0, 0, set(), collections.Counter(), 0])
for key, x in L.items():
    for path, c in x[4].items():
        g = G[(key[0], key[1], ' > '.join(path.split(' > ')[1:7]))]; g[0] += c; g[1] += x[2] * c / x[0]; g[2].add((key[2], key[3])); g[3][key[3]] += c; g[4] += x[1] * c / x[0]
P('BY DOOR, KIND OF RECEIVER AND THE NATIVE FUNCTIONS GONE THROUGH: visits a request | native instructions a request | all instructions until back a request | %% | distinct (structure, name) | door . receiver . functions | the commonest names')
R = collections.defaultdict(lambda: [0, 0])
for key, x in L.items(): R[(key[0], key[1])][0] += x[0]; R[(key[0], key[1])][1] += x[1]
P('-- BY DOOR AND KIND OF RECEIVER: visits a request | native instructions a visit | native a request | %% of the request')
for key, r in sorted(R.items(), key=lambda y: -y[1][1])[:45]: P('   %7.1f %8.1f %9.0f %5.2f%%  %s . %s' % (r[0] / n, r[1] / r[0], r[1] / n, 100 * r[1] / total, key[0].replace('operationAOT', ''), key[1]))
P('-- BY THE FUNCTIONS GONE THROUGH')
for key, g in sorted(G.items(), key=lambda y: -y[1][4])[:70]:
    P('   %7.1f %9.0f %9.0f %5.2f%% %5d  %s . %s . %s' % (g[0] / n, g[4] / n, g[1] / n, 100 * g[4] / total, len(g[2]), key[0].replace('operationAOT', ''), key[1], key[2][:230]))
    P('                 %s' % ' '.join('%s x%.0f' % (a[:28], b / n) for a, b in g[3].most_common(9)))
o.close()

if WANTED or DOOR:
    o = open(out + '.flat.txt', 'w')
    P('native instructions a request inside lookups whose receiver is %s: %.0f' % (WANTED, sum(FLAT.values()) / n))
    for a, b in FLAT.most_common(70): P('   %8.1f  %s' % (b / n, a))
    o.close()
