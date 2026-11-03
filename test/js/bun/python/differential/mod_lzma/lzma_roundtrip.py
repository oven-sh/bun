# Every format, check, preset and filter, one shot and in pieces. The oracle's liblzma is another version, and an encoder
# may choose differently from one version to the next: what is compared is the meaning of the output, and its framing.
import lzma, random
r = random.Random(11)
texts = {
    'empty': b'',
    'one': b'x',
    'run': b'a' * 30000,
    'text': b''.join(b'%d bottles of beer on the wall, %d bottles of beer\n' % (i, i) for i in range(700)),
    'noise': r.randbytes(9000),
    'ramp': bytes((i * 3 + (i >> 8)) & 255 for i in range(20000)),
}
def back(c, data, **k):
    d = lzma.LZMADecompressor(**k); out = d.decompress(c)
    return out == data, d.eof, d.needs_input, d.unused_data, d.check
for name, data in texts.items():
    for preset in list(range(10)) + [p | lzma.PRESET_EXTREME for p in (0, 3, 6, 9)]:
        if preset & 15 > 6 and name != 'text': continue
        c = lzma.compress(data, preset=preset)
        print(name, preset, c[:6], c[-2:], len(c) % 4, back(c, data), back(c, data, format=lzma.FORMAT_XZ))
        c = lzma.compress(data, format=lzma.FORMAT_ALONE, preset=preset)
        print(name, preset, c[:13], back(c, data), back(c, data, format=lzma.FORMAT_ALONE))
    for check in (lzma.CHECK_NONE, lzma.CHECK_CRC32, lzma.CHECK_CRC64, lzma.CHECK_SHA256, -1):
        c = lzma.compress(data, check=check, preset=1)
        print(name, check, c[6:12], back(c, data))
F = lzma
chains = [
    [{'id': F.FILTER_LZMA2}],
    [{'id': F.FILTER_LZMA2, 'preset': 1}],
    [{'id': F.FILTER_LZMA2, 'preset': 9 | F.PRESET_EXTREME, 'dict_size': 1 << 16}],
    [{'id': F.FILTER_LZMA2, 'dict_size': 4096, 'lc': 0, 'lp': 4, 'pb': 0}],
    [{'id': F.FILTER_LZMA2, 'lc': 4, 'lp': 0, 'pb': 4, 'mode': F.MODE_FAST, 'nice_len': 5, 'mf': F.MF_HC3, 'depth': 3}],
    [{'id': F.FILTER_LZMA2, 'mode': F.MODE_NORMAL, 'nice_len': 273, 'mf': F.MF_BT2, 'depth': 0}],
    [{'id': F.FILTER_LZMA2, 'mf': F.MF_BT3}], [{'id': F.FILTER_LZMA2, 'mf': F.MF_BT4}], [{'id': F.FILTER_LZMA2, 'mf': F.MF_HC4, 'mode': F.MODE_FAST}],
    [{'id': F.FILTER_DELTA}, {'id': F.FILTER_LZMA2}],
    [{'id': F.FILTER_DELTA, 'dist': 1}, {'id': F.FILTER_LZMA2, 'preset': 0}],
    [{'id': F.FILTER_DELTA, 'dist': 256}, {'id': F.FILTER_LZMA2, 'preset': 0}],
    [{'id': F.FILTER_DELTA, 'dist': 3}, {'id': F.FILTER_DELTA, 'dist': 5}, {'id': F.FILTER_DELTA, 'dist': 7}, {'id': F.FILTER_LZMA2, 'preset': 0}],
] + [[{'id': b}, {'id': F.FILTER_LZMA2, 'preset': 0}] for b in (F.FILTER_X86, F.FILTER_POWERPC, F.FILTER_IA64, F.FILTER_ARM, F.FILTER_ARMTHUMB, F.FILTER_SPARC)] + [
    [{'id': F.FILTER_X86, 'start_offset': 0x1000}, {'id': F.FILTER_LZMA2, 'preset': 0}],
    [{'id': F.FILTER_ARM, 'start_offset': 4}, {'id': F.FILTER_DELTA, 'dist': 4}, {'id': F.FILTER_LZMA2, 'preset': 0}],
    [{'id': F.FILTER_X86}, {'id': F.FILTER_ARM}, {'id': F.FILTER_SPARC}, {'id': F.FILTER_LZMA2, 'preset': 0}],
]
code = bytes(r.choice((0xe8, 0xe9, 0x0f, 0x48, 0xeb, 0x94, 0x40, 0x7f, 0, 0xff, r.randrange(256))) for i in range(12000))
for chain in chains:
    for name, data in (('text', texts['text']), ('code', code), ('empty', b'')):
        c = lzma.compress(data, filters=chain)
        raw = lzma.compress(data, format=lzma.FORMAT_RAW, filters=chain)
        print([sorted(f.items()) for f in chain], name, back(c, data), back(raw, data, format=lzma.FORMAT_RAW, filters=chain)[:4], lzma.decompress(raw, lzma.FORMAT_RAW, filters=tuple(chain)) == data)
for options in ({}, {'preset': 2}, {'dict_size': 8192, 'lc': 1, 'lp': 2, 'pb': 1}, {'mode': F.MODE_FAST, 'mf': F.MF_HC4, 'nice_len': 32, 'depth': 8}):
    chain = [{'id': F.FILTER_LZMA1, **options}]
    for name, data in texts.items():
        c = lzma.compress(data, format=lzma.FORMAT_ALONE, filters=chain); raw = lzma.compress(data, format=lzma.FORMAT_RAW, filters=chain)
        print(sorted(options.items()), name, c[:13], back(c, data), back(raw, data, format=lzma.FORMAT_RAW, filters=chain)[:4])
# In pieces
data = texts['text'] + texts['noise'] + texts['ramp']
for fmt, kw in ((lzma.FORMAT_XZ, {}), (lzma.FORMAT_ALONE, {}), (lzma.FORMAT_RAW, {'filters': chains[9]})):
    for step in (1, 13, 4096, 100000):
        co = lzma.LZMACompressor(fmt, preset=None if kw else 1, **kw); parts = [co.compress(data[i:i + step]) for i in range(0, len(data), step)]; parts.append(co.flush())
        c = b''.join(parts)
        de = lzma.LZMADecompressor(fmt, **kw); out = b''.join(de.decompress(c[i:i + step]) for i in range(0, len(c), step))
        print(fmt, step, out == data, de.eof, de.needs_input, de.unused_data, de.check)
# What liblzma 5.4 wrote: fixed bytes in, fixed bytes out.
import base64, zlib
for text in ('/Td6WFoAAATm1rRGAgAhARYAAAB0L+WjAQALaGVsbG8gd29ybGQKAKHy/8Rqf7/PAAEkDKYY2NgftvN9AQAAAAAEWVo=',
             'XQAAgAD//////////wA0GUnujekXiTozX/yyCYIv//3igAA=',
             '/Td6WFoAAArh+wyhAwIDAQEEACEBFAAA7ky8z+ACVwAZXQA0GTyAT+dhy+owUVCwBGgnZ/IF8764qAAAAAAAAJ3SBnVQk7qXaMOCM03PRwjpt7j1xaMt4flmFW05gLM/AAFR2AQAAABArGAytunfHAIAAAAAClla'):
    d = lzma.LZMADecompressor(); out = d.decompress(base64.b64decode(text)); print(len(out), out[:24], d.check, d.eof)
# The .lz container, which FORMAT_AUTO takes as well: a header, LZMA1 with an end marker, a trailer.
def lzip(data):
    body = lzma.compress(data, lzma.FORMAT_RAW, filters=[{'id': lzma.FILTER_LZMA1, 'dict_size': 1 << 16, 'lc': 3, 'lp': 0, 'pb': 2}])
    return b'LZIP\x01\x10' + body + zlib.crc32(data).to_bytes(4, 'little') + len(data).to_bytes(8, 'little') + (len(body) + 26).to_bytes(8, 'little')
for name, data in texts.items():
    m = lzip(data); print(name, back(m, data), back(m + b'tail', data))
    for fmt in (lzma.FORMAT_XZ, lzma.FORMAT_ALONE):
        try: print(back(m, data, format=fmt))
        except lzma.LZMAError as e: print('LZMAError', e)
bad = bytearray(lzip(texts['text'])); bad[-20] ^= 1
try: print(back(bytes(bad), texts['text']))
except lzma.LZMAError as e: print('LZMAError', e)
