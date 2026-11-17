import re, glob, statistics, json
rows = {}
for path in sorted(glob.glob('*-*-*.txt')):
    probe, build, rnd = path[:-4].split('-')
    for line in open(path):
        m = re.match(r'(.+?)\s+([0-9.]+) ms  min\s+([0-9.]+)', line)
        if m:
            rows.setdefault((probe, m.group(1).strip()), {}).setdefault(build, []).append(float(m.group(2)))
        m = re.match(r'\{"size":(\d+),"attempts":(\d+),"ms":(\d+)\}', line)
        if m:
            rows.setdefault((probe, f'poll {m.group(1)} attempts={m.group(2)}'), {}).setdefault(build, []).append(float(m.group(3)))
for (probe, label), v in rows.items():
    b, n = v.get('base', []), v.get('new', [])
    mb, mn = statistics.median(b), statistics.median(n)
    spread_b = max(b) - min(b); spread_n = max(n) - min(n)
    print(f'{probe:8} {label[:72]:72} base {mb:9.3f} (spread {spread_b:6.3f})  new {mn:9.3f} (spread {spread_n:6.3f})  delta {mn-mb:+8.3f} {100*(mn-mb)/mb if mb else 0:+6.1f}%')
