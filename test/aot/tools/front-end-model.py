#!/usr/bin/env python3
"""front-end-model.py <prefix of the output of steps.c> <map written by BUN_JSC_aotMapFilePath> <output file> [squeeze | sort | squeeze-all | sort-all]

A model of a CPU's front end, run over an exact trace of one thread (every instruction pointer, native code included). It says
whose cache lines, pages and branches miss, which sampling cannot: the fetch runs ahead of what retires, so a sample of a
front-end event lands on the wrong code.

The trace is cut into windows by zeros (steps.c writes one on SIGUSR2; the caller sends it ahead of each request). The first
window warms the model, the others are counted, and the table is their mean.

What is modeled, with the sizes of AMD Zen 4: L1i 32 KB (64 sets x 8 ways, LRU); L2 1 MB (1,024 x 16) holding code alone, so its
misses are a floor; iTLB 64 entries and a second level of 512; a branch target buffer indexed by the address of a taken branch,
1,536 entries (256 x 6) and a second level of 7,168 (1,024 x 7). On a Next.js server the model came within 15% of the hardware's
counters for both levels of the BTB, the iTLB and taken branches. It knows nothing of how the hardware hashes addresses, so it
does not show what moving code by a few bytes does.

Everything is booked by the kind of code the line or the branch belongs to (native, compiled function, outlined body, stub) and
by stub. Without a map (a run under the JIT) everything counts as native.

The fourth argument makes an experiment of it. "squeeze": the instructions of the stubs that ran in the trace are laid side by
side in their order and what did not run is left out: the ceiling of parting every stub's rare paths from its usual ones.
"sort": the same, with the stubs ordered by how many instructions ran in each. "squeeze-all" and "sort-all": the compiled
functions too."""
import sys, struct, bisect, collections, re, os
prefix, image_map, out = sys.argv[1:4]; pack = sys.argv[4] if len(sys.argv) > 4 else ''
data = open(prefix + '.ips', 'rb').read(); ips = struct.unpack('<%dQ' % (len(data) // 8), data); del data
T, F, C = [], [], []
for l in (open(image_map, errors='replace') if os.path.exists(image_map) else []):
    f = l.rstrip('\n').split('\t')
    if f[0] == 'T': T.append((int(f[1]), f[2]))
    elif f[0] == 'C': C.append(int(f[1]))
    elif f[0] == 'F': F.append((int(f[2]), int(f[3])))
    elif f[0] == 'U': F.append((int(f[1]), int(f[2])))
T.sort(); F.sort(); C = sorted(C) or [0]; tstarts = [t[0] for t in T]; fstarts = [f[0] for f in F]
first = None
for l in (open(prefix + '.perfmap', errors='replace') if os.path.exists(prefix + '.perfmap') else []):
    w = l.split(None, 2)
    if len(w) == 3 and (w[2].startswith('(stubs of compiled code)') or w[2].startswith('stub ')):
        a = int(w[0], 16); first = a if first is None else min(first, a)
base = (first or 0) - C[0]; end = max([f[0] + f[1] for f in F] or [0])
ends = []
for c in C:
    k = bisect.bisect_right(fstarts, c); ends.append(F[k][0] if k < len(F) else c + (T[-1][0] if T else 0) + 65536)
def fold(s):
    s = re.sub(r' of \d+$', ' of N', s); s = re.sub(r' with arguments.*', ' with arguments', s); s = re.sub(r' to operation.*', ' to an operation', s)
    return s
memo = {}
def where(line):
    w = memo.get(line)
    if w is None:
        o = (line << 6) + 32 - base
        if o < 0 or o >= end: w = ('native', '')
        else:
            k = bisect.bisect_right(C, o) - 1
            if k >= 0 and o < ends[k]:
                j = bisect.bisect_right(tstarts, o - C[k]) - 1; n = T[j][1] if j >= 0 else '?'
                w = ('outlined body', '') if n.startswith('outlined') else ('stub', fold(n))
            else: w = ('function', '')
        memo[line] = w
    return w
class Cache:
    def __init__(self, sets, ways): self.sets = [dict() for _ in range(sets)]; self.n = sets; self.ways = ways; self.clock = 0
    def touch(self, key):
        s = self.sets[key % self.n]; self.clock += 1
        hit = key in s
        s[key] = self.clock
        if not hit and len(s) > self.ways: del s[min(s, key=s.get)]
        return hit
moved = {}
if pack:
    ran = collections.Counter()
    for ip in ips:
        if ip and 0 <= ip - base < end: ran[ip] += 1
    groups = collections.defaultdict(list); weight = collections.Counter()
    for ip in sorted(ran):
        o = ip - base; k = bisect.bisect_right(C, o) - 1
        if k >= 0 and o < ends[k]: g = ('stub', k, bisect.bisect_right(tstarts, o - C[k]) - 1)
        elif pack.endswith('-all'): g = ('function', 0, bisect.bisect_right(fstarts, o) - 1)
        else: continue
        groups[g].append(ip); weight[g] += ran[ip]
    for kind in ('stub', 'function'):
        order = [g for g in groups if g[0] == kind]
        if not order: continue
        order.sort(key=(lambda g: -weight[g]) if pack.startswith('sort') else (lambda g: groups[g][0]))
        at = min(groups[g][0] for g in order) & ~63; begun = at
        for g in order:
            last = None
            for ip in groups[g]:
                if last is not None: at += (ip - last) if ip - last <= 15 else 4
                moved[ip] = at; last = ip
            at += 4
        sys.stderr.write('%s: %s: %d instructions that ran lie in %d B now\n' % (pack, kind, sum(len(groups[g]) for g in order), at - begun))
l1, l2, tlb1, tlb2, btb1, btb2 = Cache(64, 8), Cache(1024, 16), Cache(1, 64), Cache(64, 8), Cache(256, 6), Cache(1024, 7)
N = collections.Counter(); byStub = collections.defaultdict(collections.Counter); windows = 0; counted = 0
lastLine = None; lastPage = None; prev = 0; prevHome = 0
for ip in ips:
    if not ip:
        windows += 1; prev = 0; lastLine = None; continue
    on = windows >= 2
    home = ip >> 6
    if moved: ip = moved.get(ip, ip)
    line = ip >> 6
    if on: counted += 1
    if prev and not (prev < ip <= prev + 15):
        h1 = btb1.touch(prev); h2 = btb2.touch(prev)
        if on:
            k = where(prevHome); N[('taken', k[0])] += 1
            if not h1: N[('BTB1 miss', k[0])] += 1
            if not h1 and not h2:
                N[('BTB2 miss', k[0])] += 1
                if k[0] == 'stub': byStub[k[1]]['BTB2 miss'] += 1
    prev = ip; prevHome = home
    if line != lastLine:
        lastLine = line
        h = l1.touch(line)
        if on:
            k = where(home); N[('stays', k[0])] += 1
            if k[0] == 'stub': byStub[k[1]]['stays'] += 1
        if not h:
            g = l2.touch(line)
            if on:
                N[('L1i miss', k[0])] += 1
                if k[0] == 'stub': byStub[k[1]]['L1i miss'] += 1
                if not g: N[('L2 miss', k[0])] += 1
        page = ip >> 12
        if page != lastPage:
            lastPage = page
            h = tlb1.touch(page)
            if not h:
                g = tlb2.touch(page)
                if on:
                    k = where(home); N[('iTLB1 miss', k[0])] += 1
                    if k[0] == 'stub': byStub[k[1]]['iTLB1 miss'] += 1
                    if not g: N[('iTLB2 miss', k[0])] += 1
    if on: N[('instructions', where(home)[0])] += 1
r = max(1, windows - 1)
with open(out, 'w') as o:
    o.write('front-end-model.py%s: %d windows, the first warms the model; %d are counted; A REQUEST:\n' % (' ' + pack if pack else '', windows, r))
    K = ('native', 'function', 'outlined body', 'stub')
    o.write('%-16s' % '' + ''.join('%15s' % k for k in K) + '%15s\n' % 'all')
    for e in ('instructions', 'stays', 'taken', 'L1i miss', 'L2 miss', 'iTLB1 miss', 'iTLB2 miss', 'BTB1 miss', 'BTB2 miss'):
        o.write('%-16s' % e + ''.join('%15s' % '{:,.0f}'.format(N[(e, k)] / r) for k in K) + '%15s\n' % '{:,.0f}'.format(sum(N[(e, k)] for k in K) / r))
    o.write('("stays": how often the fetch comes into a line of 64 B from another)\nBY STUB: stays | L1i misses | a stay | iTLB misses | taken branches no BTB knows\n')
    for s, c in sorted(byStub.items(), key=lambda x: -x[1]['L1i miss'])[:70]:
        o.write('   %8.0f %8.0f %6.2f %8.0f %8.0f  %s\n' % (c['stays'] / r, c['L1i miss'] / r, c['L1i miss'] / max(1, c['stays']), c['iTLB1 miss'] / r, c['BTB2 miss'] / r, s[:70]))
