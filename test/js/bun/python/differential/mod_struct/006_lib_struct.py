import struct, sys

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__module__ + "." + type(e).__name__, e)

print(sorted(struct.__all__), struct.error.__module__, struct.Struct.__module__, struct.pack.__module__, struct.pack.__name__)
print(struct.pack("<hhl", 1, 2, 3), struct.unpack("<hhl", b"\x01\x00\x02\x00\x03\x00\x00\x00"), struct.calcsize("<hhl"), struct.calcsize("@lhl"))
record = b"raymond   \x32\x12\x08\x01\x08"
print(struct.unpack("<10sHHb", record))
print(struct.pack("@ci", b"#", 0x12131415), struct.pack("@ic", 0x12131415, b"#"), struct.calcsize("@ci"), struct.calcsize("@ic"), struct.pack("@llh0l", 1, 2, 3))
print(struct.pack(">h", 1023), struct.pack("<h", 1023), struct.pack("!I", 0xdeadbeef), struct.pack("=Q", 2 ** 64 - 1))
s = struct.Struct("!HH4s"); p = s.pack(1, 2, b"ab"); print(p, s.unpack(p), s.size, s.format)
t(lambda: struct.pack("h", 99999)); t(lambda: struct.unpack("h", b"a")); t(lambda: struct.pack("hh", 1))
try:
    struct.pack("B", 256)
except struct.error as e:
    print("caught", e)
buf = bytearray(12); struct.pack_into(">IHH", buf, 2, 1, 2, 3); print(buf, struct.unpack_from(">IHH", buf, 2), list(struct.iter_unpack(">H", buf)))
struct._clearcache(); print(struct.calcsize("P") == struct.calcsize("n") == 8, sys.byteorder)
print(type(struct.__doc__).__name__)
from collections import namedtuple
Student = namedtuple("Student", "name serialnum school gradelevel")
print(Student._make(struct.unpack("<10sHHb", record)))
