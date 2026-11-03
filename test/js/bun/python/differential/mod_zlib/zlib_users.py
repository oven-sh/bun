# The modules of the standard library that are built on zlib.
import io, os, sys, tempfile, shutil
import gzip, zipfile, tarfile, zlib

data = b''.join(b'%d: the quick brown fox jumps over the lazy dog\n' % i for i in range(2000))

# gzip
c = gzip.compress(data, mtime=0)
print(c[:4].hex(), gzip.decompress(c) == data, gzip.decompress(c + c) == data + data)
for level in (0, 1, 9):
    print(level, gzip.decompress(gzip.compress(data, level)) == data)
buf = io.BytesIO()
with gzip.GzipFile(fileobj=buf, mode='wb', mtime=12345, filename='name.txt') as f:
    print(f.write(data[:1000]), f.write(data[1000:]), f.tell())
buf.seek(0)
with gzip.GzipFile(fileobj=buf) as f:
    print(f.read(10), f.readline(), f.tell(), f.mtime, f.seek(5000), f.read(20), f.seek(0), len(f.read()), f.read())
buf.seek(0)
with gzip.open(buf, 'rt', encoding='ascii') as f:
    lines = f.readlines(); print(len(lines), lines[-1])
try:
    gzip.decompress(c[:-4])
except EOFError as e:
    print('EOFError', e)
try:
    gzip.decompress(b'not gzip data')
except gzip.BadGzipFile as e:
    print('BadGzipFile', e)
bad = bytearray(c); bad[-5] ^= 1
try:
    gzip.decompress(bytes(bad))
except gzip.BadGzipFile as e:
    print('BadGzipFile', str(e)[:16])

d = tempfile.mkdtemp()
try:
    p = os.path.join(d, 'x.gz')
    with gzip.open(p, 'wb') as f: f.write(data)
    with gzip.open(p, 'ab') as f: f.write(b'more')
    with gzip.open(p) as f: print(f.read() == data + b'more')

    # zipfile
    z = os.path.join(d, 'a.zip')
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('one.txt', data)
        zf.writestr('dir/two.txt', b'two', compress_type=zipfile.ZIP_STORED)
        zf.writestr(zipfile.ZipInfo('three.bin', (2020, 1, 2, 3, 4, 6)), bytes(100000), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        zf.writestr('mod.py', 'value = 6 * 7\ndef f():\n    return "from the zip"\n')
        zf.writestr('pkg/__init__.py', 'from . import sub\n')
        zf.writestr('pkg/sub.py', 'name = __name__\n')
    print(zipfile.is_zipfile(z))
    with zipfile.ZipFile(z) as zf:
        print(zf.namelist(), zf.testzip())
        for i in zf.infolist():
            print(i.filename, i.file_size, i.compress_type, i.compress_size < i.file_size or i.compress_type == 0, hex(i.CRC))
        print(zf.read('one.txt') == data, zf.read('dir/two.txt'), zf.read('three.bin') == bytes(100000))
        with zf.open('one.txt') as f:
            print(f.readline(), f.read(5), f.seek(100), f.read(5))
        zf.extractall(os.path.join(d, 'out'))
    print(sorted(os.listdir(os.path.join(d, 'out'))), open(os.path.join(d, 'out', 'dir', 'two.txt')).read())
    print([str(x.name) for x in zipfile.Path(z).iterdir()])

    # tarfile
    for mode in ('w', 'w:gz'):
        t = os.path.join(d, 'a.tar' + mode[2:])
        with tarfile.open(t, mode) as tf:
            info = tarfile.TarInfo('hello.txt'); info.size = len(data); info.mtime = 1000
            tf.addfile(info, io.BytesIO(data))
            tf.add(os.path.join(d, 'out', 'dir'), arcname='dir')
        with tarfile.open(t) as tf:
            print(mode, tf.getnames(), tf.extractfile('hello.txt').read() == data, tf.getmember('hello.txt').mtime, tf.extractfile('dir/two.txt').read())
            tf.extractall(os.path.join(d, 'tout' + mode[2:]), filter='data')
        print(sorted(os.listdir(os.path.join(d, 'tout' + mode[2:]))))
    print(tarfile.is_tarfile(t))
    with tarfile.open(t, 'r|gz') as tf:
        print([m.name for m in tf])

    # shutil's archives
    base = shutil.make_archive(os.path.join(d, 'arch'), 'gztar', os.path.join(d, 'out'))
    print(os.path.basename(base)); shutil.unpack_archive(base, os.path.join(d, 'un')); print(sorted(os.listdir(os.path.join(d, 'un'))))
    base = shutil.make_archive(os.path.join(d, 'arch'), 'zip', os.path.join(d, 'out'))
    print(os.path.basename(base)); shutil.unpack_archive(base, os.path.join(d, 'un2')); print(sorted(os.listdir(os.path.join(d, 'un2'))))
    print(sorted(n for n, _ in shutil.get_archive_formats() if n in ('gztar', 'tar', 'zip')))
finally:
    shutil.rmtree(d)
import codecs, binascii
print(codecs.decode(codecs.encode(data, 'zlib'), 'zlib') == data, binascii.crc32(data) == zlib.crc32(data))
