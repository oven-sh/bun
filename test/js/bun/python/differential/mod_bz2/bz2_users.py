# The parts of the standard library that stand on _bz2.
import bz2, codecs, fileinput, io, os, shutil, tarfile, tempfile, zipfile, hashlib
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
lines = [b'line %d of the file\n' % i for i in range(3000)]
data = b''.join(lines)
with tempfile.TemporaryDirectory() as tmp:
    os.chdir(tmp)
    # BZ2File
    with bz2.BZ2File('a.bz2', 'w', compresslevel=5) as f:
        print(f.writable(), f.readable(), f.seekable(), f.write(data), f.tell(), f.mode, f.name); f.writelines(lines[:3])
    print(os.path.getsize('a.bz2'), hashlib.sha1(open('a.bz2', 'rb').read()).hexdigest())
    with bz2.BZ2File('a.bz2') as f:
        print(f.readable(), f.seekable(), f.read(10), f.tell(), f.readline(), f.peek(5)[:5], f.read1(7), len(f.readlines()), f.read(), f.tell())
        print(f.seek(100), f.read(20), f.seek(-30, 2), f.read(), f.seek(5, 0), f.seek(5, 1), f.read(4)); b = bytearray(9); print(f.readinto(b), b)
        t(f.write, b'x'); t(f.seek, 0, 9); print(f.fileno() > 2, f.closed)
    t(f.read); print(f.closed)
    with bz2.BZ2File('a.bz2', 'a') as f: f.write(b'appended\n')
    with bz2.open('a.bz2') as f: whole = f.read(); print(len(whole), whole[-20:])
    t(bz2.BZ2File, 'a.bz2', 'x'); t(bz2.BZ2File, 'a.bz2', 'rw'); t(bz2.BZ2File, 'a.bz2', 'w', compresslevel=0); t(bz2.BZ2File, 5.5); t(bz2.BZ2File, 'missing.bz2')
    with bz2.open('t.bz2', 'wt', encoding='utf-8', newline='\n') as f: print(f.write('héllo\nwörld\n'))
    with bz2.open('t.bz2', 'rt', encoding='utf-8') as f: print(list(f))
    t(bz2.open, 't.bz2', 'rbt'); t(bz2.open, 't.bz2', 'rb', encoding='utf-8'); t(bz2.open, 't.bz2', 'rb', errors='x'); t(bz2.open, 't.bz2', 'rb', newline='\n')
    raw = io.BytesIO()
    with bz2.BZ2File(raw, 'w') as f: f.write(data)
    print(bz2.decompress(raw.getvalue()) == data, raw.closed)
    with bz2.BZ2File(io.BytesIO(raw.getvalue() * 3)) as f: print(f.read() == data * 3)
    with bz2.BZ2File(io.BytesIO(raw.getvalue() + b'trailing junk')) as f: print(f.read() == data)
    with bz2.BZ2File(io.BytesIO(raw.getvalue()[:-5])) as f: t(f.read)
    with bz2.BZ2File(io.BytesIO(b'not bzip2 at all')) as f: t(f.read)
    with bz2.BZ2File(io.BytesIO(raw.getvalue())) as f: print(sum(1 for line in f), f.tell())
    # tarfile
    os.mkdir('tree'); os.mkdir('tree/sub')
    for name, body in (('tree/a.txt', data), ('tree/sub/b.bin', bytes(range(256)) * 100), ('tree/empty', b'')):
        with open(name, 'wb') as f: f.write(body)
    def plain(info): info.mtime = 0; info.uid = info.gid = 0; info.uname = info.gname = ''; info.mode &= 0o777; return info
    for mode in ('w:bz2', 'w|bz2', 'x:bz2'):
        name = 'out-%s%s.tar.bz2' % (mode[0], {':': 'c', '|': 'p'}[mode[1]])
        with tarfile.open(name, mode) as tf: tf.add('tree', filter=plain)
        for rmode in ('r', 'r:*', 'r:bz2', 'r|*', 'r|bz2'):
            with tarfile.open(name, rmode) as tf: print(mode, rmode, [(m.name, m.size, m.type) for m in tf], end=' ')
            with tarfile.open(name, rmode) as tf:
                for m in tf:
                    if m.isreg(): print(hashlib.sha1(tf.extractfile(m).read()).hexdigest()[:8], end=' ')
            print()
        for rmode in ('r:gz', 'r:xz', 'r:', 'r|gz', 'r|xz', 'r:zst'): t(tarfile.open, name, rmode)
        print(tarfile.is_tarfile(name))
    with tarfile.open('lvl.tar.bz2', 'w:bz2', compresslevel=1) as tf: tf.add('tree', filter=plain)
    print(open('lvl.tar.bz2', 'rb').read(4)); t(tarfile.open, 'bad.tar.bz2', 'w:bz2', compresslevel=0)
    with tarfile.open('out-wc.tar.bz2') as tf: tf.extractall('x1', filter='data')
    print(sorted(os.path.join(r, n)[3:] for r, ds, ns in os.walk('x1') for n in ns + ds), open('x1/tree/a.txt', 'rb').read() == data)
    # zipfile
    with zipfile.ZipFile('z.zip', 'w', zipfile.ZIP_BZIP2) as z:
        z.writestr(zipfile.ZipInfo('a.txt'), data); z.writestr(zipfile.ZipInfo('b.bin'), bytes(1000), compresslevel=1); z.writestr(zipfile.ZipInfo('e'), b'')
        with z.open(zipfile.ZipInfo('s.txt'), 'w') as f:
            for line in lines: f.write(line)
    print(hashlib.sha1(open('z.zip', 'rb').read()).hexdigest())
    with zipfile.ZipFile('z.zip') as z:
        print([(i.filename, i.compress_type, i.file_size, i.compress_size, i.extract_version, i.create_version) for i in z.infolist()], z.testzip())
        print(z.read('a.txt') == data, z.read('s.txt') == data, z.read('b.bin') == bytes(1000), z.read('e'))
        with z.open('a.txt') as f: print(f.read(10), f.readline(), f.seek(500), f.read(10), f.seek(0), f.read(4), f.seekable())
    blob = bytearray(open('z.zip', 'rb').read()); blob[60] ^= 0xff
    with zipfile.ZipFile(io.BytesIO(bytes(blob))) as z: t(z.read, 'a.txt'); t(z.testzip)
    # shutil
    print(sorted(n for n, d in shutil.get_archive_formats()), sorted((n, e) for n, e, d in shutil.get_unpack_formats()))
    print(os.path.basename(shutil.make_archive('made', 'bztar', 'tree'))); shutil.unpack_archive('made.tar.bz2', 'x2'); print(sorted(os.listdir('x2')), open('x2/a.txt', 'rb').read() == data)
    shutil.unpack_archive('made.tar.bz2', 'x3', 'bztar'); print(sorted(os.listdir('x3/sub')))
    # codecs
    e = codecs.encode(data, 'bz2'); print(e == bz2.compress(data), codecs.decode(e, 'bz2_codec') == data, codecs.lookup('bz2').name, codecs.lookup('bz2')._is_text_encoding)
    t(data.decode, 'bz2'); t('x'.encode, 'bz2'); t(codecs.decode, b'junk', 'bz2'); t(codecs.encode, 'x', 'bz2'); t(codecs.encode, data, 'bz2', 'ignore')
    inc = codecs.getincrementalencoder('bz2')(); parts = [inc.encode(l) for l in lines] + [inc.encode(b'', True)]; print(bz2.decompress(b''.join(parts)) == data)
    dec = codecs.getincrementaldecoder('bz2')(); print(b''.join(dec.decode(e[i:i + 100]) for i in range(0, len(e), 100)) == data); t(dec.decode, b'x'); dec.reset(); print(dec.decode(e) == data)
    with codecs.open('c.bz2', 'wb', 'bz2') as f: t(f.write, data)
    # fileinput
    with fileinput.input(['a.bz2', 'tree/a.txt'], openhook=fileinput.hook_compressed, encoding='ascii') as f: n = sum(1 for l in f); print(n, f.filename() if False else '')
    with fileinput.input('a.bz2', mode='rb', openhook=fileinput.hook_compressed) as f: print(next(f), f.filelineno())
    os.chdir('/')
