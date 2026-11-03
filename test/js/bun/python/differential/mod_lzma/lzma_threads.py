# Threads: many objects at once, several threads on one object, and other threads running while the library works.
import lzma, threading, random, hashlib
r = random.Random(5)
blocks = [r.randbytes(3000) + bytes([i]) * 3000 for i in range(24)]
# Each thread with objects of its own
results = {}
def own(i):
    data = b''.join(blocks[i:] + blocks[:i])
    c = lzma.compress(data, preset=i % 4, check=(0, 1, 4, 10)[i % 4])
    d = lzma.LZMADecompressor(); out = []
    for j in range(0, len(c), 997): out.append(d.decompress(c[j:j + 997], 5000))
    while not d.eof: out.append(d.decompress(b'', 5000))
    results[i] = (b''.join(out) == data, c[:6])
ts = [threading.Thread(target=own, args=(i,)) for i in range(8)]
for t in ts: t.start()
for t in ts: t.join()
print(sorted(results.items()))
# Several threads feed one compressor: the pieces arrive whole, in some order.
co = lzma.LZMACompressor(preset=0); parts = []; lock = threading.Lock(); start = threading.Barrier(6)
# What compress() returns belongs at the place in the stream where the call came, which only the compressor knows: so the output
# is collected under a lock that covers the call.
def feed_locked(i):
    start.wait()
    for j in range(i, len(blocks), 6):
        with lock: parts.append(co.compress(blocks[j]))
ts = [threading.Thread(target=feed_locked, args=(i,)) for i in range(6)]
for t in ts: t.start()
for t in ts: t.join()
parts.append(co.flush())
out = lzma.decompress(b''.join(parts))
print(len(out) == sum(map(len, blocks)), sorted(out[i:i + 6000] for i in range(0, len(out), 6000)) == sorted(blocks))
# Without a lock of the program's, nothing worse than errors: every call is atomic, and the library's state stays whole.
co = lzma.LZMACompressor(preset=0); start = threading.Barrier(6); errors = []; total = []
def feed_free(i):
    start.wait()
    try:
        for j in range(i, len(blocks), 6): total.append(len(co.compress(blocks[j])))
    except Exception as e: errors.append(repr(e))
ts = [threading.Thread(target=feed_free, args=(i,)) for i in range(6)]
for t in ts: t.start()
for t in ts: t.join()
print(errors, len(total), co.flush()[-2:])
# Several threads read from one decompressor: each byte comes out once.
data = b''.join(blocks); c = lzma.compress(data, preset=0)
d = lzma.LZMADecompressor(); got = [d.decompress(c, 100)]; start = threading.Barrier(6); seen = []
def take():
    start.wait()
    while True:
        try: piece = d.decompress(b'', 777)
        except EOFError as e: seen.append(str(e)); return
        got.append(piece)
ts = [threading.Thread(target=take) for i in range(6)]
for t in ts: t.start()
for t in ts: t.join()
print(sum(map(len, got)) == len(data), sorted(b''.join(got)) == sorted(data), set(seen), d.eof, d.needs_input)
# flush() by two threads: one wins.
for n in range(5):
    co = lzma.LZMACompressor(preset=0); co.compress(data); start = threading.Barrier(4); outcome = []
    def finish():
        start.wait()
        try: outcome.append(len(co.flush()) > 0)
        except ValueError as e: outcome.append(str(e))
    ts = [threading.Thread(target=finish) for i in range(4)]
    for t in ts: t.start()
    for t in ts: t.join()
    print(sorted(map(str, outcome)))
# While one thread compresses, another gets to run.
big = r.randbytes(1500000); ticks = 0; done = threading.Event(); begun = threading.Event()
def work():
    begun.set(); lzma.compress(big, preset=1); done.set()
w = threading.Thread(target=work); w.start(); begun.wait()
while not done.is_set(): ticks += 1
w.join(); print(ticks > 0)
