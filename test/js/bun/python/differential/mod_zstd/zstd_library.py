# compression.zstd, and what else uses it.
import io, os, shutil, tempfile, tarfile, zipfile
from compression import zstd
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:150] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
print(sorted(zstd.__all__), zstd.COMPRESSION_LEVEL_DEFAULT, len(zstd.zstd_version_info), zstd.zstd_version == '.'.join(map(str, zstd.zstd_version_info)))
data = b''.join(b'%d: we are the knights who say ni\n' % i for i in range(5000))
x = zstd.compress(data); print(zstd.decompress(x) == data, zstd.decompress(x + x) == data * 2, zstd.get_frame_info(x), zstd.get_frame_size(x) == len(x))
for level in (-7, 1, 19): print(zstd.decompress(zstd.compress(data, level)) == data)
print(zstd.decompress(zstd.compress(data, options={zstd.CompressionParameter.checksum_flag: True, zstd.CompressionParameter.strategy: zstd.Strategy.btopt})) == data)
t(zstd.decompress, b''); t(zstd.decompress, x[:-3]); t(zstd.decompress, x + b'junk'); t(zstd.decompress, b'junk'); t(zstd.compress, 'a'); t(zstd.compress, data, 100); t(zstd.compress, data, 1, {})
print(zstd.CompressionParameter.compression_level.bounds(), zstd.DecompressionParameter.window_log_max.bounds()[0], list(zstd.Strategy))
samples = [b'sample number %d of the training set, which looks like the others' % i for i in range(1000)]
zd = zstd.train_dict(samples, 2000); print(type(zd).__name__, len(zd.dict_content) <= 2000); zf = zstd.finalize_dict(zd, samples, 3000, 5); print(type(zf).__name__)
print(zstd.decompress(zstd.compress(samples[5], zstd_dict=zd), zstd_dict=zd) == samples[5], zstd.decompress(zstd.compress(samples[5], zstd_dict=zf.as_prefix), zf.as_prefix) == samples[5])
t(zstd.train_dict, [], 100); t(zstd.train_dict, samples, 'a'); t(zstd.train_dict, [b''], 100); t(zstd.finalize_dict, 5, samples, 100, 1)
b = io.BytesIO()
with zstd.ZstdFile(b, 'w', level=5) as f:
    print(f.write(data[:1000]), f.write(data[1000:]), f.tell(), f.flush(), f.writable(), f.readable())
b.seek(0)
with zstd.ZstdFile(b) as f:
    print(f.read(10), f.readline(), f.tell(), f.seek(5000), f.read(20), f.seek(0), len(f.read()), f.read(), f.peek(1), f.seekable())
b.seek(0)
with zstd.open(b, 'rt', encoding='ascii') as f:
    lines = f.readlines(); print(len(lines), lines[-1])
d = tempfile.mkdtemp()
try:
    p = os.path.join(d, 'x.zst')
    with zstd.open(p, 'wb') as f: f.write(data)
    with zstd.open(p, 'ab') as f: f.write(b'more')
    with zstd.open(p) as f: print(f.read() == data + b'more')
    with zstd.open(p, 'rb') as f: print(sum(1 for _ in f))
    tp = os.path.join(d, 'a.tar.zst')
    with tarfile.open(tp, 'w:zst') as tf:
        info = tarfile.TarInfo('hello.txt'); info.size = len(data); tf.addfile(info, io.BytesIO(data))
    with tarfile.open(tp) as tf: print(tf.getnames(), tf.extractfile('hello.txt').read() == data)
    with tarfile.open(tp, 'r|zst') as tf: print([m.name for m in tf])
    zp = os.path.join(d, 'a.zip')
    with zipfile.ZipFile(zp, 'w', zipfile.ZIP_ZSTANDARD) as zf_: zf_.writestr('one.txt', data); zf_.writestr('two.txt', data, compresslevel=19)
    with zipfile.ZipFile(zp) as zf_: print(zf_.testzip(), [(i.filename, i.compress_type, i.compress_size < i.file_size) for i in zf_.infolist()], zf_.read('one.txt') == data, zf_.read('two.txt') == data)
    os.mkdir(os.path.join(d, 'src')); open(os.path.join(d, 'src', 'f.txt'), 'wb').write(data)
    base = shutil.make_archive(os.path.join(d, 'arch'), 'zstdtar', os.path.join(d, 'src')); print(os.path.basename(base)); shutil.unpack_archive(base, os.path.join(d, 'un')); print(os.listdir(os.path.join(d, 'un')))
finally:
    shutil.rmtree(d)
