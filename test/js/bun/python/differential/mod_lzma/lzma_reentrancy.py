# What runs while the arguments are converted cannot take the memory of the data away, nor use the object halfway.
import lzma
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
plain = bytes(range(256)) * 40
packed = lzma.compress(plain, preset=0)
class N:
    "A number that tries to empty the bytearray when it is asked which number."
    def __init__(self, data, value): self.data, self.value = data, value
    def __index__(self):
        t(self.data.clear); t(self.data.extend, b'x' * 100000); self.data[0] ^= 0
        return self.value
d = bytearray(packed); t(lambda: lzma.LZMADecompressor().decompress(d, N(d, 100)) == plain[:100]); print(len(d)); d.clear()
d = bytearray(packed); t(lambda: lzma.LZMADecompressor().decompress(data=d, max_length=N(d, -1)) == plain); d.clear()
# The same object is used while max_length is asked for.
class Use:
    def __init__(self, o, data): self.o, self.data = o, data
    def __index__(self): print('inner', len(self.o.decompress(self.data, 50)), self.o.needs_input); return 70
o = lzma.LZMADecompressor(); a = o.decompress(b'', Use(o, packed)); print(len(a), a == plain[50:120], o.needs_input, o.eof)
o = lzma.LZMADecompressor(); t(lambda: len(o.decompress(packed[10:], Use(o, packed[:10])))); print(o.needs_input, o.eof)
class End:
    def __init__(self, o): self.o = o
    def __index__(self): print('inner', self.o.decompress(packed) == plain, self.o.eof); return 5
o = lzma.LZMADecompressor(); t(o.decompress, b'more', End(o)); print(o.eof, o.unused_data)
# Objects that give out a buffer of their own making
class B:
    def __init__(self, data): self.data = data
    def __buffer__(self, flags): print('__buffer__', int(flags)); return memoryview(self.data)
    def __release_buffer__(self, view): print('__release_buffer__'); view.release()
t(lambda: lzma.decompress(lzma.compress(B(plain, preset=0))) == plain); t(lambda: lzma.LZMADecompressor().decompress(B(packed)) == plain)
class Bad:
    def __buffer__(self, flags): raise KeyError('no buffer')
t(lzma.compress, Bad()); t(lzma.LZMADecompressor().decompress, Bad()); c = lzma.LZMACompressor(preset=0); t(c.compress, Bad()); print(lzma.decompress(c.compress(b'ok') + c.flush()))
class Flush:
    def __init__(self, c): self.c = c
    def __buffer__(self, flags): print('flushed', len(self.c.flush())); return memoryview(b'late')
c = lzma.LZMACompressor(preset=0); t(c.compress, Flush(c)); t(c.flush)
# The result does not share memory with the input, and the kept input does not either.
d = bytearray(packed); o = lzma.LZMADecompressor(); a = o.decompress(d, 10); d[:] = b'\0' * len(d); d.clear(); print(a + o.decompress(b'') == plain, o.eof)
d = bytearray(packed + b'tail'); o = lzma.LZMADecompressor(); a = o.decompress(d); d[:] = b'\0' * len(d); print(a == plain, o.unused_data)
# What a filter specifier runs
F = lzma
class Spec(dict):
    def __init__(self, chain, *a, **k): super().__init__(*a, **k); self.chain = chain
    def __getitem__(self, k):
        if self.chain: print('clearing'); self.chain.clear()
        return dict.__getitem__(self, k)
chain = []; chain += [Spec(chain, id=F.FILTER_DELTA), {'id': F.FILTER_LZMA2}]
t(lzma.LZMACompressor, filters=chain); print(chain)
class Grow:
    def __init__(self, chain): self.chain = chain
    def __index__(self): self.chain.extend([{'id': F.FILTER_DELTA}] * 50); return F.FILTER_DELTA
chain = []; chain += [{'id': Grow(chain)}, {'id': F.FILTER_LZMA2}]
t(lzma.LZMACompressor, filters=chain); print(len(chain))
class Mutate:
    def __init__(self, spec): self.spec = spec
    def __index__(self): self.spec.clear(); self.spec['zz'] = 1; return 2
spec = {'id': F.FILTER_LZMA2}; spec['lc'] = Mutate(spec); spec['pb'] = 1
t(lzma._encode_filter_properties, spec); print(spec)
spec = {'id': F.FILTER_LZMA2}; spec['lc'] = Mutate(spec)
t(lzma._encode_filter_properties, spec); print(spec)
class Props:
    def __buffer__(self, flags): print('__buffer__', int(flags)); return memoryview(b'\x16')
t(lzma._decode_filter_properties, F.FILTER_LZMA2, Props())
class Id:
    def __index__(self): print('id'); return F.FILTER_LZMA2
t(lzma._decode_filter_properties, Id(), Props()); t(lzma._decode_filter_properties, Id(), 5); t(lzma._decode_filter_properties, 'a', Props())
class Add:
    def __init__(self, spec, more): self.spec, self.more = spec, more
    def __index__(self): self.spec.update(self.more); return 1
for more in ({'pb': 0}, {'pb': 'bad'}, {'pb': 0, 'zz': 1}, {'dict_size': 4096}):
    spec = {'id': F.FILTER_LZMA1}; spec['lc'] = Add(spec, more)
    t(lzma._encode_filter_properties, spec); print(sorted(spec))
    spec = {'id': F.FILTER_LZMA1}; spec['lc'] = Add(spec, more); spec['depth'] = 5
    t(lzma._encode_filter_properties, spec); print(sorted(spec))
