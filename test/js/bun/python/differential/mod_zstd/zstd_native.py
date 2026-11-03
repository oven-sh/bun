import _zstd
from compression import zstd   # sets the parameter types
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:150] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
names = sorted(n for n in dir(_zstd) if not n.startswith('__'))
print(names)
print({n: getattr(_zstd, n) for n in names if n.startswith('ZSTD_')})
print(type(_zstd.zstd_version), type(_zstd.zstd_version_number), _zstd.zstd_version_number >= 10500)
C, D, Z, E = _zstd.ZstdCompressor, _zstd.ZstdDecompressor, _zstd.ZstdDict, _zstd.ZstdError
print(E.__mro__, E.__module__, E.__name__, E.__doc__)
for T in (C, D, Z):
    print(T, T.__mro__, T.__module__, T.__qualname__, [(n, type(v).__name__) for n, v in sorted(T.__dict__.items()) if n not in ('__doc__', '__module__')])
    def sub():
        class S(T): pass
    t(sub)
    def st(): T.x = 1
    t(st)
print(C.CONTINUE, C.FLUSH_BLOCK, C.FLUSH_FRAME)
data = b''.join(b'%d: all work and no play makes jack a dull boy\n' % i for i in range(3000))

def dec(b, **k):
    return D(**k).decompress(b)

# Compressor
c = C(); print(c.last_mode)
x = c.compress(data); print(type(x), c.last_mode); y = c.flush(); print(c.last_mode, dec(x + y) == data)
for level in (-100, -1, 0, 1, 3, 10, 19, 22):
    c = C(level); print(level, dec(c.compress(data, C.FLUSH_FRAME)) == data, c.last_mode)
c = C(level=5); parts = [c.compress(data[i:i + 1000]) for i in range(0, len(data), 1000)] + [c.flush()]; print(dec(b''.join(parts)) == data)
c = C(); d = D()
for i in range(4):
    piece = b'piece %d ' % i * 50
    print(d.decompress(c.compress(piece, C.FLUSH_BLOCK)) == piece, c.last_mode, d.eof, d.needs_input)
print(d.decompress(c.flush()), d.eof, d.needs_input, c.last_mode)
c = C(); a = c.compress(b'one', C.FLUSH_FRAME); b = c.compress(b'two', C.FLUSH_FRAME); print(dec(a), dec(b), c.flush(), c.flush(C.FLUSH_BLOCK), c.compress(b''), c.last_mode)
for src in (bytearray(data), memoryview(data), memoryview(data)[5:500]):
    print(dec(C().compress(src, 2)) == bytes(src))
t(C, 1, {}); t(C, 'a'); t(C, 1.0); t(C, 23); t(C, -2**17 - 1); t(C, 2**40); t(C, -2**70); t(C, True); t(C, None, None, None); t(C, 1, None, None, 4); t(C, x=1); t(C, level=1, options={1: 2}); t(C, options=5); t(C, options=[]); t(C, options='a'); t(C, zstd_dict=5); t(C, zstd_dict=b'abc'); t(C, zstd_dict=(1, 2))
P, Q = zstd.CompressionParameter, zstd.DecompressionParameter
t(C, options={P.compression_level: 5}); t(C, options={P.compression_level: 100}); t(C, options={P.window_log: 100}); t(C, options={P.window_log: 20, P.checksum_flag: 1, P.content_size_flag: 0}); t(C, options={Q.window_log_max: 20}); t(C, options={12345: 1}); t(C, options={'a': 1}); t(C, options={100: 'a'}); t(C, options={2**40: 1}); t(C, options={100: 2**40}); t(C, options={P.strategy: 99}); t(C, options={P.nb_workers: -1}); t(C, options={100: 1.5}); t(C, options={})
c = C(); t(c.compress); t(c.compress, 'a'); t(c.compress, 1); t(c.compress, b'', 3); t(c.compress, b'', -1); t(c.compress, b'', 'a'); t(c.compress, b'', 0, 0); t(c.compress, data=b'', mode=2); t(c.compress, x=1); t(c.compress, b'', 2**40)
t(c.flush, 0); t(c.flush, 3); t(c.flush, 'a'); t(c.flush, 1, 1); t(c.flush, mode=1); t(c.flush, x=1)
def sl(): c.last_mode = 1
t(sl)
def sx(): c.x = 1
t(sx)
# The pledged size
c = C(); t(c.set_pledged_input_size, len(data)); x = c.compress(data, 2); print(_zstd.get_frame_info(x), dec(x) == data)
c = C(); x = c.compress(data) + c.flush(); print(_zstd.get_frame_info(x))
c = C(); x = c.compress(data, 2); print(_zstd.get_frame_info(x))
c = C(); c.set_pledged_input_size(10); t(c.compress, b'12345', 2); print(c.last_mode); t(c.compress, b'1234567890', 2)
c = C(); c.set_pledged_input_size(3); t(c.compress, b'12345'); t(c.flush)
c = C(); c.set_pledged_input_size(None); print(_zstd.get_frame_info(c.compress(b'abc') + c.flush()))
c = C(); t(c.set_pledged_input_size); t(c.set_pledged_input_size, -1); t(c.set_pledged_input_size, 2**64); t(c.set_pledged_input_size, 2**64 - 1); t(c.set_pledged_input_size, 2**64 - 2); t(c.set_pledged_input_size, 2**64 - 3); t(c.set_pledged_input_size, 'a'); t(c.set_pledged_input_size, 1.0); t(c.set_pledged_input_size, size=1); t(c.set_pledged_input_size, 0)
c = C(); c.compress(b'a'); t(c.set_pledged_input_size, 5); c.flush(1); t(c.set_pledged_input_size, 5); c.flush(); t(c.set_pledged_input_size, 5)
# Threads
c = C(options={P.nb_workers: 2}); parts = [c.compress(data[i:i + 10000]) for i in range(0, len(data), 10000)] + [c.flush()]; print(dec(b''.join(parts)) == data, c.last_mode)
c = C(options={P.nb_workers: 2, P.job_size: 1 << 20}); big = data * 40; print(dec(c.compress(big) + c.flush()) == big)
c = C(options={P.nb_workers: 1}); print(dec(c.compress(data, 1) + c.compress(data, 2)) == data * 2)

# Functions
x = C().compress(data, 2)
t(_zstd.get_frame_size, x); print(_zstd.get_frame_size(x) == len(x), _zstd.get_frame_size(x + b'junk') == len(x), _zstd.get_frame_size(frame_buffer=x + x) == len(x))
t(_zstd.get_frame_size, x[:-1]); t(_zstd.get_frame_size, b''); t(_zstd.get_frame_size, b'abcdefgh'); t(_zstd.get_frame_size, 'a'); t(_zstd.get_frame_size); t(_zstd.get_frame_size, x, 1)
t(_zstd.get_frame_info, x); t(_zstd.get_frame_info, x[:10]); t(_zstd.get_frame_info, x[:3]); t(_zstd.get_frame_info, b''); t(_zstd.get_frame_info, b'abcdefghijklmnopqrstuvwxyz'); t(_zstd.get_frame_info, 5); t(_zstd.get_frame_info)
for p in P:
    lo, hi = _zstd.get_param_bounds(p, True); print(p.name, int(p), lo <= hi, type(lo), p.bounds() == (lo, hi))
print(_zstd.get_param_bounds(100, True), _zstd.get_param_bounds(101, True), _zstd.get_param_bounds(107, True), _zstd.get_param_bounds(200, is_compress=True), _zstd.get_param_bounds(parameter=100, is_compress=False))
t(_zstd.get_param_bounds, 1, True); t(_zstd.get_param_bounds, 1, False); t(_zstd.get_param_bounds, 'a', True); t(_zstd.get_param_bounds, 100); t(_zstd.get_param_bounds); t(_zstd.get_param_bounds, 2**40, 1)
t(_zstd.set_parameter_types, 1, 2); t(_zstd.set_parameter_types, int, 2); t(_zstd.set_parameter_types); t(_zstd.set_parameter_types, int)
