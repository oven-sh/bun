def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

NoneType = type(None); EllipsisType = type(...); NIType = type(NotImplemented)
print(None, repr(None), str(None), f"{None}", "%s %r" % (None, None), format(None), [None], {None: None}, (None,), bool(None), not None, None is None, None == None, None != None, None == 0, None == False, None == "", None == [], None != 0, hash(None) == hash(None), type(hash(None)).__name__, NoneType, NoneType.__name__, NoneType.__module__, NoneType.__qualname__, NoneType() is None, isinstance(None, NoneType), isinstance(None, object), NoneType.__mro__, NoneType.__bases__, None.__class__, type(None.__doc__).__name__, None.__bool__(), None.__eq__(None), None.__eq__(0), None.__ne__(None), None.__repr__(), None.__hash__() == hash(None), None.__str__(), None.__sizeof__() > 0, None.__reduce__() if False else "", {None: 1}[None], None in [None], None in {None}, [None, None].count(None), [1, None].index(None), None or "default", None and "never", "x" if None else "y", [x for x in (None, 0, 1) if x is not None], sorted([None], key=lambda v: 0), max([None]), list(filter(None, [None, 1])), dict.fromkeys("a"), {}.get("k"), print(end=""), (lambda: None)(), [].append(1), callable(None), id(None) == id(None), None | int, int | None, (None | int).__args__)
for e in ("None + 1", "1 + None", "None + None", "None - 1", "None * 2", "-None", "~None", "None < None", "None < 1", "1 < None", "None <= None", "None > 'a'", "None()", "None[0]", "None.x", "len(None)", "iter(None)", "int(None)", "float(None)", "list(None)", "None in None", "1 in None", "for_ in None", "NoneType(1)", "NoneType(x=1)", "type('X', (NoneType,), {})", "None.__dict__", "setattr(None, 'x', 1)", "delattr(None, 'x')", "setattr(None, '__class__', int)", "[*None]", "{**None}", "print(*None)", "print(**None)", "None @ None", "None ** 2", "divmod(None, 1)", "abs(None)", "round(None)", "hex(None)", "chr(None)", "ord(None)", "[1][None]", "'a' * None", "'a' + None", "None + 'a'", "[] + None", "range(None)", "sum([None])", "sorted([None, None])", "sorted([None, 1])", "max(None, 1)", "''.join([None])", "format(None, 'd')", "format(None, '>5')", "'%d' % None", "'{:d}'.format(None)", "f'{None:5}'", "None.__init__(1)", "NoneType.__new__(NoneType) is None", "NoneType.__new__(int)", "object.__new__(NoneType)", "with_none()", "bytes(None)", "str(None, 'utf-8')", "isinstance(1, None)", "issubclass(int, None)", "getattr(None, 'real')", "None | 1", "None | None", "None & None", "bool(None) + 1"):
    t(lambda: eval(e))
def unpack():
    a, b = None
def with_none():
    with None: pass
def del_item(): del None[0]
def set_item(): None[0] = 1
def aug():
    x = None; x += 1
def raise_none(): raise None
def call_result(): return [].sort().x
def star(): return [*None]
async def aw(): await None
def drive():
    try: aw().send(None)
    except StopIteration: pass
for f in (unpack, with_none, del_item, set_item, aug, raise_none, call_result, star, drive): t(f)
# Ellipsis
print(..., repr(...), str(...), Ellipsis, ... is Ellipsis, ... == ..., ... != ..., bool(...), hash(...) == hash(...), EllipsisType, EllipsisType.__name__, EllipsisType() is ..., isinstance(..., EllipsisType), [...], (...,), {...: 1}[...], {...}, f"{...}", "%s" % ..., format(...), ... in [...], ....__class__, ....__repr__(), ....__reduce__(), type(....__doc__).__name__, ... or 1, ... and 1, not ..., [1, 2, 3][...:] if False else "", callable(...), ... == None, ... == 0, ... is not None, type(...).__mro__, tuple[int, ...], list[...])
class Sub:
    def __getitem__(self, k): return k
    def __setitem__(self, k, v): print("set", k, v)
    def __delitem__(self, k): print("del", k)
s = Sub(); print(s[...], s[..., 1], s[1, ..., 2], s[..., ...], s[...:...], s[1:..., ...]); s[...] = ...; del s[...]
def body(): ...
class EmptyBody: ...
print(body(), EmptyBody.__name__, (lambda: ...)(), [... for _ in range(2)], ... if ... else None)
for e in ("... + 1", "...()", "...[0]", "....x", "len(...)", "... < ...", "-...", "iter(...)", "int(...)", "EllipsisType(1)", "type('X', (EllipsisType,), {})", "setattr(..., 'x', 1)", "[1, 2][...]", "'abc'[...]", "(1, 2)[...]", "{}[...]", "range(3)[...]", "format(..., 'x')", "... | int", "int | ...", "[*...]", "b'a'[...]"):
    t(lambda: eval(e))
Ellipsis_backup = Ellipsis; Ellipsis = "rebound"; print(Ellipsis, ...); del Ellipsis; print(Ellipsis is Ellipsis_backup)
# NotImplemented
print(NotImplemented, repr(NotImplemented), str(NotImplemented), NotImplemented is NotImplemented, NotImplemented == NotImplemented, NotImplemented != NotImplemented, NotImplemented == None, hash(NotImplemented) == hash(NotImplemented), NIType, NIType.__name__, NIType() is NotImplemented, isinstance(NotImplemented, NIType), [NotImplemented], {NotImplemented: 1}[NotImplemented], f"{NotImplemented}", NotImplemented.__class__, NotImplemented.__repr__(), NotImplemented.__reduce__(), type(NotImplemented.__doc__).__name__, callable(NotImplemented), NotImplemented in [NotImplemented], (1).__add__("a"), (1).__add__(1.5), (1.5).__add__(1), "a".__add__(1) if False else "", (1).__lt__("a"), (1).__eq__("a"), "a".__eq__(1), [].__eq__(()), [].__lt__(()), {}.__eq__([]), {}.__or__([]), set().__or__([]), set().__sub__([]), (1).__radd__("a"), (1).__pow__("a"), (1).__truediv__("a"), (1j).__add__("a"), (1j).__lt__(1j) if hasattr(1j, "__lt__") else "", b"a".__eq__("a"), (1,).__eq__([1]), None.__eq__(1), object().__eq__(1), object().__lt__(1), int.__eq__(1, 1.0), float.__eq__(1.0, 1), frozenset().__and__([]), range(1).__eq__([0]), "a".__mod__(1) if False else "", [].__mul__("a") if False else "", [].__iadd__([1]), (1).__and__(1.5), (1).__lshift__(1.5), True.__and__(2), True.__and__(1.5), True.__or__(False))
for e in ("bool(NotImplemented)", "not NotImplemented", "NotImplemented and 1", "NotImplemented or 1", "1 if NotImplemented else 2", "NotImplemented()", "NotImplemented + 1", "NotImplemented < 1", "NotImplemented[0]", "NotImplemented.x", "NIType(1)", "type('X', (NIType,), {})", "raise_(NotImplemented)", "len(NotImplemented)", "[x for x in [1] if NotImplemented]", "any([NotImplemented])", "all([NotImplemented])", "list(filter(None, [NotImplemented]))", "int(NotImplemented)", "setattr(NotImplemented, 'x', 1)", "NotImplemented | int", "'a'.__add__(1)", "[].__add__(1)", "[].__mul__('a')", "(1,).__add__([1])", "'a'.__mod__(1)", "b'a'.__add__('a')", "'a'.__mul__('b')", "'a'.__rmul__('b')"):
    t(lambda: eval(e))
def raise_(x): raise x
def wh():
    while NotImplemented: break
def asrt(): assert NotImplemented
t(wh); t(asrt); t(lambda: raise_(NotImplemented)); t(lambda: raise_(NotImplementedError)); t(lambda: raise_(NotImplementedError("msg"))); print(issubclass(NotImplementedError, RuntimeError), NotImplementedError is not NotImplemented)
# True and False.
print(True, False, repr(True), str(False), int(True), int(False), True + True, True * 5, True / 2, True // 2, -True, +True, ~True, ~False, abs(True), True ** 2, 2 ** True, True << 2, True & False, True | False, True ^ True, True & 1, True | 2, True ^ 3, 1 & True, type(True & False), type(True & 1), type(True | False), type(True ^ True), type(True + True), type(-True), type(~True), type(+True), type(abs(True)), True == 1, True == 1.0, True == 1 + 0j, False == 0, True is True, True is 1 if False else "", hash(True), hash(False), {True: "a", 1: "b", 1.0: "c"}, {0: "x", False: "y"}, [10, 20][True], [10, 20][False], "ab"[True], "x" * True, "x" * False, [1] * True, range(True), list(range(False, True + True)), sum([True, True, False]), max(True, False), min(True, 0), sorted([True, False, True]), sorted([1, True, 0, False]), True < 2, False < True, True > False, True.real, True.imag, True.numerator, True.denominator, True.bit_length(), False.bit_length(), True.bit_count(), True.conjugate(), type(True.conjugate()), True.to_bytes(1, "big"), True.as_integer_ratio(), True.is_integer(), float(True), complex(True), str(True).lower(), "%d %s %r %x %5s" % (True, True, True, True, True), f"{True} {True:d} {True:5} {True!r:>6} {True:x} {True:.1f} {False:<6}|", format(True), format(True, ""), format(True, "d"), format(True, "s") if False else "", round(True), round(True, 1), divmod(True, True), pow(True, 2, 2), bin(True), hex(True), oct(False), chr(True + 64), bool.__mro__, bool.__bases__, bool.__name__, type(bool.__doc__).__name__, isinstance(True, int), issubclass(bool, int), type(True) is bool, type(True) is int, bool(True), bool("False"), bool(0.0), bool.__new__(bool, 5), bool.__new__(bool), int.__new__(int, True), int.__add__(True, True), bool.__and__(True, False), bool.__or__(True, 2), bool.from_bytes(b"\x00"), bool.from_bytes(b"\x05"), type(bool.from_bytes(b"\x01")), True.__bool__(), True.__int__(), True.__index__(), True.__repr__(), True.__hash__(), True.__class__, True.__eq__(1), True.__eq__(1.0), True.__and__(True), True.__rand__(1), True.__xor__(1), True.__invert__(), True.__neg__(), True.__abs__(), True.__float__(), True.__trunc__(), True.__floor__(), True.__ceil__(), True.__round__(), True.__sizeof__() > 0, True.__getnewargs__())
for e in ("True()", "True[0]", "True.x", "len(True)", "iter(True)", "True + 'a'", "True + None", "True / False", "True // False", "True % False", "True ** -True", "False ** -1", "True << -1", "setattr(True, 'x', 1)", "type('X', (bool,), {})", "bool(1, 2)", "bool(x=1)", "bool.__new__(int)", "int.__new__(bool, 1)", "bool.__new__(bool, 1, 2)", "format(True, 's')", "'%c' % True", "True @ True", "[*True]", "True in True", "True < 'a'", "True.real()", "format(True, 'q')", "object.__new__(bool)"):
    t(lambda: eval(e))
