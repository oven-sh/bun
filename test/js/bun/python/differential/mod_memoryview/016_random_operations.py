# The same pseudo-random operations on both sides; what they give is summed up in a few lines.
import binascii
seed = 12345
def rnd(n):
    global seed
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed >> 8) % n
FORMATS = ['B', 'b', 'c', 'h', 'H', 'i', 'I', 'l', 'L', 'q', 'Q', 'n', 'N', 'f', 'd', 'e', '?', 'P', '@B', '@i', 'Zf', 'Zd']
def rslice(n):
    def part():
        return None if rnd(4) == 0 else rnd(2 * n + 3) - n - 1
    step = None if rnd(3) == 0 else (rnd(7) - 3 or 1)
    return slice(part(), part(), step)
def shapes(n):
    out = [(n,)]
    for a in range(1, n + 1):
        if n % a == 0:
            out.append((a, n // a))
            for c in range(1, n // a + 1):
                if (n // a) % c == 0:
                    out.append((a, c, n // a // c))
    return out
log = []
def note(*values):
    log.append(repr(values))
errors = {}
for round in range(400):
    n = rnd(49)
    data = bytearray(rnd(256) for _ in range(n))
    shadow = bytearray(data)
    m = memoryview(data)
    views = [(m, slice(None))]
    try:
        for step in range(12):
            op = rnd(12)
            v, _ = views[rnd(len(views))]
            if op == 0 and v.ndim == 1:
                s = rslice(len(v)); w = v[s]; views.append((w, s)); note('slice', w.shape, w.strides, w.tobytes(), w.c_contiguous, w.f_contiguous, w.nbytes)
            elif op == 1:
                f = FORMATS[rnd(len(FORMATS))]; w = v.cast(f); views.append((w, None)); note('cast', f, w.shape, w.itemsize, w.nbytes)
            elif op == 2 and v.ndim == 1 and len(v):
                options = shapes(len(v)); shape = options[rnd(len(options))]; w = v.cast(v.format, shape); views.append((w, None)); note('shape', shape, w.strides, w.tolist() == w.tolist(), w.tobytes('F'), w.tobytes('A'), w.tobytes())
            elif op == 3:
                x = v.tolist(); note('tolist', repr(x) if 'nan' not in repr(x) else len(repr(x)))
            elif op == 4 and v.ndim == 1 and v.format in ('B', '@B') and len(v):
                i = rnd(len(v)); v[i] = rnd(256); note('set', i, bytes(data))
            elif op == 5 and v.ndim == 1 and v.format in ('B', '@B'):
                s = rslice(len(v)); k = len(range(*s.indices(len(v)))); v[s] = bytes(rnd(256) for _ in range(k)); note('setslice', bytes(data))
            elif op == 6 and v.ndim == 1:
                w, _ = views[rnd(len(views))]; s = rslice(len(v)); v[s] = w; note('copy', bytes(data))
            elif op == 7:
                w, _ = views[rnd(len(views))]; note('eq', v == w if 'Z' not in v.format + w.format and v.format not in 'efd' and w.format not in 'efd' else None, v == v.tobytes(), v.tobytes() == bytes(v))
            elif op == 8:
                note('hex', v.hex(), v.hex('-', rnd(5) - 2))
            elif op == 9 and v.ndim == 1 and v.format in 'Bbc':
                r = v.toreadonly(); views.append((r, None)); note('ro', r.readonly, bytes(r))
            elif op == 10 and v.ndim == 1:
                x = list(v); note('iter', len(x), v.count(x[0]) if x and x[0] == x[0] else 0, v.index(x[-1]) if x and x[-1] == x[-1] else -1)
            elif op == 11 and v.ndim > 1:
                k = tuple(rnd(d + 1) - (d + 1) // 2 for d in v.shape); note('item', k, v[k] if v[k] == v[k] else 'nan')
    except (TypeError, ValueError, IndexError, NotImplementedError, BufferError) as e:
        key = type(e).__name__ + ': ' + str(e)
        errors[key] = errors.get(key, 0) + 1
        note('error', key)
    for v, _ in views:
        v.release()
    data.append(0)
print(len(log), binascii.crc32('\n'.join(log).encode()))
for k in sorted(errors):
    print(errors[k], k)
for i in range(0, len(log), 97):
    print(log[i][:200])
