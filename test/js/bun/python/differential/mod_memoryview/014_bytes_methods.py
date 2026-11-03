# bytes and bytearray take a memoryview wherever they take bytes.
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
M = memoryview
for make in (bytes, bytearray):
    s = make(b'hello world hello')
    print(make.__name__)
    t(lambda: s.find(M(b'world'))); t(lambda: s.rfind(M(b'hello'))); t(lambda: s.index(M(b'o w'))); t(lambda: s.rindex(M(b'l'))); t(lambda: s.count(M(b'l')))
    t(lambda: s.startswith(M(b'hello'))); t(lambda: s.endswith(M(b'hello'))); t(lambda: s.startswith((M(b'x'), M(b'he')))); t(lambda: s.endswith((M(b'x'),)))
    t(lambda: s.replace(M(b'hello'), M(b'bye'))); t(lambda: s.replace(M(b'l'), M(b''), 2)); t(lambda: s.split(M(b' '))); t(lambda: s.rsplit(M(b' '), 1)); t(lambda: [bytes(x) for x in s.partition(M(b' '))]); t(lambda: [type(x).__name__ for x in s.rpartition(M(b' '))])
    t(lambda: s.strip(M(b'ho'))); t(lambda: s.lstrip(M(b'he'))); t(lambda: s.rstrip(M(b'lo'))); t(lambda: s.removeprefix(M(b'hello '))); t(lambda: s.removesuffix(M(b' hello')))
    t(lambda: s.translate(M(bytes(range(255, -1, -1))))[:3]); t(lambda: s.translate(None, M(b'l'))); t(lambda: make.maketrans(M(b'ab'), M(b'xy'))[96:100])
    t(lambda: make(b', ').join([M(b'a'), b'b', bytearray(b'c'), M(bytearray(b'd'))])); t(lambda: make(b'').join((M(b'ab')[::-1][::-1],))); t(lambda: make(b'-').join(iter([M(b'a'), M(b'b')])))
    t(lambda: s + M(b'!')); t(lambda: M(b'!') + s); t(lambda: M(b'h') in s); t(lambda: M(b'z') in s); t(lambda: s == M(s)); t(lambda: s != M(s)); t(lambda: M(s) == s); t(lambda: s < M(b'z')); t(lambda: s % ()); t(lambda: make(b'%b|%s') % (M(b'x'), M(b'y')))
    t(lambda: make(M(b'abc'))); t(lambda: make(M(b'abcdef')[::2])); t(lambda: make(M(b'abcd').cast('h'))); t(lambda: make(M(b'abcdef').cast('B', (2, 3)))); t(lambda: make(M(b'abcdef').cast('B', (2, 3))[::-1])); t(lambda: make(M(b'a').cast('B', ()))); t(lambda: make.fromhex(M(b'6162'))); t(lambda: make(M(b'abc'), 'utf8'))
    t(lambda: s.center(21, M(b'*'))); t(lambda: s.ljust(19, M(b'*'))); t(lambda: s.hex(M(b':')))
    for bad in (M(b'abcdef')[::2], M(b'abcd').cast('B', (2, 2))[::-1]):
        t(lambda: s.find(bad)); t(lambda: s + bad); t(lambda: make(b'').join([bad])); t(lambda: s.startswith(bad)); t(lambda: s.replace(bad, b'')); t(lambda: s.split(bad)); t(lambda: s.strip(bad)); t(lambda: bad in s); t(lambda: s == bad); t(lambda: s.startswith((bad,)))
    t(lambda: s.find(M(b'll\0\0').cast('h'))); t(lambda: s + M(b'ab').cast('h')); t(lambda: s + M(b'abcd').cast('B', (2, 2)))
b = bytearray(b'abc')
b += M(b'def'); print(b)
b.extend(M(b'gh')); print(b)
b[1:3] = M(b'XYZ'); print(b)
b[::2] = M(b'12345')[:len(b[::2])]; print(b)
b[0:0] = M(b'abcdef')[::2]; print(b)
b.extend(M(b'abcd').cast('h')); print(b)
t(lambda: b.extend(M(b'abcdef')[::2]))
def iadd(x):
    global b
    b += x
    return b
t(lambda: iadd(M(b'abcdef')[::2]))
t(lambda: iadd(M(b)))
t(lambda: b.extend(M(b)))
def sl(x): b[:] = x; return b
t(lambda: sl(M(b)))
t(lambda: sl(M(b)[::-1]))
t(lambda: sl(M(bytes(b))[::-1]))
t(lambda: b.__init__(M(b'new'))); print(b)
t(lambda: b.__init__(M(b)))
print(b)
# elsewhere
t(lambda: str(M(b'abc'), 'ascii')); t(lambda: str(M(b'abc'))[:11]); t(lambda: int(M(b'42'))); t(lambda: int(M(b'42'), 16)); t(lambda: float(M(b'1.5'))); t(lambda: int.from_bytes(M(b'\x01\x02'), 'big')); t(lambda: ord(M(b'a'))); t(lambda: eval(M(b'1+1'))); t(lambda: compile(M(b'2+2'), 'f', 'eval').co_filename); t(lambda: b'abc'.decode() == bytes(M(b'abc')).decode()); t(lambda: M(b'abc').decode); t(lambda: complex(M(b'1'))); t(lambda: hash(M(b'abc')) == hash(b'abc')); t(lambda: bytes(M(b'abc')).upper()); t(lambda: 'x'.join([M(b'a')])); t(lambda: 'abc'.encode().find(M(b'c'))); t(lambda: len(M(b'abc')) + len(b'abc')); t(lambda: list(zip(M(b'ab'), b'ab'))); t(lambda: any(M(b'\0\0'))); t(lambda: all(M(b'\1\1'))); t(lambda: max(M(b'abc'))); t(lambda: bytes(reversed(M(b'abc')))); t(lambda: bytes(sorted(M(b'cab')))); t(lambda: set(M(b'aab')) == {97, 98}); t(lambda: dict.fromkeys(M(b'ab'))); t(lambda: '%s' % M(b'a').tobytes()); t(lambda: format(M(b'a'), '')[:10]); t(lambda: format(M(b'a'), 'x'))
import copy, pickle
t(lambda: copy.copy(M(b'a'))); t(lambda: copy.deepcopy(M(b'a'))); t(lambda: pickle.dumps(M(b'a'))); t(lambda: M(b'a').__reduce__()); t(lambda: M(b'a').__reduce_ex__(2)); t(lambda: M(b'a').__reduce_ex__(5)); t(lambda: M(b'a').__getstate__())
