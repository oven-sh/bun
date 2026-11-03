def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

m = memoryview(b"hello")
print(type(m).__name__, len(m), m[0], m[-1], type(m[1:3]).__name__, bytes(m), bytes(m[1:3]), m.tobytes(), m.tolist(), list(m), m.readonly, m.format, m.itemsize, m.ndim, m.shape, m.strides, m.suboffsets, m.nbytes, m.obj, m.c_contiguous, m.f_contiguous, m.contiguous, m.hex(), m.hex(" "), m.hex(":", 2), repr(m)[:11], bool(m), bool(memoryview(b"")), 104 in m, 0 in m, m == b"hello", b"hello" == m, m == memoryview(b"hello"), m != b"x", m == "hello", hash(m) == hash(b"hello"), bytes(m[::-1]), bytes(m[::2]), m[::2].strides, m[::-1].strides, m[::2].contiguous, len(m[::2]), len(m[5:]), bytes(m[-3:]), bytes(m[1:][1:]), max(m), min(m), sum(m), sorted(m), list(reversed(m)), m.count(108), m.index(108), bytes(m).upper(), str(m, "ascii"), bytearray(m), b"-".join([m, m]), b"x" + m, int.from_bytes(m, "big"), m.tobytes("C"), m.tobytes(order="F"))
t(lambda: m[5]); t(lambda: m[-6]); t(lambda: m["a"]); t(lambda: m[1.0]); t(lambda: m.__setitem__(0, 1)); t(lambda: m.__setitem__(slice(0, 1), b"x")); t(lambda: m.__delitem__(0)); t(lambda: m + m); t(lambda: m * 2); t(lambda: m < m); t(lambda: m.nope); t(lambda: m.index(0)); t(lambda: m + b"x"); t(lambda: m.decode()); t(lambda: m.upper()); t(lambda: m[::0]); t(lambda: m[0, 0]); t(lambda: m[()])
for x in (1, "s", None, [1], (1,), 1.5, {}, object(), range(3), {1}):
    t(lambda: memoryview(x))
t(lambda: memoryview()); t(lambda: memoryview(b"a", b"b")); t(lambda: memoryview(object=b"kw").tobytes()); t(lambda: type("X", (memoryview,), {}))
# Writable views share memory with the object.
ba = bytearray(b"abcdef"); w = memoryview(ba)
print(w.readonly, w.obj is ba); w[0] = 65; w[-1] = 0x46; print(ba); w[1:3] = b"XY"; print(ba); w[::2] = b"___"; print(ba); ba[1] = 48; print(w[1], bytes(w)); sub = w[2:5]; sub[0] = 33; print(ba, bytes(sub), sub.obj is ba); w[3:] = memoryview(b"123"); print(ba); w[0:2] = bytearray(b"zz"); print(ba); w[0:3] = w[3:6]; print(ba); w[1:6] = w[0:5]; print(ba)
t(lambda: w.__setitem__(0, 256)); t(lambda: w.__setitem__(0, -1)); t(lambda: w.__setitem__(0, "a")); t(lambda: w.__setitem__(0, b"a")); t(lambda: w.__setitem__(0, 1.5)); t(lambda: w.__setitem__(slice(0, 2), b"x")); t(lambda: w.__setitem__(slice(0, 2), b"xyz")); t(lambda: w.__setitem__(slice(0, 2), "ab")); t(lambda: w.__setitem__(slice(0, 2), [1, 2])); t(lambda: w.__setitem__(10, 1)); t(lambda: w.__setitem__(slice(0, 1), 5)); t(lambda: hash(w)); t(lambda: w.__delitem__(slice(0, 1)))
# A bytearray cannot be resized while it is exported.
t(lambda: ba.append(1)); t(lambda: ba.extend(b"x")); t(lambda: ba.pop()); t(lambda: ba.clear()); t(lambda: ba.__delitem__(0)); t(lambda: ba.__iadd__(b"x")); t(lambda: ba.insert(0, 1)); t(lambda: ba.__setitem__(slice(0, 1), b"xx")); t(lambda: ba.remove(ba[0])); t(lambda: ba.__imul__(2)); ba[0:1] = b"Q"; ba[0] = 81; ba.reverse(); print(ba, "same-size changes are fine")
sub.release(); w.release(); ba.append(33); print(ba)
# release and the context manager protocol.
r = memoryview(b"abc"); print(r.release(), r.release(), repr(r)[:20])
for f in (lambda: r[0], lambda: len(r), lambda: bytes(r), lambda: r.tobytes(), lambda: r.tolist(), lambda: r.format, lambda: r.shape, lambda: r.obj, lambda: r.nbytes, lambda: r.readonly, lambda: list(r), lambda: r == b"abc", lambda: r == r, lambda: hash(r), lambda: memoryview(r), lambda: r.cast("B"), lambda: r[0:1], lambda: r.hex(), lambda: r.toreadonly(), lambda: r.__enter__(), lambda: 97 in r): t(f)
with memoryview(b"xyz") as cm: print(cm[0], cm.tobytes())
t(lambda: cm[0])
h = memoryview(b"hash me"); hv = hash(h); h.release(); t(lambda: hash(h) == hv)
b2 = bytearray(b"ab")
with memoryview(b2) as v2: t(lambda: b2.append(1))
b2.append(99); print(b2)
outer = memoryview(bytearray(b"abcd")); inner = outer[1:3]; t(outer.release); inner.release(); print(outer.release())
# toreadonly, views of views.
src = bytearray(b"rw"); ro = memoryview(src).toreadonly(); print(ro.readonly, ro[0]); t(lambda: ro.__setitem__(0, 1)); src[0] = 90; print(ro[0], bytes(ro)); mm = memoryview(memoryview(memoryview(b"nest"))); print(bytes(mm), mm.obj); ro.release()
# cast
c = memoryview(bytes(range(8)))
print(c.cast("B").tolist(), c.cast("b").tolist(), c.cast("c").tolist()[:2], c.cast("H").tolist(), c.cast("h").tolist(), c.cast("I").tolist(), c.cast("i").tolist(), c.cast("L").tolist(), c.cast("Q").tolist(), c.cast("q").tolist(), c.cast("H").itemsize, c.cast("H").format, c.cast("H").shape, c.cast("H").strides, len(c.cast("H")), c.cast("H").nbytes, c.cast("I")[1], c.cast("@H").format, c.cast("?").tolist(), c.cast("n").tolist(), c.cast("N").tolist(), c.cast("P").tolist())
print(memoryview(b"\x00\x00\x80\x3f\x00\x00\x00\xc0").cast("f").tolist(), memoryview(b"\x00\x00\x00\x00\x00\x00\xf0\x3f").cast("d").tolist(), memoryview(b"\xff\xff\xff\xff").cast("i").tolist(), memoryview(b"\xff\xff").cast("h")[0], memoryview(b"\xff").cast("b")[0], memoryview(b"\x00\x3c").cast("e").tolist())
print(c.cast("B", (2, 4)).tolist(), c.cast("B", [4, 2]).tolist(), c.cast("B", (2, 2, 2)).tolist(), c.cast("B", (2, 4)).shape, c.cast("B", (2, 4)).strides, c.cast("B", (2, 4)).ndim, len(c.cast("B", (2, 4))), c.cast("B", (2, 4))[1, 2], c.cast("B", (2, 4))[-1, -1], c.cast("H", (2, 2)).tolist(), c.cast("B", (2, 4)).tobytes(), c.cast("B", (2, 4)).cast("B").tolist(), c.cast("B", (8,)).tolist() == list(c), c.cast("B", (2, 4)) == c.cast("B", (2, 4)), c.cast("B", (2, 4)) == c, c.cast("B", (1, 8)).shape, c.cast("B", shape=(8, 1)).shape)
t(lambda: c.cast("H").cast("I")); t(lambda: c.cast("Z")); t(lambda: c.cast("")); t(lambda: c.cast("<H")); t(lambda: c.cast(">I")); t(lambda: c.cast("=H")); t(lambda: c.cast("2B")); t(lambda: c.cast("s")); t(lambda: memoryview(b"abc").cast("H")); t(lambda: c.cast("B", (3, 3))); t(lambda: c.cast("B", (2, -4))); t(lambda: c.cast("B", (0, 8))); t(lambda: c.cast("B", 8)); t(lambda: c.cast("B", ("a",))); t(lambda: c.cast()); t(lambda: c.cast(1)); t(lambda: c[::2].cast("H")); t(lambda: c.cast("B", (2, 4))[0]); t(lambda: c.cast("B", (2, 4))[0:1].tolist()); t(lambda: c.cast("B", (2, 4))[0, 0, 0]); t(lambda: c.cast("B", (2, 4))[2, 0]); t(lambda: c.cast("B", (2, 4))[0, 4]); t(lambda: list(c.cast("B", (2, 4)))); t(lambda: c.cast("B", (2, 4))[0, "a"]); t(lambda: 1 in c.cast("B", (2, 4))); t(lambda: hash(c.cast("H")) ); t(lambda: hash(c.cast("b")) == hash(bytes(c))); t(lambda: c.cast("B", (2, 4))[::2].tolist())
wb = bytearray(8); wc = memoryview(wb).cast("H"); wc[0] = 0x0102; wc[3] = 65535; print(wb, wc.tolist()); t(lambda: wc.__setitem__(0, 65536)); t(lambda: wc.__setitem__(0, -1)); t(lambda: wc.__setitem__(0, 1.5)); wi = memoryview(wb).cast("i"); wi[1] = -2; print(wb); wd = memoryview(wb).cast("d"); wd[0] = 1.5; print(wb, wd[0]); wd[0] = 3; print(wd[0]); t(lambda: wd.__setitem__(0, "x")); wq = memoryview(wb).cast("B", (2, 4)); wq[1, 3] = 7; print(wb); wcc = memoryview(wb).cast("c"); wcc[0] = b"Z"; print(wb[:1]); t(lambda: wcc.__setitem__(0, 90)); t(lambda: wcc.__setitem__(0, b"ab")); wbool = memoryview(wb).cast("?"); wbool[1] = True; wbool[2] = []; print(wb[:3])
for v in (wc, wi, wd, wq, wcc, wbool): v.release()
# Comparison looks at values, not at raw bytes.
print(memoryview(b"\x01\x00").cast("H") == memoryview(b"\x01\x00\x00\x00").cast("I"), memoryview(b"\x01").cast("B") == memoryview(b"\x01").cast("b"), memoryview(b"\xff").cast("B") == memoryview(b"\xff").cast("b"), memoryview(b"\x00\x00\x80\x3f").cast("f") == memoryview(b"\x01\x00\x00\x00").cast("i"), memoryview(b"\x00\x00\xc0\x7f").cast("f") == memoryview(b"\x00\x00\xc0\x7f").cast("f"), memoryview(b"ab") == bytearray(b"ab"), memoryview(b"ab") == memoryview(b"abc")[:2], memoryview(b"ab") == [97, 98], memoryview(b"") == b"", memoryview(b"ab")[::-1] == b"ba")
# Objects that accept any bytes-like argument take memoryviews.
v = memoryview(b"a,b"); print(bytes(v).split(b","), b"a,b,c".startswith(v), b"xa,by".find(v), b"a,b" in b"za,bz", v in [b"a,b"], bytearray(b"x").join([v, v]), b"%s|%b" % (v, v), bytes(v).replace(v[1:2], b";"), int(memoryview(b"42")), float(memoryview(b"1.5")), bytearray(v) + v, b"".join([v[0:1], v[2:3]]), (b"a,b").count(v[0:1]), bytes.fromhex("61").__eq__(v[0:1]), str(v[0:1], "utf-8"), compile(memoryview(b"1+1"), "<m>", "eval").co_filename, eval(memoryview(b"2*3")), [bytes(p) for p in bytes(v).partition(v[1:2])], b"a,b".strip(v[0:1]), bytes(v).translate(None, v[1:2]), bytearray(b"__").__iadd__(v), ord(v[0:1]) if False else "", v[0:1].tobytes().decode())
ex = bytearray(b"12"); ex.extend(memoryview(b"34")); ex[0:0] = memoryview(b"0"); ex += memoryview(b"5")[:]; print(ex)
big = memoryview(bytes(1000)); print(len(big), sum(big), big[500:510].tolist(), big.nbytes, len(big[::7]), big[100:900:100].tolist())
print(memoryview(b"abc").__len__(), memoryview(b"abc").__getitem__(1), memoryview(b"ab").__eq__(b"ab"), memoryview(b"ab").__eq__(1), memoryview(b"abc").__iter__().__next__(), type(iter(memoryview(b"a"))).__name__, memoryview.__name__, memoryview.__module__, sorted(n for n in dir(memoryview) if not n.startswith("_")))
