# The parts of the standard library that stand on _lzma.
import lzma, fileinput, io, os, shutil, tarfile, tempfile, zipfile, hashlib
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
lines = [b'line %d of the file\n' % i for i in range(3000)]
data = b''.join(lines)
RAW = [{'id': lzma.FILTER_DELTA, 'dist': 3}, {'id': lzma.FILTER_LZMA2, 'preset': 1}]
with tempfile.TemporaryDirectory() as tmp:
    os.chdir(tmp)
    # LZMAFile
    with lzma.LZMAFile('a.xz', 'w', preset=1) as f:
        print(f.writable(), f.readable(), f.seekable(), f.write(data), f.tell(), f.mode, f.name); f.writelines(lines[:3])
    with lzma.LZMAFile('a.xz') as f:
        print(f.readable(), f.seekable(), f.read(10), f.tell(), f.readline(), f.peek(5)[:5], f.read1(7), len(f.readlines()), f.read(), f.tell())
        print(f.seek(100), f.read(20), f.seek(-30, 2), f.read(), f.seek(5, 0), f.seek(5, 1), f.read(4)); b = bytearray(9); print(f.readinto(b), b)
        t(f.write, b'x'); t(f.seek, 0, 9); print(f.fileno() > 2, f.closed)
    t(f.read); print(f.closed)
    with lzma.LZMAFile('a.xz', 'a', preset=0) as f: f.write(b'appended\n')
    with lzma.open('a.xz') as f: whole = f.read(); print(len(whole), whole[-20:])
    t(lzma.LZMAFile, 'a.xz', 'x'); t(lzma.LZMAFile, 'a.xz', 'rw'); t(lzma.LZMAFile, 'a.xz', 'w', preset=10); t(lzma.LZMAFile, 5.5); t(lzma.LZMAFile, 'missing.xz')
    t(lzma.LZMAFile, 'a.xz', 'r', check=1); t(lzma.LZMAFile, 'a.xz', 'r', preset=1); t(lzma.LZMAFile, 'a.xz', 'r', format=lzma.FORMAT_RAW); t(lzma.LZMAFile, 'b.xz', 'w', format=lzma.FORMAT_AUTO); t(lzma.LZMAFile, 'b.xz', 'w', format=lzma.FORMAT_RAW)
    for fmt, kw in ((lzma.FORMAT_XZ, {'check': lzma.CHECK_SHA256}), (lzma.FORMAT_ALONE, {'preset': 2}), (lzma.FORMAT_RAW, {'filters': RAW}), (lzma.FORMAT_XZ, {'filters': RAW})):
        with lzma.open('f.bin', 'wb', format=fmt, **kw) as f: f.write(data)
        rk = {'filters': RAW} if fmt == lzma.FORMAT_RAW else {}
        with lzma.open('f.bin', 'rb', format=fmt, **rk) as f: print(fmt, f.read() == data)
        if fmt != lzma.FORMAT_RAW:
            with lzma.open('f.bin') as f: print(f.read(30))
    with lzma.open('t.xz', 'wt', encoding='utf-8', newline='\n') as f: print(f.write('héllo\nwörld\n'))
    with lzma.open('t.xz', 'rt', encoding='utf-8') as f: print(list(f))
    t(lzma.open, 't.xz', 'rbt'); t(lzma.open, 't.xz', 'rb', encoding='utf-8'); t(lzma.open, 't.xz', 'rb', errors='x'); t(lzma.open, 't.xz', 'rb', newline='\n')
    raw = io.BytesIO()
    with lzma.LZMAFile(raw, 'w', preset=0) as f: f.write(data)
    print(lzma.decompress(raw.getvalue()) == data, raw.closed)
    with lzma.LZMAFile(io.BytesIO(raw.getvalue() * 3)) as f: print(f.read() == data * 3)
    with lzma.LZMAFile(io.BytesIO(raw.getvalue() + b'\0' * 12 + raw.getvalue())) as f: print(f.read() == data * 2)
    with lzma.LZMAFile(io.BytesIO(raw.getvalue() + b'trailing junk')) as f: t(lambda: f.read() == data)
    with lzma.LZMAFile(io.BytesIO(raw.getvalue()[:-5])) as f: t(f.read)
    with lzma.LZMAFile(io.BytesIO(b'not xz at all, no')) as f: t(f.read)
    with lzma.LZMAFile(io.BytesIO(raw.getvalue())) as f: print(sum(1 for line in f), f.tell())
    # tarfile
    os.mkdir('tree'); os.mkdir('tree/sub')
    for name, body in (('tree/a.txt', data), ('tree/sub/b.bin', bytes(range(256)) * 100), ('tree/empty', b'')):
        with open(name, 'wb') as f: f.write(body)
    def plain(info): info.mtime = 0; info.uid = info.gid = 0; info.uname = info.gname = ''; info.mode &= 0o777; return info
    for mode in ('w:xz', 'w|xz', 'x:xz'):
        name = 'out-%s%s.tar.xz' % (mode[0], {':': 'c', '|': 'p'}[mode[1]])
        with tarfile.open(name, mode) as tf: tf.add('tree', filter=plain)
        for rmode in ('r', 'r:*', 'r:xz', 'r|*', 'r|xz'):
            with tarfile.open(name, rmode) as tf: print(mode, rmode, [(m.name, m.size, m.type) for m in tf], end=' ')
            with tarfile.open(name, rmode) as tf:
                for m in tf:
                    if m.isreg(): print(hashlib.sha1(tf.extractfile(m).read()).hexdigest()[:8], end=' ')
            print()
        for rmode in ('r:gz', 'r:bz2', 'r:', 'r|gz', 'r|bz2', 'r:zst'): t(tarfile.open, name, rmode)
        print(tarfile.is_tarfile(name))
    with tarfile.open('lvl.tar.xz', 'w:xz', preset=9 | lzma.PRESET_EXTREME) as tf: tf.add('tree/empty', filter=plain)
    print(open('lvl.tar.xz', 'rb').read(6)); t(tarfile.open, 'bad.tar.xz', 'w:xz', preset=10)
    with tarfile.open('out-wc.tar.xz') as tf: tf.extractall('x1', filter='data')
    print(sorted(os.path.join(r, n)[3:] for r, ds, ns in os.walk('x1') for n in ns + ds), open('x1/tree/a.txt', 'rb').read() == data)
    # zipfile: raw LZMA1 behind a header of its own
    with zipfile.ZipFile('z.zip', 'w', zipfile.ZIP_LZMA) as z:
        z.writestr(zipfile.ZipInfo('a.txt'), data); z.writestr(zipfile.ZipInfo('b.bin'), bytes(1000)); z.writestr(zipfile.ZipInfo('e'), b'')
        with z.open(zipfile.ZipInfo('s.txt'), 'w') as f:
            for line in lines: f.write(line)
    with zipfile.ZipFile('z.zip') as z:
        print([(i.filename, i.compress_type, i.file_size, i.extract_version, i.create_version, i.flag_bits) for i in z.infolist()], z.testzip())
        print(z.read('a.txt') == data, z.read('s.txt') == data, z.read('b.bin') == bytes(1000), z.read('e'))
        with z.open('a.txt') as f: print(f.read(10), f.readline(), f.seek(500), f.read(10), f.seek(0), f.read(4), f.seekable())
    blob = open('z.zip', 'rb').read(); print(blob[35:44])
    bad = bytearray(blob); bad[70] ^= 0xff
    with zipfile.ZipFile(io.BytesIO(bytes(bad))) as z: t(lambda: type(z.read('a.txt')))
    # shutil
    print(os.path.basename(shutil.make_archive('made', 'xztar', 'tree'))); shutil.unpack_archive('made.tar.xz', 'x2'); print(sorted(os.listdir('x2')), open('x2/a.txt', 'rb').read() == data)
    shutil.unpack_archive('made.tar.xz', 'x3', 'xztar'); print(sorted(os.listdir('x3/sub')))
    os.chdir('/')
