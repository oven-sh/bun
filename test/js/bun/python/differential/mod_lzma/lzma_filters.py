# Filter specifiers: what is taken, what is refused, and in which words.
import _lzma, lzma, collections, types
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
enc, dec = _lzma._encode_filter_properties, _lzma._decode_filter_properties
F = lzma
L1, L2, DE, X86 = F.FILTER_LZMA1, F.FILTER_LZMA2, F.FILTER_DELTA, F.FILTER_X86
BCJ = (F.FILTER_X86, F.FILTER_POWERPC, F.FILTER_IA64, F.FILTER_ARM, F.FILTER_ARMTHUMB, F.FILTER_SPARC)
# Not a mapping, no id, a bad id
for spec in (5, None, 1.5, object(), len, int, 'abc', b'abc', [1], (1,), [], range(3), {1, 2}, memoryview(b'ab'), {}, {'ID': 1}, {b'id': 1}, {'id': None}, {'id': 'a'}, {'id': 1.0}, {'id': -1}, {'id': -2**70},
             {'id': 2**64}, {'id': 2**64 - 1}, {'id': 2**63}, {'id': 0}, {'id': 1}, {'id': 2}, {'id': 10}, {'id': 12}, {'id': 0x20}, {'id': 0x22}, {'id': True}, {'id': L1 + 1}, {'id': L1 - 1}):
    t(enc, spec)
t(enc); t(enc, {'id': L2}, 1); t(enc, filter={'id': L2})
# LZMA1 and LZMA2
for i in (L1, L2):
    t(enc, {'id': i})
    for preset in list(range(10)) + [p | F.PRESET_EXTREME for p in range(10)]: print(preset, enc({'id': i, 'preset': preset}), end=' ')
    print()
    for preset in (10, 15, 31, 32, 64, 2**31 + 10, 2**30, 2**32 - 1, 2**32, 2**64, -1, 'a', None, 1.5, b'', [], True): t(enc, {'id': i, 'preset': preset})
    for size in (0, 1, 4095, 4096, 4097, 6144, 2**16, 2**16 + 1, 3 << 20, 2**26, 2**30, 2**30 + 2**29, 2**30 + 2**29 + 1, 2**31, 2**32 - 1, 2**32, -1, 'a', None, 1.0): t(enc, {'id': i, 'dict_size': size})
    for lc, lp, pb in ((0, 0, 0), (4, 0, 0), (0, 4, 0), (0, 0, 4), (3, 1, 2), (2, 2, 4), (4, 1, 0), (5, 0, 0), (0, 5, 0), (0, 0, 5), (3, 2, 0), (2**32 - 1, 0, 0), (2**32, 0, 0), (-1, 0, 0), (0, 'a', 0), (0, 0, None)):
        t(enc, {'id': i, 'lc': lc, 'lp': lp, 'pb': pb})
    for key in ('mode', 'nice_len', 'mf', 'depth'):
        for value in (0, 1, 2, 3, 4, 5, 0x12, 0x13, 0x14, 0x15, 273, 274, 2**31, 2**32 - 1, 2**32, -1, 'a', None, 1.5, True): t(enc, {'id': i, key: value})
    for extra in ({'x': 1}, {'dist': 1}, {'start_offset': 0}, {1: 2}, {None: None}, {'Preset': 1}, {'dict_size ': 1}, {'': 0}, {b'lc': 1}, {('lc',): 1}): t(enc, {'id': i, **extra})
    t(enc, {'id': i, 'preset': 3, 'dict_size': 2**20, 'lc': 2, 'lp': 1, 'pb': 1, 'mode': F.MODE_FAST, 'nice_len': 100, 'mf': F.MF_HC3, 'depth': 10})
    t(enc, {'id': i, 'preset': 3, 'dict_size': 2**20, 'lc': 2, 'lp': 1, 'pb': 1, 'mode': F.MODE_FAST, 'nice_len': 100, 'mf': F.MF_HC3, 'depth': 10, 'x': 0})
    t(enc, {'id': i, 'preset': 99, 'x': 0}); t(enc, {'id': i, 'preset': 'a', 'x': 0}); t(enc, {'id': i, 'lc': 'a', 'x': 0})
# Delta
for dist in (0, 1, 2, 255, 256, 257, 2**32 - 1, 2**32, -1, 'a', None, 1.0, True): t(enc, {'id': DE, 'dist': dist})
t(enc, {'id': DE}); t(enc, {'id': DE, 'x': 1}); t(enc, {'id': DE, 'preset': 1}); t(enc, {'id': DE, 'dist': 1, 'type': 0}); t(enc, {'id': DE, 1: 1})
# BCJ
for i in BCJ:
    t(enc, {'id': i})
    for offset in (0, 1, 2, 4, 16, 0x1000, 2**32 - 16, 2**32 - 1, 2**32, -1, 'a', None, 1.0): t(enc, {'id': i, 'start_offset': offset})
    t(enc, {'id': i, 'x': 1}); t(enc, {'id': i, 'dist': 1}); t(enc, {'id': i, 'preset': 1})
# Mappings that are not dicts get as far as their id, and, for LZMA, their preset.
class M(collections.abc.Mapping):
    def __init__(self, d): self.d = d
    def __getitem__(self, k): print('get', k); return self.d[k]
    def __iter__(self): return iter(self.d)
    def __len__(self): return len(self.d)
class G:
    def __init__(self, d): self.d = d
    def __getitem__(self, k): print('get', k); return self.d[k]
class Sub(dict): pass
class Loud(dict):
    def __getitem__(self, k): print('get', k); return dict.__getitem__(self, k)
class Missing(dict):
    def __missing__(self, k): print('missing', k); return {'id': L2, 'preset': 2}[k]
class Raises(dict):
    def __getitem__(self, k): raise ZeroDivisionError(k)
class Look(dict):
    def __getitem__(self, k): raise LookupError(k)
class Index(dict):
    def __getitem__(self, k): raise IndexError(k)
for i in (L2, L1, DE, X86, 77):
    for make in (M, G, Sub, Loud, collections.UserDict, collections.OrderedDict, types.MappingProxyType, collections.ChainMap, collections.defaultdict, frozendict, Raises, Look, Index):
        print(i, make.__name__); t(enc, make({'id': i}) if make is not collections.defaultdict else make(None, {'id': i}))
t(enc, Missing()); t(enc, Missing(id=L2)); t(enc, collections.defaultdict(lambda: L2)); t(enc, collections.Counter()); t(enc, collections.Counter(id=L2))
t(enc, M({'id': L2, 'preset': 99})); t(enc, M({'id': L2, 'preset': 'a'})); t(enc, M({}))
# Numbers by __index__, in the order in which they are asked for
class I:
    def __init__(self, n, v): self.n, self.v = n, v
    def __index__(self): print('index', self.n); return self.v
t(enc, {'depth': I('depth', 1), 'mf': I('mf', F.MF_BT4), 'nice_len': I('nice_len', 64), 'mode': I('mode', 2), 'pb': I('pb', 2), 'lp': I('lp', 0), 'lc': I('lc', 3), 'dict_size': I('dict_size', 4096), 'preset': I('preset', 1), 'id': I('id', L1)})
t(enc, {'id': I('id', L2), 'lc': I('lc', -1), 'pb': I('pb', 1)}); t(enc, {'id': I('id', L2), 'zz': 0, 'pb': I('pb', 1)})
t(enc, {'id': I('id', L2), **{'k%d' % i: 0 for i in range(10)}, 'pb': I('pb', 1)})
t(enc, {'id': I('id', DE), 'dist': I('dist', 9)}); t(enc, {'id': I('id', X86), 'start_offset': I('start_offset', 32)})
class E:
    def __index__(self): raise KeyError('from __index__')
t(enc, {'id': E()}); t(enc, {'id': L2, 'preset': E()}); t(enc, {'id': L2, 'lc': E()}); t(enc, {'id': DE, 'dist': E()})
class S(str): pass
t(enc, {S('id'): L2}); t(enc, {'id': L2, S('lc'): 2}); t(enc, {'id': L2, S('zz'): 2})
# The other way round
for i, props in ((L1, b']\x00\x00\x80\x00'), (L1, b'\x00\x00\x10\x00\x00'), (L1, b'\xe0\xff\xff\xff\xff'), (L1, b'\xe1\x00\x00\x00\x00'), (L1, b''), (L1, b']\x00\x00\x80'), (L1, b']\x00\x00\x80\x00\x00'),
                 (L2, b'\x00'), (L2, b'\x16'), (L2, b'\x27'), (L2, b'\x28'), (L2, b'\x29'), (L2, b'\xff'), (L2, b''), (L2, b'\x16\x00'),
                 (DE, b'\x00'), (DE, b'\xff'), (DE, b''), (DE, b'\x00\x00')):
    t(dec, i, props)
for i in BCJ:
    for props in (b'', b'\x00\x00\x00\x00', b'\x10\x00\x00\x00', b'\x01\x00\x00\x00', b'\xf0\xff\xff\xff', b'\x00', b'\x00' * 5): t(dec, i, props)
# (Not 11: liblzma has had a filter of that number, for RISC-V, since 5.6, and says other things of it before and after.)
for i in (0, 1, 2, 10, 12, 0x20, 0x22, 2**62, 2**63, 2**64 - 1):
    t(dec, i, b''); t(dec, i, b'\0\0\0\0')
t(dec); t(dec, L2); t(dec, L2, b'\x16', 1); t(dec, filter_id=L2, encoded_props=b'\x16'); t(dec, 'a', b''); t(dec, -1, b''); t(dec, 2**64, b''); t(dec, 1.0, b''); t(dec, None, b'')
t(dec, L2, 'a'); t(dec, L2, None); t(dec, L2, 5); t(dec, L2, [22]); t(dec, L2, bytearray(b'\x16')); t(dec, L2, memoryview(b'\x16')); t(dec, L2, memoryview(b'\x16\x00')[::2]); t(dec, 'a', 'a'); t(dec, I('id', L2), b'\x16')
r = dec(L1, b']\x00\x00\x80\x00'); print(type(r), list(r), [type(v) for v in r.values()])
for spec in ({'id': L1, 'preset': 3}, {'id': L2, 'dict_size': 3 << 22}, {'id': DE, 'dist': 77}, {'id': X86, 'start_offset': 64}, {'id': F.FILTER_ARM}):
    print(dec(spec['id'], enc(spec)))
# Chains
C, D = lzma.LZMACompressor, lzma.LZMADecompressor
two = {'id': L2, 'preset': 0}; one = {'id': L1, 'preset': 0}; de = {'id': DE}; x = {'id': X86}
for chain in ([], (), [two], (two,), [de, two], [de, de, de, two], [de, de, de, de, two], [de] * 5, [de] * 100, [two, two], [two, de], [de], [x], [x, x, x, x], [one], [de, one], [one, two], [two, one],
              [5], [None], [[]], [{}], [two, 5], [5, two], 'ab', b'ab', 5, None, {}, {'id': L2}, {1: two}, {0: two}, set(), {1}, frozenset([1]), iter([two]), (f for f in [two]), range(1), range(0), collections.deque([two]), collections.UserList([two]),
              collections.OrderedDict(), types.MappingProxyType({}), [two] * 4, [two] * 5, memoryview(b''), memoryview(b'a'), bytearray(b''), ''):
    print(repr(chain)[:70].split(' at 0x')[0])
    for fmt in (F.FORMAT_XZ, F.FORMAT_ALONE, F.FORMAT_RAW): t(C, fmt, filters=chain)
    t(D, F.FORMAT_RAW, filters=chain)
class Seq:
    def __init__(self, items, n=None): self.items, self.n = items, len(items) if n is None else n
    def __len__(self): print('len'); return self.n
    def __getitem__(self, i): print('item', i); return self.items[i]
t(C, filters=Seq([de, two])); t(C, filters=Seq([de, two], 1)); t(C, filters=Seq([de, two], 3)); t(C, filters=Seq([], 5)); t(C, filters=Seq([], -1)); t(C, filters=Seq([], 2**63)); t(C, filters=Seq([], 'a'))
class NoItem:
    def __len__(self): return 1
class NoLen:
    def __getitem__(self, i): return two
class Plain(dict): pass
class Len(dict):
    def __len__(self): return 1
class Both(dict):
    def __len__(self): return 1
    def __getitem__(self, i): return two
class Item(dict):
    def __getitem__(self, i): return two
for T in (Plain, Len, Both, Item): t(C, filters=T()); t(C, filters=T({0: two}))
t(C, filters=NoItem()); t(C, filters=NoLen()); t(D, F.FORMAT_RAW, filters=NoItem()); t(D, F.FORMAT_RAW, filters=NoLen())
