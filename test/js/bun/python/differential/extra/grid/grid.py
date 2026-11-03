# Every method of the built-in types, every operator and many built-in functions, on a grid of ordinary and borderline arguments.
# What comes out (a result or an exception with its message, and what became of the receiver) has to be what CPython gives.
#
#   grid.py                 one line for each group and name: how many calls, and a digest of their outcomes
#   grid.py GROUP [NAME]    every call of the group (of the name), one per line
#   grid.py --groups        the names of the groups
#   grid.py --every N ...   only each Nth call
#
# grid_compare.py runs it under two interpreters and shows where they differ.
import hashlib, itertools, re, sys, warnings
warnings.simplefilter("ignore")

inf, nan = float("inf"), float("nan")

INTS = [0, 1, -1, 2, 3, 7, 10, -5, 255, -128, 1000]
MIDDLE = [2 ** 31 - 1, 2 ** 31, -2 ** 31, 2 ** 32, 2 ** 53, 2 ** 53 + 1, -2 ** 53]  # Sizes that could really be allocated.
HUGE = [2 ** 63 - 1, 2 ** 63, -2 ** 63, -2 ** 63 - 1, 2 ** 64, 10 ** 20, -10 ** 20]
FLOATS = [0.0, -0.0, 1.0, 1.5, -2.5, 0.1, 1e308, 1e-308, 5e-324, inf, -inf, nan, 2.0 ** 53, 1e16, 123456.789]
COMPLEXES = [0j, 1j, 1 + 2j, -1.5 - 0.5j, complex(inf, nan)]
STRS = ["", "a", "abc", "ABC", "Abc Def", " a b ", "é", "ß", "€", "\U0001f600", "a\U0001f600b", "1", "12", "-3", "1.5", "\n", "a\nb\r\nc", "\t", "a,b,c", "%s", "{}", "{0}", "aXbXc",
        "Ǆ", "ı", "İ", "Σ", "utf-8", "ascii", "strict", "ignore", "x" * 40, "٠", "²", "_a1", "a b", "\x00", " "]
BYTES = [b"", b"a", b"abc", b"ABC", b"\x00\xff", b" a b ", b"1", b"12", b"a,b,c", b"%s", b"aXbXc", b"\n", b"a\nb\r\nc", b"\xc3\xa9", b"x" * 40]

def factories():
    out = []
    def add(name, make):
        out.append((name, make))
    for group in (INTS, MIDDLE, HUGE, FLOATS, COMPLEXES, STRS, BYTES):
        for value in group:
            add(ascii(value), lambda value=value: value)
    for text in ("None", "True", "False", "...", "NotImplemented", "[]", "[1]", "[1, 2, 3]", "['a', 'b']", "[[1], [2]]", "[3, 1, 2]", "[1, 'a', None]", "()", "(1,)", "(1, 2, 3)", "('a', 'b')",
                 "((1, 2), (3, 4))", "{}", "{1: 2}", "{'a': 1, 'b': 2}", "set()", "{1}", "{1, 2, 3}", "frozenset({1, 2})", "range(0)", "range(3)", "range(1, 10, 3)", "range(5, 0, -1)",
                 "slice(None)", "slice(1, 2)", "slice(None, None, -1)", "slice(-1, None)", "slice(0, 10, 2)", "bytearray(b'')", "bytearray(b'abc')", "memoryview(b'abc')", "int", "str", "object", "len",
                 "iter([1, 2])", "iter('ab')", "(x for x in (1, 2))", "Index(2)", "Index(-1)", "Index(2 ** 64)", "object()", "lambda x: x", "str.upper", "IntSub(5)", "StrSub('sub')", "ListSub([1, 2])"):
        add(text, lambda code=compile(text, "<sample>", "eval"): eval(code))
    return out

class Index:
    def __init__(self, value): self.value = value
    def __index__(self): return self.value
    def __repr__(self): return "Index(%r)" % self.value
class IntSub(int): pass
class StrSub(str): pass
class ListSub(list): pass

ALL = factories()
BY_NAME = dict(ALL)
def pick(*names): return [(name, BY_NAME[name]) for name in names]
# For the second and third argument.
FEW = pick("0", "1", "-1", "2", "1000", "9223372036854775808", "1.5", "nan", "''", "'a'", "'abc'", "b''", "b'a'", "None", "True", "[]", "[1, 2, 3]", "()", "(1, 2, 3)", "{}", "{'a': 1, 'b': 2}", "{1, 2, 3}",
           "range(3)", "slice(1, 2)", "Index(2)", "object()", "int")
FEWER = pick("0", "1", "-1", "2", "None", "'a'", "b'a'", "1.5", "[1, 2, 3]")

EVERY, TURN = 1, 0
def thin(iterable):
    "Each EVERYth of them, beginning with another one each time: for a sample of the grid."
    global TURN
    if EVERY == 1:
        return iterable
    TURN += 1
    return itertools.islice(iterable, TURN % EVERY, None, EVERY)

ADDRESS = re.compile(r' at 0x[0-9a-fA-F]+|, file "[^"]*"')  # And where this file is.

def show(value, depth=0):
    kind = type(value)
    if isinstance(value, (set, frozenset)):  # In an order that does not depend on the hashes of strs.
        items = sorted((show(item, depth + 1) for item in value))
        text = "{%s}" % ", ".join(items) if items else "set()"
        return text if kind is set else "%s(%s)" % (kind.__name__, text)
    if kind in (list, tuple) and depth < 3:
        items = [show(item, depth + 1) for item in value[:40]]
        if len(value) > 40: items.append("... %d" % len(value))
        return ("[%s]" if kind is list else "(%s,)" if len(value) == 1 else "(%s)") % ", ".join(items)
    if kind is dict and depth < 3:
        return "{%s}" % ", ".join("%s: %s" % (show(k, depth + 1), show(v, depth + 1)) for k, v in itertools.islice(value.items(), 40))
    if hasattr(kind, "__next__") and depth < 2:
        try:
            return "<%s: %s>" % (kind.__name__, show(list(itertools.islice(value, 12)), depth + 1))
        except Exception as e:
            return "<%s: %s: %s>" % (kind.__name__, type(e).__name__, e)
    try:
        text = repr(value)
    except Exception as e:
        return "<repr: %s: %s>" % (type(e).__name__, e)
    text = ADDRESS.sub(" at 0x", text)
    if len(text) > 160:
        text = text[:120] + "... %d %s" % (len(text), hashlib.md5(text.encode("utf-8", "backslashreplace")).hexdigest()[:8])
    if kind not in (int, float, str, bytes, bool, complex, type(None), list, tuple, dict):
        text = kind.__name__ + ":" + text
    return text

def outcome(function, *args):
    try:
        return show(function(*args))
    except RecursionError:
        return "RecursionError"
    except MemoryError:
        return "MemoryError"
    except BaseException as e:
        return "%s: %s" % (type(e).__name__, ADDRESS.sub(" at 0x", str(e)))

# ---- What would take all the memory, or for ever, in CPython too ----

def number_of(value):
    "The int an argument stands for, or None. (A Fraction stands for something as exact.)"
    if isinstance(value, Index): value = value.value
    if type(value).__name__ == "Fraction": return 2
    return int(value) if isinstance(value, int) else None

def is_big(value):
    "A size that could really be allocated, or nearly: more than that is refused at once."
    n = number_of(value)
    return n is not None and 100000 < abs(n) < 2 ** 62

REPEAT = set("__mul__ __rmul__ __imul__ * *= repeat mul imul".split())
SIZED = set("ljust rjust center zfill expandtabs to_bytes resize __init__ take_bytes bytes bytearray".split())
SHIFT = {"<<": 1, "<<=": 1, "__lshift__": 1, "__rlshift__": 0, "lshift": 1, "ilshift": 1}
POWER = {"**": (0, 1), "**=": (0, 1), "__pow__": (0, 1), "__ipow__": (0, 1), "pow": (0, 1), "pow/3": (0, 1), "__rpow__": (1, 0), "ipow": (0, 1)}
SEQUENCES = (str, bytes, bytearray, list, tuple)

def is_too_much(name, args):
    if name in REPEAT:
        return any(is_big(a) for a in args) and any(isinstance(a, SEQUENCES) or type(a).__name__ in ("deque", "array") for a in args)
    if name in SIZED:
        return any(is_big(a) for a in args)
    if name in SHIFT and len(args) > 1:
        count = number_of(args[SHIFT[name]])
        return count is not None and 10000 < count < 2 ** 62
    if name in POWER and len(args) > 1:
        base, exponent = number_of(args[POWER[name][0]]), number_of(args[POWER[name][1]])
        if base is None or exponent is None or abs(base) <= 1 or abs(exponent) <= 300:
            return False
        return not (len(args) > 2 and number_of(args[2]))  # With a modulus it is quick.
    if name in ("__round__", "round"):  # round(1, -10 ** 20) works out 10 ** 10 ** 20.
        return any(number_of(a) is not None and (number_of(a) < -10000 or (number_of(a) > 10000 and type(args[0]).__name__ == "Fraction")) for a in args[1:])
    if name in ("factorial", "comb", "perm"):
        return any(number_of(a) is not None and abs(number_of(a)) > 300 for a in args)
    return False

# ---- The groups ----

RECEIVERS = {
    "int": ["0", "1", "-5", "255", "9007199254740993", "18446744073709551616", "-100000000000000000000"],
    "bool": ["True", "False"],
    "float": ["0.0", "-0.0", "1.5", "-2.5", "1e+308", "inf", "nan", "123456.789"],
    "complex": ["0j", "(1+2j)", "(-1.5-0.5j)"],
    "str": ["''", "'abc'", "'Abc Def'", "' a b '", "'a,b,c'", "'aXbXc'", "'a\\U0001f600b'", "'\\xdf'", "'12'", "'a\\nb\\r\\nc'", "'{}'", "'%s'"],
    "bytes": ["b''", "b'abc'", "b' a b '", "b'a,b,c'", "b'aXbXc'", "b'\\x00\\xff'", "b'12'", "b'%s'"],
    "bytearray": ["bytearray(b'')", "bytearray(b'abc')"],
    "list": ["[]", "[1, 2, 3]", "['a', 'b']", "[3, 1, 2]", "[1, 'a', None]"],
    "tuple": ["()", "(1, 2, 3)", "('a', 'b')"],
    "dict": ["{}", "{1: 2}", "{'a': 1, 'b': 2}"],
    "set": ["set()", "{1, 2, 3}"],
    "frozenset": ["frozenset({1, 2})"],
    "range": ["range(0)", "range(3)", "range(1, 10, 3)", "range(5, 0, -1)"],
    "slice": ["slice(None)", "slice(1, 2)", "slice(0, 10, 2)", "slice(None, None, -1)"],
    "memoryview": ["memoryview(b'abc')"],
    "NoneType": ["None"],
    "object": ["object()"],
}
# __alloc__: how much room a bytearray has set aside. __del__: CPython shows the finalizer of its generators as a method; here finalization is the collector's.
SKIPPED_METHODS = set("__alloc__ __del__ __class__ __doc__ __sizeof__ __init_subclass__ __subclasshook__ __reduce__ __reduce_ex__ __getstate__ __dir__ __new__ __getattribute__ __setattr__ __delattr__ __buffer__ __release_buffer__ release".split())

# What a function says that does not take so many arguments, whatever they are.
WRONG_NUMBER = re.compile(r"^TypeError: .*(takes .*\barguments?\b|expected (at most |at least |exactly )?\d+ (positional )?arguments?\b|expected \d+ or \d+ arguments)")

def methods_group(type_name):
    all_receivers = RECEIVERS[type_name]
    kind = type(BY_NAME[all_receivers[0]]())
    for name in sorted(dir(kind)):
        if name in SKIPPED_METHODS:
            continue
        # A hash that goes by identity is an address. That of a str is random in CPython unless told otherwise, and so is that of what holds one.
        if name == "__hash__" and (type_name in ("str", "bytes", "tuple", "frozenset", "memoryview", "frozendict", "type", "builtin_function", "method", "method_wrapper", "code", "partial", "StrSub", "BytesSub", "TupleSub", "FrozensetSub")
                                   or kind.__hash__ is object.__hash__):
            continue
        # In CPython the hash of a NaN is that of the object it is. Here all NaNs are one.
        receivers = [r for r in all_receivers if not (r == "nan" and name == "__hash__")]
        if not callable(getattr(kind, name, None)):
            for receiver in receivers:
                yield name, "%s.%s" % (receiver, name), lambda receiver=receiver: outcome(getattr, BY_NAME[receiver](), name)
            continue
        for receiver in receivers:
            before = show(BY_NAME[receiver]())
            for combinations in ([()], thin((a,) for a in ALL), thin(itertools.product(FEW, FEW)), thin(itertools.product(FEWER, FEWER, FEWER))):
                # A method that does not take so many arguments says the same to all of them: six are enough.
                seen = []
                for arguments in combinations:
                    def run(receiver=receiver, arguments=arguments, seen=seen):
                        target = BY_NAME[receiver]()
                        args = [make() for _, make in arguments]
                        if is_too_much(name, [target] + args):
                            return None
                        if name == "__call__" and ((target is int and len(args) > 2) or (target is str and not all(isinstance(a, str) for a in args[1:]))):
                            return None  # CPython has two wordings, for the two ways into its C code: int(...) and type.__call__(int, ...).
                        result = outcome(lambda: getattr(target, name)(*args))
                        seen.append(result)
                        after = show(target)
                        return result if after == before else "%s | %s" % (result, after)
                    yield name, "%s.%s(%s)" % (receiver, name, ", ".join(n for n, _ in arguments)), run
                    if len(seen) == 6 and len(set(seen)) == 1 and WRONG_NUMBER.search(seen[0]):
                        break

import operator
BINARY = {"+": operator.add, "-": operator.sub, "*": operator.mul, "/": operator.truediv, "//": operator.floordiv, "%": operator.mod, "**": operator.pow, "<<": operator.lshift, ">>": operator.rshift,
          "&": operator.and_, "|": operator.or_, "^": operator.xor, "@": operator.matmul, "<": operator.lt, "<=": operator.le, "==": operator.eq, "!=": operator.ne, ">": operator.gt, ">=": operator.ge,
          "in": lambda a, b: a in b, "[]": operator.getitem, "+=": operator.iadd, "-=": operator.isub, "*=": operator.imul, "|=": operator.ior, "&=": operator.iand, "//=": operator.ifloordiv,
          "%=": operator.imod, "**=": operator.ipow, "<<=": operator.ilshift, ">>=": operator.irshift, "^=": operator.ixor, "/=": operator.itruediv, "divmod": divmod, "is": lambda a, b: (a == b) and type(a) is type(b)}
UNARY = {"-": operator.neg, "+": operator.pos, "~": operator.invert, "not": operator.not_, "abs": abs, "bool": bool, "len": len, "iter": iter, "hash": lambda a: hash(a) if not isinstance(a, (str, bytes, tuple, frozenset, memoryview)) and type(a).__hash__ is not object.__hash__ and a == a and not callable(a) else "skipped",
         "int": int, "float": float, "complex": complex, "str": str, "repr": repr, "ascii": ascii, "bytes": bytes, "bytearray": bytearray, "list": list, "tuple": tuple, "set": set, "frozenset": frozenset, "dict": dict,
         "sorted": sorted, "reversed": reversed, "sum": sum, "min": min, "max": max, "any": any, "all": all, "bin": bin, "hex": hex, "oct": oct, "chr": chr, "ord": ord, "round": round, "callable": callable,
         "enumerate": enumerate, "zip": zip, "range": range, "slice": slice, "type": lambda a: type(a).__name__, "format": format, "index": operator.index, "trunc": __import__("math").trunc,
         "floor": __import__("math").floor, "ceil": __import__("math").ceil, "memoryview": memoryview, "next": next, "vars": lambda a: sorted(vars(a)) if not isinstance(a, type) else "skipped", "id": lambda a: type(id(a)).__name__}

def operators_group():
    for symbol, function in BINARY.items():
        for (left, make_left), (right, make_right) in thin(itertools.product(ALL, ALL)):
            def run(function=function, symbol=symbol, make_left=make_left, make_right=make_right):
                a, b = make_left(), make_right()
                if is_too_much(symbol, [a, b]):
                    return None
                return outcome(function, a, b)
            yield symbol, "%s %s %s" % (left, symbol, right), run

def unary_group():
    for symbol, function in UNARY.items():
        for name, make in thin(ALL):
            def run(function=function, symbol=symbol, make=make):
                a = make()
                if is_too_much(symbol, [a]):
                    return None
                return outcome(function, a)
            yield symbol, "%s(%s)" % (symbol, name), run

TWO = {"pow": pow, "round": round, "int": int, "str": str, "bytes": bytes, "bytearray": bytearray, "getattr": getattr, "hasattr": hasattr, "isinstance": isinstance, "issubclass": issubclass, "divmod": divmod,
       "range": range, "slice": slice, "enumerate": enumerate, "zip": zip, "map": map, "filter": filter, "min": min, "max": max, "sum": sum, "iter": iter, "next": next, "complex": complex, "format": format,
       "dict.fromkeys": dict.fromkeys, "int.from_bytes": int.from_bytes, "str.maketrans": str.maketrans, "bytes.maketrans": bytes.maketrans, "float.fromhex": lambda a, b: float.fromhex(a), "bytes.fromhex": lambda a, b: bytes.fromhex(a)}

def builtins_group():
    for symbol, function in TWO.items():
        for (left, make_left), (right, make_right) in thin(itertools.product(ALL, FEW)):
            def run(function=function, symbol=symbol, make_left=make_left, make_right=make_right):
                a, b = make_left(), make_right()
                if is_too_much(symbol, [a, b]):
                    return None
                return outcome(function, a, b)
            yield symbol, "%s(%s, %s)" % (symbol, left, right), run
    for symbol, function in {"pow": pow, "range": range, "slice": slice, "str": str, "bytes": bytes, "getattr": getattr, "int.to_bytes": int.to_bytes, "int.from_bytes": int.from_bytes, "str.maketrans": str.maketrans}.items():
        for arguments in thin(itertools.product(FEW, FEW, FEWER)):
            def run(function=function, symbol=symbol, arguments=arguments):
                args = [make() for _, make in arguments]
                if is_too_much(symbol, args):
                    return None
                return outcome(function, *args)
            yield symbol + "/3", "%s(%s)" % (symbol, ", ".join(n for n, _ in arguments)), run

SPECS = ["", "d", "5", "05", "<5", ">5", "^5", "*^7", "+", "-", " ", "+d", ",", "_", ",d", "_d", "b", "o", "x", "X", "#x", "#b", "#o", "c", "n", "e", "E", "f", "F", "g", "G", "%", ".0f", ".1f", ".2f", ".10f", ".3e", ".3g",
         ".0e", ".0g", "#.0f", "#g", "10.3f", "<10.3f", "+.2f", " .2f", "010.2f", ",.2f", "_.2f", ".2%", "s", "10s", ".2s", "10.2s", "^10s", "z.1f", "z", "=5", "=+5d", "0=5", "x<5", "5c", ".2", ".2d", "5.2", "r", "!", "{", "}",
         "1000", "99999999999999999999", ".99999999999999999999", "é^5", "\U0001f600^5", "_x", ",x", "_b", "_o", "__", ",,", "_,", "#_x", "+#x", "08.3g", ".3n", "5n", "0", "00", "-5", "<", ">", "^", "="]
PERCENTS = ["%s", "%r", "%a", "%d", "%i", "%u", "%5d", "%-5d", "%05d", "%+d", "% d", "%x", "%X", "%o", "%#x", "%#o", "%c", "%e", "%E", "%f", "%F", "%g", "%G", "%.2f", "%10.3f", "%-10.3f|", "%+.2e", "%5s", "%-5s|", "%.2s", "%%", "%",
            "%z", "%(a)s", "%(a)d", "%*d", "%.*f", "%s %s", "%d %d", "%5%", "%ld", "%hd", "%b", "%.0f", "%#.0f", "%#g", "%.100f", "%1000d", "%99999999999999999999d", "%.99999999999999999999f", "abc", ""]

def format_group():
    for spec in SPECS:
        for name, make in thin(ALL):
            yield "format", "format(%s, %r)" % (name, spec), lambda make=make, spec=spec: outcome(format, make(), spec)
    for template in PERCENTS:
        for name, make in thin(ALL):
            yield "str %", "%r %% %s" % (template, name), lambda make=make, template=template: outcome(operator.mod, template, make())
            yield "bytes %", "%r %% %s" % (template.encode(), name), lambda make=make, template=template: outcome(operator.mod, template.encode(), make())
    for template in ["{}", "{0}", "{1}", "{a}", "{!r}", "{!s}", "{!a}", "{!x}", "{:5}", "{:>5}", "{0:{1}}", "{0[0]}", "{0[a]}", "{0.real}", "{0.x}", "{", "}", "{{}}", "{}{}", "{0}{}", "{}{0}", "{:{}}", "{0!r:5}", "{[}", "{0[}", "{0.}", "{!}", "{:}", "{ }", "{0 }", "{-1}", "{0[-1]}", "{99999999999999999999}"]:
        for (left, make_left), (right, make_right) in thin(itertools.product(ALL, FEWER)):
            yield "str.format", "%r.format(%s, %s)" % (template, left, right), lambda template=template, make_left=make_left, make_right=make_right: outcome(template.format, make_left(), make_right())

CONTAINERS = pick("[]", "[1, 2, 3]", "['a', 'b']", "bytearray(b'abc')", "{}", "{'a': 1, 'b': 2}", "{1: 2}", "'abc'", "b'abc'", "(1, 2, 3)", "range(1, 10, 3)", "memoryview(b'abc')", "ListSub([1, 2])")
SLICE_PARTS = [None, 0, 1, -1, 2, -2, 5, -5, 2 ** 63, -2 ** 63]

def subscript_group():
    for (container, make_container), (key, make_key), (value, make_value) in thin(itertools.product(CONTAINERS, ALL, FEW)):
        def run(make_container=make_container, make_key=make_key, make_value=make_value):
            target = make_container()
            return "%s | %s" % (outcome(operator.setitem, target, make_key(), make_value()), show(target))
        yield "[]=", "%s[%s] = %s" % (container, key, value), run
    for (container, make_container), (key, make_key) in thin(itertools.product(CONTAINERS, ALL)):
        def run(make_container=make_container, make_key=make_key):
            target = make_container()
            return "%s | %s" % (outcome(operator.delitem, target, make_key()), show(target))
        yield "del []", "del %s[%s]" % (container, key), run
    for (container, make_container), start, stop, step in thin(itertools.product(CONTAINERS, SLICE_PARTS, SLICE_PARTS, [None, 1, -1, 2, -2, 0, 2 ** 63])):
        yield "[::]", "%s[%r:%r:%r]" % (container, start, stop, step), lambda make_container=make_container, start=start, stop=stop, step=step: outcome(operator.getitem, make_container(), slice(start, stop, step))
        for value, make_value in pick("[]", "[1, 2, 3]", "'abc'", "b'a'", "()", "range(3)", "1", "None"):
            def run(make_container=make_container, start=start, stop=stop, step=step, make_value=make_value):
                target = make_container()
                return "%s | %s" % (outcome(operator.setitem, target, slice(start, stop, step), make_value()), show(target))
            yield "[::]=", "%s[%r:%r:%r] = %s" % (container, start, stop, step, value), run

# ---- More receivers: what is not a sample for the other groups ----

import array, collections, copy, functools, math, cmath, pickle, struct, types, codecs, fractions
NAMESPACE = dict(globals())
NAMESPACE.update(array=array.array, deque=collections.deque, defaultdict=collections.defaultdict, OrderedDict=collections.OrderedDict, Counter=collections.Counter,
                 MappingProxyType=types.MappingProxyType, SimpleNamespace=types.SimpleNamespace, Fraction=fractions.Fraction)

class Plain:
    def method(self, a=1): return a
def function(a, b=2, *c, d=4, **e): return (a, b, c, d, e)
NAMESPACE.update(Plain=Plain, function=function)

MORE_RECEIVERS = {
    "array": ["array('i')", "array('i', [1, 2, 3])", "array('d', [1.5, 2.5])", "array('B', b'abc')", "array('w', 'ab')", "array('q', [2 ** 62])", "array('H', [1, 65535])"],
    "deque": ["deque()", "deque([1, 2, 3])", "deque([1, 2, 3], 3)", "deque('ab', maxlen=5)", "deque([], 0)"],
    "defaultdict": ["defaultdict(list)", "defaultdict(int, {'a': 1})", "defaultdict(None, {1: 2})"],
    "OrderedDict": ["OrderedDict()", "OrderedDict([('a', 1), ('b', 2)])", "OrderedDict({1: 2})"],
    "Counter": ["Counter()", "Counter('aab')", "Counter({'a': 2, 'b': -1})"],
    "dict_keys": ["{}.keys()", "{'a': 1, 'b': 2}.keys()", "{1: 2}.keys()"],
    "dict_values": ["{}.values()", "{'a': 1, 'b': 2}.values()"],
    "dict_items": ["{}.items()", "{'a': 1, 'b': 2}.items()", "{1: 2}.items()"],
    "mappingproxy": ["MappingProxyType({})", "MappingProxyType({'a': 1, 'b': 2})"],
    "frozendict": ["frozendict()", "frozendict({'a': 1, 'b': 2})", "frozendict({1: 2})"],
    "list_iterator": ["iter([])", "iter([1, 2, 3])"],
    "tuple_iterator": ["iter((1, 2, 3))"],
    "str_iterator": ["iter('ab')", "iter('a\\u20ac')"],
    "bytes_iterator": ["iter(b'ab')"],
    "range_iterator": ["iter(range(3))", "iter(range(0, 2 ** 70, 2 ** 69))"],
    "reversed": ["reversed([1, 2, 3])", "reversed((1, 2))", "reversed(range(3))", "reversed('ab')"],
    "dict_iterator": ["iter({'a': 1, 'b': 2})", "iter({'a': 1}.items())", "iter({'a': 1}.values())", "reversed({'a': 1, 'b': 2})"],
    "set_iterator": ["iter({1})"],
    "enumerate": ["enumerate('ab')", "enumerate('ab', 2 ** 63)"],
    "zip": ["zip('ab', 'cd')", "zip()"],
    "map": ["map(str, [1, 2])"],
    "filter": ["filter(None, [0, 1])"],
    "generator": ["(x for x in (1, 2))"],
    "SimpleNamespace": ["SimpleNamespace()", "SimpleNamespace(a=1, b='x')"],
    "property": ["property()", "property(len, None, None, 'doc')"],
    "staticmethod": ["staticmethod(len)"],
    "classmethod": ["classmethod(len)"],
    "function": ["function"],
    "method": ["Plain().method"],
    "builtin_function": ["len", "[].append", "'abc'.upper"],
    "method_descriptor": ["str.upper", "list.append", "dict.fromkeys"],
    "wrapper_descriptor": ["int.__add__", "object.__repr__", "list.__len__"],
    "method_wrapper": ["(1).__add__", "[].__len__"],
    "getset_descriptor": ["int.real", "type.__dict__['__name__']"],
    "member_descriptor": ["slice.start", "complex.imag"],
    "type": ["int", "str", "object", "type", "Plain", "IntSub", "bool"],
    "BaseException": ["BaseException()", "ValueError('x')", "KeyError('k')", "Exception(1, 2)"],
    "OSError": ["OSError()", "OSError(2, 'msg')", "OSError(2, 'msg', 'file')", "FileNotFoundError(2, 'msg', 'a', None, 'b')"],
    "StopIteration": ["StopIteration()", "StopIteration(1, 2)"],
    "SyntaxError": ["SyntaxError()", "SyntaxError('m')", "SyntaxError('m', ('f', 1, 2, 't'))", "SyntaxError('m', ('f', 1, 2, 't', 3, 4))"],
    "UnicodeError": ["UnicodeDecodeError('utf-8', b'ab', 0, 1, 'why')", "UnicodeEncodeError('ascii', 'ab', 0, 1, 'why')", "UnicodeTranslateError('ab', 0, 1, 'why')"],
    "ExceptionGroup": ["ExceptionGroup('g', [ValueError(1)])", "BaseExceptionGroup('g', [KeyboardInterrupt(), ExceptionGroup('h', [TypeError(2)])])"],
    "AttributeError": ["AttributeError('m', name='n', obj=1)", "NameError('m', name='n')", "ImportError('m', name='n', path='p')"],
    "Fraction": ["Fraction(0)", "Fraction(1, 3)", "Fraction(-7, 2)"],
    "ellipsis": ["..."],
    "NotImplementedType": ["NotImplemented"],
    "cell": ["(lambda x: lambda: x)(1).__closure__[0]"],
    "code": ["function.__code__"],
    "module": ["types.ModuleType('m', 'doc')"],
    "partial": ["functools.partial(function, 1)", "functools.partial(function, 1, b=3)"],
    "itemgetter": ["operator.itemgetter(0)", "operator.itemgetter(0, 1)", "operator.attrgetter('real')", "operator.methodcaller('upper')"],
    "Struct": ["struct.Struct('<ih')", "struct.Struct('')"],
}
for names in MORE_RECEIVERS.values():
    for text in names:
        BY_NAME.setdefault(text, lambda code=compile(text, "<sample>", "eval"): eval(code, NAMESPACE))
RECEIVERS.update(MORE_RECEIVERS)
# co_*: the bytecode is another, and co_filename says where this file is. __subclasses__, __dict__ and the like of types: what else has been loaded. __globals__, __builtins__: everything.
SKIPPED_METHODS |= set("""__subclasses__ __globals__ __builtins__ __dict__ __flags__ __basicsize__ __itemsize__ __dictoffset__ __weakrefoffset__ __text_signature__ __static_attributes__ __firstlineno__
__vectorcalloffset__ co_filename co_code co_consts co_names co_lnotab co_linetable co_exceptiontable co_stacksize co_lines co_positions co_branches _co_code_adaptive _varname_from_oparg replace __traceback__ gi_frame gi_code buffer_info
__annotate__ __annotations__ __annotations_cache__ __type_params__ __code__ __closure__ __objclass__ __self__ __func__ __wrapped__ __module__ __abstractmethods__ __mro__ __bases__ __base__ mro""".split())

# ---- Keyword arguments ----

KEYWORD_CALLS = [
    ("'a,b,c'.split", [], ["sep", "maxsplit"]), ("'a,b,c'.rsplit", [], ["sep", "maxsplit"]), ("'a\\nb'.splitlines", [], ["keepends"]), ("'a\\tb'.expandtabs", [], ["tabsize"]),
    ("'abc'.encode", [], ["encoding", "errors"]), ("'aXbXc'.replace", ["'X'", "'-'"], ["count"]), ("b'a,b,c'.split", [], ["sep", "maxsplit"]), ("b'a,b,c'.rsplit", [], ["sep", "maxsplit"]),
    ("b'abc'.decode", [], ["encoding", "errors"]), ("b'abc'.hex", [], ["sep", "bytes_per_sep"]), ("b'a\\nb'.splitlines", [], ["keepends"]), ("b'a\\tb'.expandtabs", [], ["tabsize"]),
    ("bytearray(b'abc').hex", [], ["sep", "bytes_per_sep"]), ("bytearray(b'abc').decode", [], ["encoding", "errors"]), ("(1000).to_bytes", [], ["length", "byteorder", "signed"]),
    ("int.from_bytes", ["b'\\x01\\x82'"], ["byteorder", "signed"]), ("int.from_bytes", [], ["bytes", "byteorder", "signed"]), ("int", ["'12'"], ["base"]), ("int", [], ["x", "base"]), ("float", [], ["x"]),
    ("complex", [], ["real", "imag"]), ("str", [], ["object", "encoding", "errors"]), ("bytes", [], ["source", "encoding", "errors"]), ("bytearray", [], ["source", "encoding", "errors"]),
    ("sorted", ["[3, 1, 2]"], ["key", "reverse"]), ("sorted", [], ["iterable", "key"]), ("enumerate", ["'ab'"], ["start"]), ("enumerate", [], ["iterable", "start"]), ("sum", ["[1, 2]"], ["start"]),
    ("min", ["[3, 1, 2]"], ["key", "default"]), ("max", ["[3, 1, 2]"], ["key", "default"]), ("min", ["[]"], ["default", "key"]), ("max", ["3", "1"], ["key", "default"]), ("round", ["1234.5678"], ["ndigits"]),
    ("round", [], ["number", "ndigits"]), ("pow", [], ["base", "exp", "mod"]), ("pow", ["2", "5"], ["mod"]), ("zip", ["'ab'", "'abc'"], ["strict"]), ("map", ["str", "'ab'"], ["strict"]), ("dict", [], ["a", "b"]),
    ("dict", ["{'a': 0}"], ["a", "b"]), ("memoryview(b'abcd').tobytes", [], ["order"]), ("memoryview(b'abcd').cast", [], ["format", "shape"]), ("memoryview(b'abcd').hex", [], ["sep", "bytes_per_sep"]),
    ("memoryview", [], ["object"]), ("'{a}{b}'.format", [], ["a", "b"]), ("range", [], ["start", "stop"]), ("slice", [], ["start"]), ("list", [], ["iterable"]), ("tuple", [], ["iterable"]), ("set", [], ["iterable"]),
    ("frozenset", [], ["iterable"]), ("object", [], ["a"]), ("bool", [], ["x"]), ("len", [], ["obj"]), ("abs", [], ["x"]), ("divmod", [], ["x", "y"]), ("hash", [], ["obj"]), ("repr", [], ["obj"]), ("iter", [], ["iterable"]),
    ("next", [], ["iterator", "default"]), ("getattr", [], ["obj", "name"]), ("chr", [], ["i"]), ("ord", [], ["c"]), ("bin", [], ["number"]), ("format", [], ["value", "format_spec"]), ("all", [], ["iterable"]),
    ("reversed", [], ["sequence"]), ("filter", [], ["function", "iterable"]), ("isinstance", [], ["obj", "class_or_tuple"]), ("float.fromhex", [], ["string"]), ("bytes.fromhex", [], ["string"]), ("str.maketrans", [], ["x", "y"]),
    ("(1.5).__round__", [], ["ndigits"]), ("(5).__round__", [], ["ndigits"]), ("{1: 2}.get", [], ["key", "default"]), ("{1: 2}.pop", [], ["key", "default"]), ("{1: 2}.setdefault", [], ["key", "default"]),
    ("[1].index", [], ["value", "start"]), ("[1].pop", [], ["index"]), ("'abc'.find", [], ["sub", "start"]), ("'abc'.center", [], ["width", "fillchar"]), ("'abc'.strip", [], ["chars"]), ("'abc'.startswith", [], ["prefix"]),
    ("'abc'.join", [], ["iterable"]), ("'abc'.partition", [], ["sep"]), ("'abc'.removeprefix", [], ["prefix"]), ("'abc'.translate", [], ["table"]), ("'abc'.zfill", [], ["width"]), ("'abc'.count", [], ["sub"]),
    ("deque", [], ["iterable", "maxlen"]), ("OrderedDict([('a', 1), ('b', 2)]).popitem", [], ["last"]), ("OrderedDict([('a', 1), ('b', 2)]).move_to_end", [], ["key", "last"]), ("OrderedDict.fromkeys", [], ["iterable", "value"]),
    ("OrderedDict([('a', 1)]).pop", [], ["key", "default"]), ("OrderedDict([('a', 1)]).setdefault", [], ["key", "default"]), ("defaultdict", [], ["default_factory", "a"]), ("array", [], ["typecode", "initializer"]),
    ("itertools.accumulate", ["[1, 2, 3]"], ["func", "initial"]), ("itertools.count", [], ["start", "step"]), ("itertools.repeat", [], ["object", "times"]), ("itertools.product", ["'ab'"], ["repeat"]),
    ("itertools.zip_longest", ["'ab'", "'c'"], ["fillvalue"]), ("itertools.groupby", ["'aab'"], ["key"]), ("itertools.batched", ["'abc'", "2"], ["strict"]), ("itertools.permutations", ["'abc'"], ["r"]),
    ("itertools.combinations", [], ["iterable", "r"]), ("itertools.compress", [], ["data", "selectors"]), ("itertools.islice", ["'abc'"], ["stop"]), ("functools.reduce", ["operator.add", "[1, 2]"], ["initial"]),
    ("functools.partial", ["function"], ["a", "b"]), ("functools.cmp_to_key", [], ["mycmp"]), ("math.isclose", ["1.0", "1.1"], ["rel_tol", "abs_tol"]), ("math.prod", ["[1, 2]"], ["start"]), ("math.perm", ["5"], ["k"]),
    ("cmath.isclose", ["1j", "1.1j"], ["rel_tol", "abs_tol"]), ("struct.Struct", [], ["format"]), ("struct.unpack_from", ["'<h'"], ["buffer", "offset"]), ("pickle.dumps", ["[1]"], ["protocol", "fix_imports", "buffer_callback"]),
    ("pickle.loads", ["b'K\\x01.'"], ["fix_imports", "encoding", "errors", "buffers"]), ("copy.replace", ["SimpleNamespace(a=1)"], ["a", "b"]), ("SimpleNamespace", [], ["a", "b"]), ("property", [], ["fget", "doc"]),
    ("ImportError", ["'m'"], ["name", "path", "name_from"]), ("AttributeError", ["'m'"], ["name", "obj"]), ("NameError", ["'m'"], ["name"]), ("ValueError", [], ["a"]), ("OSError", [], ["errno"]), ("type", ["'X'", "()", "{}"], ["a"]),
    ("printed", ["1", "2"], ["sep", "end", "flush"]), ("codecs.encode", ["'a'"], ["encoding", "errors"]), ("codecs.decode", ["b'a'"], ["encoding", "errors"]), ("compile", ["'1'", "'f'", "'eval'"], ["flags", "dont_inherit", "optimize"]),
]

def keywords_group():
    for index, (text, positional, names) in enumerate(KEYWORD_CALLS):
        code = compile(text, "<call>", "eval")
        fixed = [compile(p, "<argument>", "eval") for p in positional]
        label = "%s(%s)" % (text, ", ".join(positional))
        simple = text.split(".")[-1]
        def call(keywords, code=code, fixed=fixed, simple=simple):
            values = {k: make() for k, (_, make) in keywords.items()}
            if is_too_much(simple, list(values.values())):
                return None
            return outcome(lambda: eval(code, NAMESPACE)(*[eval(f, NAMESPACE) for f in fixed], **values))
        for name in names + ["nope"]:
            for sample in thin(ALL):
                yield text, "%s %s=%s" % (label, name, sample[0]), lambda name=name, sample=sample, call=call: call({name: sample})
        for first, second in itertools.combinations(names, 2):
            for a, b in thin(itertools.product(FEW, FEW)):
                yield text, "%s %s=%s %s=%s" % (label, first, a[0], second, b[0]), lambda first=first, second=second, a=a, b=b, call=call: call({first: a, second: b})

# ---- Functions of modules written in C ----

def functions_group(module, names, skipped=(), few=None):
    few = few or FEW
    for name in names:
        function = module
        for part in name.split("."):
            function = getattr(function, part)
        simple = name.split(".")[-1]
        for combinations in ([()], thin((a,) for a in ALL), thin(itertools.product(ALL, few)), thin(itertools.product(few, few, FEWER))):
            seen = []
            for arguments in combinations:
                def run(function=function, arguments=arguments, seen=seen, simple=simple):
                    args = [make() for _, make in arguments]
                    if is_too_much(simple, args):
                        return None
                    result = outcome(function, *args)
                    seen.append(result)
                    return result
                yield name, "%s(%s)" % (name, ", ".join(n for n, _ in arguments)), run
                if len(seen) == 6 and len(set(seen)) == 1 and WRONG_NUMBER.search(seen[0]):
                    break

SIZED |= set("tee batched combinations combinations_with_replacement permutations product ldexp".split()) - {"ldexp"}
ITERTOOLS = "accumulate batched chain chain.from_iterable combinations combinations_with_replacement compress count cycle dropwhile filterfalse groupby islice pairwise permutations product repeat starmap takewhile tee zip_longest".split()
FUNCTOOLS = "reduce partial cmp_to_key".split()
# cbrt: the C library's is off by one unit in the last place for some arguments, and this runtime's is not.
MATH = [n for n in sorted(dir(math)) if callable(getattr(math, n)) and not n.startswith("_") and n != "cbrt"]
CMATH = [n for n in sorted(dir(cmath)) if callable(getattr(cmath, n)) and not n.startswith("_")]
OPERATOR = [n for n in sorted(dir(operator)) if callable(getattr(operator, n)) and not n.startswith("_")]
NUMBERS = [(n, m) for n, m in ALL if isinstance(m(), (int, float, complex)) or n in ("None", "'1'", "b'1'", "[]", "Index(2)", "Index(2 ** 64)", "object()")]
FEW_NUMBERS = pick("0", "1", "-1", "2", "3", "1000", "-5", "9007199254740993", "9223372036854775808", "0.0", "-0.0", "1.5", "-2.5", "0.1", "1e+308", "5e-324", "inf", "-inf", "nan", "True", "1j", "None", "'a'", "Index(2)")

def math_group(module, names):
    for name in names:
        function = getattr(module, name)
        for combinations in ([()], thin((a,) for a in ALL), thin(itertools.product(NUMBERS, FEW_NUMBERS)), thin(itertools.product(FEW_NUMBERS[:12], FEW_NUMBERS[:12], FEW_NUMBERS[:12]))):
            seen = []
            for arguments in combinations:
                def run(function=function, arguments=arguments, seen=seen, name=name):
                    args = [make() for _, make in arguments]
                    if is_too_much(name, args):
                        return None
                    result = outcome(function, *args)
                    seen.append(result)
                    return result
                yield name, "%s(%s)" % (name, ", ".join(n for n, _ in arguments)), run
                if len(seen) == 6 and len(set(seen)) == 1 and WRONG_NUMBER.search(seen[0]):
                    break

# ---- struct ----

CODES = "xcbB?hHiIlLqQnNefdspP"
FORMATS = [p + c for p in ("", "@", "=", "<", ">", "!") for c in CODES] + ["", " ", "<", "2i", "<2h", "3s", "0s", "10p", "<hh", "<h h", "i2", "z", "<z", "1", "99999999999999999999i", "<i>", "@@i", "2x", "<3sb", ">?", "<e", "2c", "<qQ", "!Hh", "5", "<0i", "i" * 3, "\u20ac", "<F", "<D", "F", "D"]

def struct_group():
    for text in FORMATS:
        yield "calcsize", "calcsize(%a)" % text, lambda text=text: outcome(struct.calcsize, text)
        yield "calcsize", "calcsize(%a)" % text.encode(), lambda text=text: outcome(struct.calcsize, text.encode())
        for name, make in thin(ALL):
            yield "pack", "pack(%a, %s)" % (text, name), lambda text=text, make=make: outcome(struct.pack, text, make())
            yield "unpack", "unpack(%a, %s)" % (text, name), lambda text=text, make=make: outcome(struct.unpack, text, make())
        for data in (b"", b"\x00", b"\x01\x02", b"\xff\xfe\xfd\xfc", b"\x00\x00\x80\x7f", bytes(range(8)), b"\xff" * 8, b"\x00\x00\x00\x00\x00\x00\xf0\x7f", bytes(range(16)), b"\x03abcdefghi"):
            yield "unpack", "unpack(%a, %a)" % (text, data), lambda text=text, data=data: outcome(struct.unpack, text, data)
            yield "iter_unpack", "iter_unpack(%a, %a)" % (text, data), lambda text=text, data=data: outcome(struct.iter_unpack, text, data)
    for (a, make_a), (b, make_b) in thin(itertools.product(FEW, FEW)):
        for text in ("<hh", "<2h", "<sb", "<?f", "2s", "<ci"):
            yield "pack", "pack(%a, %s, %s)" % (text, a, b), lambda text=text, make_a=make_a, make_b=make_b: outcome(struct.pack, text, make_a(), make_b())
        yield "pack_into", "pack_into('<h', bytearray(4), %s, %s)" % (a, b), lambda make_a=make_a, make_b=make_b: outcome(lambda: (lambda buffer: (struct.pack_into("<h", buffer, make_a(), make_b()), buffer))(bytearray(4)))
        yield "unpack_from", "unpack_from('<h', %s, %s)" % (a, b), lambda make_a=make_a, make_b=make_b: outcome(struct.unpack_from, "<h", make_a(), make_b())

# ---- Codecs ----

ENCODINGS = """ascii latin-1 utf-8 utf-8-sig utf-16 utf-16-le utf-16-be utf-32 utf-32-le utf-32-be utf-7 cp1252 cp437 cp1251 iso8859-2 iso8859-15 koi8-r mac-roman cp037 punycode idna raw_unicode_escape unicode_escape
UTF8 U8 Latin_1 l1 646 us-ascii utf_8 utf8 UTF-16LE nope hex base64 rot13 undefined charmap""".split() + ["", "utf-8\x00", "\u20ac"]
HANDLERS = ["strict", "ignore", "replace", "backslashreplace", "xmlcharrefreplace", "namereplace", "surrogateescape", "surrogatepass", "nope", ""]
TEXTS = STRS + ["\ud800", "a\udc80b", "\udfff", "\x7f\x80\xff", "\u0100\uffff", "\U00010000\U0010ffff", "+-", "a+b-", "\\", "\\x41", "\\N{DIGIT ONE}", "xn--", "a.b", "\u00fc.example", "." * 3, "a" * 70 + ".b", "\ufeff", "\r\n"]
DATA = BYTES + [b"\x80", b"\xff", b"\xc3", b"\xc3\x28", b"\xe2\x82", b"\xe2\x82\xac", b"\xf0\x9f\x98\x80", b"\xf0\x9f\x98", b"\xed\xa0\x80", b"\xed\xb2\x80", b"\xf4\x90\x80\x80", b"\xc0\x80", b"\xef\xbb\xbfa", b"\xff\xfea\x00", b"\xfe\xff\x00a",
                b"a\x00", b"a", b"\x00\xd8", b"\x00\xd8\x00\xdc", b"\x00\xdc", b"\xff\xfe\x00\x00a\x00\x00\x00", b"a\x00\x00\x00", b"\x00\x00\x11\x00", b"\x00\xd8\x00\x00", b"+AGE-", b"+", b"+-", b"+AGE", b"+\xff", b"\\", b"\\x4", b"\\x41", b"\\u20ac",
                b"\\U0001f600", b"\\U00110000", b"\\N{DIGIT ONE}", b"\\N{nope}", b"\\8", b"\\400", b"\\\n", b"xn--tda", b"xn--", b"a-", b"-", b"tda", b"\x81\x8d\x8f\x90\x9d"]

def codecs_group():
    for encoding, errors in itertools.product(ENCODINGS, HANDLERS):
        for text in thin(TEXTS):
            yield "encode " + ascii(encoding), "%a.encode(%a, %a)" % (text, encoding, errors), lambda text=text, encoding=encoding, errors=errors: outcome(text.encode, encoding, errors)
        for data in thin(DATA):
            yield "decode " + ascii(encoding), "%a.decode(%a, %a)" % (data, encoding, errors), lambda data=data, encoding=encoding, errors=errors: outcome(data.decode, encoding, errors)
    for encoding in ("hex", "base64", "rot13", "uu", "quopri", "zlib", "utf-8", "nope"):
        for name, make in thin(ALL):
            yield "codecs.encode", "codecs.encode(%s, %a)" % (name, encoding), lambda make=make, encoding=encoding: outcome(codecs.encode, make(), encoding)
            yield "codecs.decode", "codecs.decode(%s, %a)" % (name, encoding), lambda make=make, encoding=encoding: outcome(codecs.decode, make(), encoding)
    for encoding in ENCODINGS:
        yield "lookup", "codecs.lookup(%a).name" % encoding, lambda encoding=encoding: outcome(lambda: codecs.lookup(encoding).name)
        for data in DATA:  # Cut anywhere, an incremental decoder comes to the same.
            def run(encoding=encoding, data=data):
                decoder = codecs.getincrementaldecoder(encoding)("replace")
                return [decoder.decode(data[i:i + 1]) for i in range(len(data))] + [decoder.decode(b"", True)]
            yield "incremental " + ascii(encoding), "incremental %a %a" % (encoding, data), lambda run=run: outcome(run)

# ---- Numbers as text ----

SPELLINGS = ["", " ", "0", "00", "1", "+1", "-1", "--1", "+-1", " 1 ", "\t1\n", "1 2", "1_000", "1__0", "_1", "1_", "0_0", "0x", "0x1", "0X1f", "0x_1", "0x1_", "0b101", "0B1", "0b2", "0o17", "0O7", "0o8", "017", "1e3", "1E3", "1e+3", "1e-3", "1e", "e1", "1.5",
             ".5", "5.", ".", "1.5.2", "1_0.0_1", "1._5", "1_.5", "1e1_0", "1e_1", "inf", "-inf", "+inf", "Infinity", "-INFINITY", "infinit", "nan", "-nan", "+NaN", "nan(1)", "1j", "1+2j", "1 + 2j", "(1+2j)", "( 1+2j )", "(1+2j", "1+2j)", "j", "-j", "+j", "1e3j",
             "1+j", "1-j", "1+-2j", "inf+infj", "nan+nanj", "1j+1", "1+2", "1+2J", "1.5e308", "1e309", "-1e309", "1e-400", "4.9e-324", "2.4e-324", "2.5e-324", "0.1", "0.30000000000000004", "9007199254740993", "9007199254740992.5", "123456789012345678901234567890",
             "0" * 50 + "1", "1" + "0" * 400, "z", "Z", "zz", "10", "ff", "FF", "\u0661\u0662", "\uff11", "\u00b2", "\u0967.\u0968", "1\x00", "\x001", "1\u00a0", "\u20031", "\u22121", "1,5", "0x1p3", "1l", "1L", "0.", "-0", "-0.0", "+0.0", "1e0", "١e١"]

def literals_group():
    for text in thin(SPELLINGS):
        for function in (int, float, complex, fractions.Fraction):
            yield function.__name__, "%s(%a)" % (function.__name__, text), lambda function=function, text=text: outcome(function, text)
        for function in (int, float):
            try:
                data = text.encode("utf-8")
            except UnicodeEncodeError:
                continue
            yield function.__name__, "%s(%a)" % (function.__name__, data), lambda function=function, data=data: outcome(function, data)
            yield function.__name__, "%s(bytearray(%a))" % (function.__name__, data), lambda function=function, data=data: outcome(function, bytearray(data))
        for base in (0, 2, 3, 8, 10, 16, 35, 36, 1, 37, -1, 2 ** 31, 2 ** 63, Index(16), True, 10.0, None, "10"):
            yield "int base", "int(%a, %r)" % (text, base), lambda text=text, base=base: outcome(int, text, base)
        yield "fromhex", "float.fromhex(%a)" % text, lambda text=text: outcome(float.fromhex, text)
    for text in ["0x1p0", "0x1.8p1", "0x.8p1", "0x1.p1", "1p1", "0x1p", "0x1p+", "-0x1p-1074", "0x1p-1075", "0x1.fffffffffffffp1023", "0x1p1024", "0x1.fffffffffffff8p1023", "0x0p0", "-0x0p0", " 0x1p0 ", "0x1_0p0", "0X1P0", "inf", "nan", "-Infinity", "0x", "0x1p99999999999999999999", "0x1p-99999999999999999999", "0x0p99999999999999999999", "1e5", "0x1e5"]:
        yield "fromhex", "float.fromhex(%a)" % text, lambda text=text: outcome(float.fromhex, text)
    for name, make in NUMBERS:
        for function in (repr, str, float.hex, float.as_integer_ratio, float.is_integer, int.bit_length, int.bit_count, complex.conjugate, fractions.Fraction):
            yield "of numbers", "%s(%s)" % (getattr(function, "__qualname__", function.__name__), name), lambda function=function, make=make: outcome(function, make())

# ---- Equal numbers hash alike; order among kinds of numbers ----

def equality_group():
    numbers = NUMBERS + [(text, lambda code=compile(text, "<sample>", "eval"): eval(code, NAMESPACE)) for text in
                         ("Fraction(0)", "Fraction(1)", "Fraction(3, 2)", "Fraction(-5, 2)", "Fraction(1, 10)", "Fraction(2 ** 53 + 1)", "Fraction(10 ** 20)", "Fraction(1, 3)", "2.0 ** 63", "-2.0 ** 63", "2.0 ** 64", "1e20", "-1e20", "2 ** 1023", "2 ** 1024", "float(2 ** 1023)", "1e22", "10 ** 22", "10 ** 23", "1e23", "complex(1.5)", "complex(2 ** 53)", "IntSub(1)")]
    for (a, make_a), (b, make_b) in thin(itertools.product(numbers, numbers)):
        def run(make_a=make_a, make_b=make_b):
            x, y = make_a(), make_b()
            equal = x == y
            return (equal, hash(x) == hash(y) if equal is True else None, outcome(operator.lt, x, y), outcome(lambda: x in {y: 1}), outcome(lambda: x in {y}), outcome(lambda: [y].index(x)), outcome(lambda: max(x, y)))
        yield "pairs", "%s ~ %s" % (a, b), lambda run=run: outcome(run)

# ---- Sorting ----

LISTS = ["[]", "[1]", "[3, 1, 2]", "[1, 1.0, True]", "[True, 1.0, 1]", "[2, 1.5, 1, 0.5]", "[nan, 1, 0]", "[1, nan, 0]", "[0.0, -0.0]", "[-0.0, 0.0]", "['b', 'a', 'B', 'A']", "['\\u20ac', '\\U0001f600', '\\uffff', 'z']", "[b'b', b'a']", "[1, 'a']", "['a', 1]",
         "[None, 1]", "[None, None]", "[(1, 'b'), (1, 'a'), (0, 'z')]", "[(1, 2), (1,)]", "[(1, 'a'), (1, 2)]", "[[2], [1, 5], []]", "[{1}, {1, 2}, set()]", "[{2}, {1}]", "[1j, 2j]", "[2 ** 64, 2 ** 63, -2 ** 64, 1.5e19]", "[10 ** 30, 1e30, 10 ** 29]",
         "list(range(40, 0, -1))", "[i % 7 for i in range(50)]", "[(i % 3, i) for i in range(30)]", "['a' * (i % 5) for i in range(20)]", "[Fraction(1, 2), 0.25, 1]", "[object(), object()]", "[int, str]", "[len, abs]", "[{}, {}]", "[range(2), range(1)]",
         "[bytearray(b'b'), b'a']", "[IntSub(2), 1]", "[StrSub('b'), 'a']", "[(nan,), (nan,)]", "[[nan], [1]]", "[1, 2, 3, 'x', 4]", "['x', 3, 2, 1]", "[(1, None), (1, None)]", "[(1, None), (0, None)]", "[(1, None), (1, 2)]"]
KEYS = ["None", "str", "repr", "len", "abs", "lambda x: 0", "lambda x: -x", "lambda x: (x,)", "lambda x: None", "lambda x: 1 / 0", "type", "id and (lambda x: 1)", "1", "'a'", "operator.neg", "functools.cmp_to_key(lambda a, b: (a > b) - (a < b))", "functools.cmp_to_key(lambda a, b: 0)", "functools.cmp_to_key(lambda a, b: 'x')"]

def sorting_group():
    for text, key, reverse in thin(itertools.product(LISTS, KEYS, ("False", "True", "0", "None", "'x'", "2 ** 64"))):
        def run(text=text, key=key, reverse=reverse):
            data = eval(text, NAMESPACE)
            return outcome(lambda: sorted(data, key=eval(key, NAMESPACE), reverse=eval(reverse, NAMESPACE)))
        yield "sorted", "sorted(%s, key=%s, reverse=%s)" % (text, key, reverse), run
    for text in LISTS:
        for function in ("min", "max", "sum", "any", "all", "set", "tuple", "reversed", "enumerate", "lambda l: l.sort() or l", "lambda l: l.reverse() or l", "lambda l: sorted(l) == sorted(reversed(l))", "lambda l: l == l", "lambda l: l < l", "lambda l: l * 2 == l + l", "lambda l: l.copy() is not l", "lambda l: [x in l for x in l]", "lambda l: [l.index(x) for x in l]", "lambda l: [l.count(x) for x in l]", "math.fsum", "math.prod", "lambda l: dict.fromkeys(l)", "lambda l: list(dict.fromkeys(map(repr, l)))", "lambda l: collections.Counter(map(repr, l)).most_common(3)", "lambda l: heapq.nsmallest(2, l)", "lambda l: heapq.nlargest(2, l)", "lambda l: bisect.bisect(sorted(l), l[0])"):
            yield "of lists", "(%s)(%s)" % (function, text), lambda text=text, function=function: outcome(lambda: eval(function, NAMESPACE)(eval(text, NAMESPACE)))
import heapq, bisect
NAMESPACE.update(heapq=heapq, bisect=bisect, collections=collections, math=math, functools=functools, operator=operator, itertools=itertools, struct=struct, pickle=pickle, copy=copy, codecs=codecs, cmath=cmath, types=types, nan=nan, inf=inf)

# ---- repr, str and ascii of what is nested; copies and pickles ----

NESTED = ["[[]]", "[[[[[]]]]]", "[()]", "([],)", "{1: []}", "{(): {}}", "[{1: (2, [3])}]", "{'a': {'b': {'c': None}}}", "[set()]", "[{1}]", "[frozenset()]", "(frozenset({1}),)", "['\\'']", "['\"']", "['\\'\"']", "['\\n\\t\\\\']", "['\\x00\\x7f\\x80\\xa0\\xad']", "['\\u20ac\\ud800']",
          "['\\U0001f600\\U000e0001']", "[b'\\'', b'\"', b'\\'\"', b'\\n\\xff']", "[bytearray(b'a\\'')]", "[1.0, -0.0, 1e16, 1e-5, 1.5e300, nan, inf]", "[1j, -1j, 1 + 0j, -0j, complex(-0.0, -0.0), complex(nan, inf), complex(1, -0.0)]", "[True, None, ..., NotImplemented]", "[int, type, len, str.upper]",
          "[range(3), range(0, 3, 2), slice(1, None)]", "(1,)", "((1,),)", "((),)", "{1: 1, 1.0: 2, True: 3}", "{'a': 1, 'a': 2}", "[memoryview(b'a').tolist()]", "deque([deque()])", "deque([1], 5)", "OrderedDict([(1, OrderedDict())])", "defaultdict(list, {1: []})", "Counter('ab')",
          "SimpleNamespace(a=SimpleNamespace())", "MappingProxyType({1: []})", "array('i', [1])", "array('d')", "array('w', 'a\\'')", "[Fraction(1, 2)]", "{}.keys()", "{1: 2}.items()", "{1: [2]}.values()", "frozendict({1: frozendict()})", "[ValueError('a', 1), KeyError('k'), OSError(1, 'x')]",
          "ExceptionGroup('g', [ValueError(1)])", "[StrSub('s'), IntSub(1), ListSub([1])]", "(lambda l: l.append(l) or l)([])", "(lambda d: d.update(a=d) or d)({})", "(lambda l: (l.append((l,)), l)[1])([])", "(lambda d: d.append(d) or d)(deque())", "(lambda o: o.update(a=o) or o)(OrderedDict())",
          "(lambda n: setattr(n, 'a', n) or n)(SimpleNamespace())", "(lambda l: {1: l.append(l) or l})([])", "functools.partial(len)", "functools.partial(function, 1, b=[2])", "operator.itemgetter(1, 'a')", "operator.attrgetter('a.b')", "operator.methodcaller('f', 1, a=2)", "enumerate", "zip", "type(None)", "type(...)"]

def nested_group():
    for text in NESTED:
        for function in (repr, str, ascii, "format", "%s", "%r", "%a", "f", "print"):
            def run(text=text, function=function):
                value = eval(text, NAMESPACE)
                if function == "format": return format(value)
                if function == "f": return f"{value}{value!r}{value!s}{value!a}"
                if function == "print":
                    import io
                    stream = io.StringIO(); print(value, [value], file=stream); return stream.getvalue()
                if isinstance(function, str): return function % (value,)
                return function(value)
            yield "text", "%s %s" % (getattr(function, "__name__", function), text), lambda run=run: ADDRESS.sub(" at 0x", outcome(run))

def pickled(value, protocol):
    """The operations of the pickle. Equal strs need not be one object here where they are in CPython, or the other way round
    (DEFERRED.md, "`is` on numbers and strs"), and the pickler's memo goes by identity: a str fetched from the memo is shown as the str."""
    import pickletools
    memo, shown, previous, others = {}, [], None, 0
    for operation, argument, _ in pickletools.genops(pickle.dumps(value, protocol)):
        name = operation.name
        if name == "FRAME":
            continue
        if name in ("MEMOIZE", "PUT", "BINPUT", "LONG_BINPUT"):
            index = len(memo) if name == "MEMOIZE" else argument
            if previous[0].endswith("UNICODE"):
                memo[index] = previous
            else:
                memo[index] = ("GET", others)
                others += 1
            continue
        previous = memo[argument] if name in ("GET", "BINGET", "LONG_BINGET") else (name, argument)
        shown.append(previous)
    return " ".join(n if a is None else "%s:%a" % (n, a) for n, a in shown)

def copies_group():
    samples = ALL + [(text, lambda code=compile(text, "<sample>", "eval"): eval(code, NAMESPACE)) for text in NESTED + sum(MORE_RECEIVERS.values(), [])]
    seen = set()
    for name, make in thin(samples):
        if name in seen:
            continue
        seen.add(name)
        yield "copy", "copy.copy(%s)" % name, lambda make=make: outcome(lambda: (lambda v: (copy.copy(v), copy.copy(v) is v))(make()))
        yield "deepcopy", "copy.deepcopy(%s)" % name, lambda make=make: outcome(lambda: (lambda v: (copy.deepcopy(v), copy.deepcopy(v) is v))(make()))
        for protocol in range(pickle.HIGHEST_PROTOCOL + 1):
            yield "pickle", "pickle %d %s" % (protocol, name), lambda make=make, protocol=protocol: outcome(lambda: pickle.loads(pickle.dumps(make(), protocol)))
            yield "pickled", "pickled %d %s" % (protocol, name), lambda make=make, protocol=protocol: outcome(lambda: pickled(make(), protocol))
        yield "reduce", "__reduce_ex__ %s" % name, lambda make=make: [outcome(make().__reduce_ex__, p) for p in (0, 2, 4)]

# ---- Instances of classes derived from the built-in types: what the methods of the base make of them ----

class FloatSub(float): pass
class ComplexSub(complex): pass
class BytesSub(bytes): pass
class BytearraySub(bytearray): pass
class TupleSub(tuple): pass
class DictSub(dict): pass
class SetSub(set): pass
class FrozensetSub(frozenset): pass
NAMESPACE.update(FloatSub=FloatSub, ComplexSub=ComplexSub, BytesSub=BytesSub, BytearraySub=BytearraySub, TupleSub=TupleSub, DictSub=DictSub, SetSub=SetSub, FrozensetSub=FrozensetSub)
DERIVED = {
    "IntSub": ["IntSub(5)", "IntSub(2 ** 70)", "IntSub(0)"], "FloatSub": ["FloatSub(1.5)", "FloatSub(2.0)"], "ComplexSub": ["ComplexSub(1 + 2j)"], "StrSub": ["StrSub('sub')", "StrSub('')", "StrSub('a b')"],
    "BytesSub": ["BytesSub(b'abc')", "BytesSub(b'')"], "BytearraySub": ["BytearraySub(b'abc')"], "ListSub": ["ListSub([1, 2])", "ListSub()"], "TupleSub": ["TupleSub((1, 2, 3))", "TupleSub()"],
    "DictSub": ["DictSub({'a': 1})", "DictSub()"], "SetSub": ["SetSub({1, 2})", "SetSub()"], "FrozensetSub": ["FrozensetSub({1, 2})", "FrozensetSub()"],
}
for names in DERIVED.values():
    for text in names:
        BY_NAME.setdefault(text, lambda code=compile(text, "<sample>", "eval"): eval(code, NAMESPACE))
RECEIVERS.update(DERIVED)
SKIPPED_METHODS |= {"__weakref__"}

# ---- Special methods that return what they should not, or raise ----

def odd(special, result):
    "An object whose method `special` returns `result`, or raises it."
    def method(self, *args):
        if isinstance(result, type) and issubclass(result, BaseException):
            raise result("raised")
        return result
    namespace = {special: method}
    if special == "__next__": namespace["__iter__"] = lambda self: self
    if special == "__length_hint__": namespace["__iter__"] = lambda self: iter((1, 2))
    if special == "__exit__": namespace["__enter__"] = lambda self: self
    if special == "__enter__": namespace["__exit__"] = lambda self, *args: None
    if special == "__eq__": namespace["__hash__"] = lambda self: 1
    return type("Odd", (), namespace)()

def with_statement(x):
    with x as y:
        return y
def with_raise(x):
    with x:
        raise KeyError("inside")
def unpack(x):
    a, b = x
    return a, b
def star(x): return [*x]
def call_star(x): return function(*x)
def call_double_star(x): return function(1, **x)
def printed(*args, **keywords):
    import io
    stream = io.StringIO()
    print(*args, file=stream, **keywords)
    return stream.getvalue()
def loop(x):
    out = []
    for item in x:
        out.append(item)
        if len(out) > 3: break
    return out
import os
RESULTS = ["None", "1", "0", "-1", "2", "1000", "2 ** 63 - 1", "2 ** 63", "-2 ** 63 - 1", "2 ** 64", "1.5", "nan", "1j", "'a'", "''", "b'a'", "True", "False", "()", "(1, 2)", "[]", "[1, 2]", "{}", "NotImplemented", "...", "IntSub(3)", "StrSub('s')", "FloatSub(1.5)",
           "BytesSub(b'x')", "ComplexSub(1j)", "iter([1, 2])", "object()", "int", "ZeroDivisionError", "StopIteration", "AttributeError", "TypeError", "KeyError", "IndexError", "OverflowError", "RecursionError", "KeyboardInterrupt"]
SPECIALS = {
    "__index__": ["operator.index", "lambda x: [1, 2, 3][x]", "lambda x: 'abc'[x]", "lambda x: b'abc'[x]", "lambda x: (1, 2, 3)[x]", "lambda x: range(5)[x]", "range", "lambda x: range(0, 5, x)", "bin", "hex", "oct", "lambda x: 'a' * x", "lambda x: [0] * x", "lambda x: [0, 1, 2][:x]",
                  "lambda x: [0, 1, 2][x:]", "lambda x: [0, 1, 2][::x]", "bytes", "bytearray", "int", "float", "complex", "lambda x: (5).to_bytes(x)", "lambda x: '%d' % x", "lambda x: '%x' % x", "lambda x: '%c' % x", "lambda x: '%s' % x", "lambda x: '%5.2f' % x", "chr",
                  "lambda x: format(x, 'd')", "lambda x: slice(x).indices(5)", "lambda x: slice(None).indices(x)", "lambda x: struct.pack('i', x)", "lambda x: struct.pack('q', x)", "lambda x: array('i', [x])", "lambda x: memoryview(b'abc')[x]", "lambda x: round(1.567, x)",
                  "lambda x: round(1234, x)", "lambda x: list(itertools.islice('abc', x))", "lambda x: 'abc'.center(x)", "lambda x: 'abc'.find('a', x)", "lambda x: int('1', x)", "lambda x: 1 << x", "lambda x: 1 + x", "lambda x: [1, 2, 3].pop(x)", "lambda x: [1, 2, 3].insert(x, 0)", "lambda x: bytes([x])",
                  "lambda x: bytearray(b'a').append(x)", "lambda x: x in b'abc'", "lambda x: b'abc'.find(x)", "lambda x: 'a b'.split(None, x)", "lambda x: math.gcd(x, 4)", "lambda x: math.isqrt(x)", "lambda x: math.comb(5, x)", "lambda x: math.ldexp(1.0, x)", "lambda x: deque([1, 2, 3])[x]",
                  "lambda x: deque([1, 2, 3], x)", "lambda x: deque([1, 2, 3]).rotate(x)", "lambda x: itertools.repeat(1, x)", "lambda x: list(itertools.combinations('abc', x))", "lambda x: list(enumerate('a', x))", "lambda x: sum([1], x)", "lambda x: divmod(x, 2)", "lambda x: pow(2, x)", "lambda x: hash(x) and 0",
                  "lambda x: int.from_bytes(b'a', 'big', signed=x)", "lambda x: 'a\\tb'.expandtabs(x)", "lambda x: 'abc'.zfill(x)", "lambda x: operator.mul('a', x)", "lambda x: operator.getitem([1, 2, 3], x)", "lambda x: operator.length_hint([], x)", "lambda x: os.fspath(x)", "lambda x: sys.getrecursionlimit() and sys.intern(x)"],
    "__int__": ["int", "float", "complex", "operator.index", "lambda x: '%d' % x", "lambda x: '%x' % x", "lambda x: '%c' % x", "math.trunc", "math.floor", "lambda x: [1, 2, 3][x]", "round", "bool", "lambda x: int(x, 10)", "chr", "lambda x: struct.pack('i', x)", "lambda x: IntSub(x)", "lambda x: range(x)"],
    "__float__": ["float", "int", "complex", "math.sqrt", "math.floor", "math.ceil", "math.trunc", "math.isnan", "math.fsum and (lambda x: math.fsum([x]))", "cmath.sqrt", "lambda x: '%f' % x", "lambda x: '%g' % x", "lambda x: '%d' % x", "lambda x: struct.pack('d', x)", "lambda x: array('d', [x])", "lambda x: complex(1, x)",
                  "lambda x: complex(x, 1)", "lambda x: FloatSub(x)", "round", "lambda x: math.pow(x, 2)", "lambda x: math.atan2(1, x)", "lambda x: math.hypot(x, 1)", "lambda x: math.copysign(1, x)", "lambda x: math.isclose(x, 1.5)", "lambda x: 1.0 + x", "lambda x: format(x, 'f')", "lambda x: sum([1.0, x])"],
    "__complex__": ["complex", "cmath.sqrt", "cmath.phase", "cmath.polar", "float", "lambda x: complex(x, 1)", "lambda x: complex(1, x)", "lambda x: ComplexSub(x)", "lambda x: cmath.isclose(x, 1j)", "lambda x: 1j + x"],
    "__bool__": ["bool", "operator.not_", "operator.truth", "lambda x: x and 1", "lambda x: x or 1", "lambda x: 1 if x else 2", "lambda x: list(filter(None, [x]))", "lambda x: all([x])", "lambda x: any([x])", "lambda x: sorted([2, 1], reverse=x)", "lambda x: 'a\\nb'.splitlines(x)",
                 "lambda x: [y for y in (1,) if x]", "lambda x: list(itertools.takewhile(lambda y: x, [1]))", "lambda x: list(itertools.compress('a', [x]))", "lambda x: list(zip('a', 'bc', strict=x))", "lambda x: int.from_bytes(b'\\xff', 'big', signed=x)", "lambda x: not x", "lambda x: len([x]) and bool(x) is bool(x)",
                 "lambda x: OrderedDict(a=1, b=2).popitem(x)", "lambda x: print(end='', flush=x)"],
    "__len__": ["len", "bool", "operator.length_hint", "list", "reversed", "lambda x: x[-1]", "lambda x: 1 if x else 2", "operator.not_", "lambda x: list(map(str, x))", "lambda x: [1, 2][:x]", "lambda x: tuple(x)", "lambda x: sorted(x)", "lambda x: dict(x)", "lambda x: bytes(x)"],
    "__hash__": ["hash", "lambda x: len({x})", "lambda x: len({x: 1})", "lambda x: len(frozenset([x]))", "lambda x: len(dict.fromkeys([x]))", "lambda x: x in {1}", "lambda x: x in {1: 2}", "lambda x: {}.get(x)", "lambda x: {1: 2}.pop(x, None)", "lambda x: set().discard(x)", "lambda x: hash((x,)) and 0",
                 "lambda x: functools.lru_cache(lambda y: 1)(x)", "lambda x: {}.setdefault(x, 1)", "lambda x: Counter([x]) and 0", "lambda x: OrderedDict([(x, 1)]) and 0", "lambda x: hash(frozenset([x])) and 0", "lambda x: hash(slice(x)) and 0", "lambda x: hash(functools.partial(x)) and 0"],
    "__iter__": ["iter", "list", "tuple", "loop", "unpack", "star", "call_star", "sum", "min", "sorted", "set", "dict", "''.join", "lambda x: list(zip(x))", "lambda x: list(map(str, x))", "lambda x: list(enumerate(x))", "lambda x: 1 in x", "lambda x: list(itertools.chain(x))", "all", "bytes", "bytearray",
                 "lambda x: [].extend(x)", "lambda x: deque(x)", "lambda x: array('i', x)", "lambda x: list(itertools.islice(x, 2))", "lambda x: [y for y in x]", "lambda x: {1}.union(x)", "lambda x: {}.update(x)", "lambda x: dict.fromkeys(x)", "lambda x: list(reversed(x))", "lambda x: functools.reduce(operator.add, x)",
                 "lambda x: operator.indexOf(x, 1)", "lambda x: operator.countOf(x, 1)", "lambda x: math.fsum(x)", "lambda x: math.prod(x)", "lambda x: b''.join(x)", "lambda x: frozenset(x)", "lambda x: [0, 1].__setitem__(slice(0, 1), x)", "lambda x: list(itertools.tee(x)[0])", "lambda x: next(x)", "lambda x: printed(*x)"],
    "__next__": ["next", "lambda x: next(x, 'default')", "loop", "lambda x: list(itertools.islice(x, 3))", "unpack", "lambda x: list(zip(x, 'ab'))", "lambda x: list(itertools.islice(map(str, x), 2))", "lambda x: 1 in x if False else next(iter(x))", "lambda x: list(itertools.islice(enumerate(x), 2))",
                 "lambda x: list(itertools.islice(itertools.chain(x, 'a'), 2))", "lambda x: list(itertools.islice((y for y in x), 2))", "lambda x: dict(zip('ab', x))"],
    "__repr__": ["repr", "str", "ascii", "format", "lambda x: '%r' % x", "lambda x: '%s' % x", "lambda x: '%a' % x", "lambda x: f'{x!r}'", "lambda x: f'{x}'", "lambda x: repr([x])", "lambda x: repr((x,))", "lambda x: repr({1: x})", "lambda x: repr({x})", "lambda x: '{!r}'.format(x)", "lambda x: str([x])",
                 "lambda x: repr(deque([x]))", "lambda x: repr(SimpleNamespace(a=x))", "lambda x: repr(functools.partial(len, x))", "lambda x: str(KeyError(x))", "lambda x: repr(ValueError(x))", "lambda x: str(ValueError(x))", "lambda x: repr(slice(x))", "lambda x: repr(OrderedDict(a=x))", "lambda x: b'%r' % x", "printed"],
    "__str__": ["str", "repr and (lambda x: len(repr(x)) > 0)", "format", "lambda x: '%s' % x", "lambda x: f'{x}'", "lambda x: f'{x!s}'", "lambda x: '{}'.format(x)", "lambda x: '{!s}'.format(x)", "lambda x: ''.join([x])", "lambda x: str(ValueError(x))", "lambda x: StrSub(x)", "printed", "lambda x: b'%s' % x",
                "lambda x: '%5s' % x", "lambda x: format(x, '')", "lambda x: format(x, 's')", "lambda x: str(x, 'utf-8')", "lambda x: 'a' + str(x)"],
    "__format__": ["format", "lambda x: format(x, 's')", "lambda x: f'{x}'", "lambda x: f'{x:>3}'", "lambda x: f'a{x}b'", "lambda x: '{}'.format(x)", "lambda x: '{:x}'.format(x)", "lambda x: '{0}{0}'.format(x)", "lambda x: f'{x!r:>3}' and 0", "lambda x: '%s' % x and 0", "lambda x: '{a}'.format_map({'a': x})"],
    "__bytes__": ["bytes", "lambda x: BytesSub(x)", "bytearray", "lambda x: b'%b' % x", "lambda x: b'%s' % x", "lambda x: b''.join([x])", "lambda x: bytes(x, 'ascii')", "lambda x: b'a' + x", "memoryview"],
    "__contains__": ["lambda x: 1 in x", "lambda x: 1 not in x", "lambda x: operator.contains(x, 1)", "lambda x: operator.countOf(x, 1)"],
    "__length_hint__": ["operator.length_hint", "lambda x: operator.length_hint(x, 5)", "list", "tuple", "bytes", "bytearray", "lambda x: [].extend(x)", "lambda x: list(map(str, x))", "sorted", "set", "lambda x: deque(x)", "lambda x: array('i', x)", "lambda x: ''.join(map(str, x))"],
    "__round__": ["round", "lambda x: round(x, 1)", "lambda x: round(x, None)"], "__trunc__": ["math.trunc", "int"], "__floor__": ["math.floor"], "__ceil__": ["math.ceil"],
    "__abs__": ["abs", "operator.abs"], "__neg__": ["operator.neg", "lambda x: -x"], "__pos__": ["operator.pos"], "__invert__": ["operator.invert"],
    "__getitem__": ["lambda x: x[0]", "lambda x: x[1:2]", "lambda x: x[1, 2]", "lambda x: list(itertools.islice(iter(x), 3))", "lambda x: list(itertools.islice(x, 3))", "lambda x: 'zz' in x if False else operator.getitem(x, 'k')", "unpack", "reversed", "call_double_star", "lambda x: '%(a)s' % x", "lambda x: '{0[a]}'.format(x)",
                    "lambda x: '{a}'.format_map(x)", "lambda x: operator.itemgetter(1)(x)", "lambda x: next(iter(x))", "lambda x: list(zip(x, 'ab'))"],
    "__eq__": ["lambda x: x == 1", "lambda x: 1 == x", "lambda x: x != 1", "lambda x: 1 != x", "lambda x: [x] == [1]", "lambda x: (x,) == (1,)", "lambda x: x in [1]", "lambda x: 1 in [x]", "lambda x: [1].index(x)", "lambda x: [1].count(x)", "lambda x: [x].remove(1)", "lambda x: {1: 2}.get(x)", "lambda x: x in {1}",
               "lambda x: {x: 1} == {1: 1}", "lambda x: {1: x} == {1: 1}", "lambda x: (1,).index(x)", "lambda x: deque([1]).index(x)", "lambda x: operator.indexOf([1], x)", "lambda x: operator.countOf([1], x)", "lambda x: x in deque([1])", "lambda x: x in range(3)", "lambda x: range(3).count(x)", "lambda x: x in {1: 2}.values()",
               "lambda x: array('i', [1]).index(x)", "lambda x: x in (y for y in (1,))", "lambda x: {x} == {1}", "lambda x: [x] != [1]", "lambda x: x is x and x == x", "lambda x: [x] == [x]", "lambda x: list(itertools.groupby([x, 1])) and 0"],
    "__lt__": ["lambda x: x < 1", "lambda x: 1 > x", "lambda x: 1 < x", "lambda x: sorted([x, x])", "lambda x: sorted([x, 1])", "lambda x: sorted([1, x])", "lambda x: min(x, x)", "lambda x: max(x, 1)", "lambda x: max(1, x)", "lambda x: [x] < [1]", "lambda x: (x,) < (1,)", "lambda x: [x] < [x]", "lambda x: heapq.heapify([x, x, x])",
               "lambda x: bisect.bisect([1], x)", "lambda x: bisect.bisect_left([x], 1)", "lambda x: heapq.nsmallest(1, [x, x])", "lambda x: x <= 1", "lambda x: [1, x].sort()", "lambda x: min([x, x], key=lambda y: y)"],
    "__call__": ["lambda x: x()", "callable", "lambda x: list(map(x, [1]))", "lambda x: sorted([2, 1], key=x)", "lambda x: list(filter(x, [1]))", "lambda x: functools.reduce(x, [1, 2])", "lambda x: functools.partial(x)()", "lambda x: defaultdict(x)[1]", "lambda x: list(itertools.islice(iter(x, 'stop'), 2))", "lambda x: max([1, 2], key=x)",
                 "lambda x: list(itertools.starmap(x, [(1,)]))", "lambda x: list(itertools.accumulate([1, 2], x))", "lambda x: sorted([2, 1], key=functools.cmp_to_key(x))", "lambda x: re.sub('a', x, 'a')", "lambda x: list(itertools.takewhile(x, [1]))", "lambda x: list(itertools.groupby([1], x))[0][0]", "lambda x: operator.call(x)"],
    "__enter__": ["with_statement"], "__exit__": ["with_statement", "with_raise"], "__dir__": ["dir"], "__reversed__": ["reversed", "lambda x: list(reversed(x))"], "__fspath__": ["os.fspath", "os.path.basename", "lambda x: os.path.join(x, 'a')", "os.fsencode", "os.fsdecode"],
    "__getattr__": ["lambda x: x.a", "lambda x: getattr(x, 'a', 'default')", "lambda x: hasattr(x, 'a')", "lambda x: operator.attrgetter('a')(x)", "lambda x: operator.methodcaller('a')(x)", "lambda x: '{0.a}'.format(x)", "copy.copy", "lambda x: len(pickle.dumps(x, 2)) and 0", "callable", "iter", "len", "int", "repr and (lambda x: 0)"],
    "__getattribute__": ["lambda x: x.a", "lambda x: getattr(x, 'a', 'default')", "lambda x: hasattr(x, 'a')", "lambda x: x.__class__", "lambda x: isinstance(x, int)", "lambda x: type(x).__name__", "callable", "lambda x: operator.attrgetter('a')(x)"],
    "__setattr__": ["lambda x: setattr(x, 'a', 1)"], "__delattr__": ["lambda x: delattr(x, 'a')"], "__setitem__": ["lambda x: operator.setitem(x, 0, 1)", "lambda x: operator.setitem(x, slice(1), 1)"], "__delitem__": ["lambda x: operator.delitem(x, 0)"],
    "__add__": ["lambda x: x + 1", "lambda x: 1 + x", "lambda x: operator.iadd(x, 1)", "lambda x: sum([x, 1])", "lambda x: sum([1], x)", "lambda x: operator.concat(x, x)", "lambda x: 'a' + x", "lambda x: [1] + x", "lambda x: x + x"],
    "__radd__": ["lambda x: 1 + x", "lambda x: x + 1", "lambda x: 'a' + x", "lambda x: [1] + x", "lambda x: sum([x])", "lambda x: sum([1, x])", "lambda x: 1.5 + x", "lambda x: None + x", "lambda x: operator.iadd([1], x)", "lambda x: operator.iadd(1, x)"],
    "__mul__": ["lambda x: x * 2", "lambda x: 2 * x", "lambda x: 'a' * x", "lambda x: [1] * x", "lambda x: operator.imul(x, 2)", "lambda x: math.prod([x, 2])"], "__rmul__": ["lambda x: 2 * x", "lambda x: 'a' * x", "lambda x: [1] * x", "lambda x: operator.imul([1], x)", "lambda x: math.prod([2, x])"],
    "__pow__": ["lambda x: x ** 2", "lambda x: pow(x, 2)", "lambda x: pow(x, 2, 3)", "lambda x: 2 ** x"], "__rpow__": ["lambda x: 2 ** x", "lambda x: pow(2, x)", "lambda x: pow(2, x, 3)"], "__divmod__": ["lambda x: divmod(x, 2)"], "__matmul__": ["lambda x: x @ 1", "lambda x: 1 @ x"],
    "__instancecheck__": ["lambda x: isinstance(1, x)", "lambda x: isinstance(1, (x,))", "lambda x: isinstance(1, (int, x))", "lambda x: isinstance(1, x | int)"], "__subclasscheck__": ["lambda x: issubclass(int, x)", "lambda x: issubclass(int, (x,))"],
    "__class_getitem__": ["lambda x: type(x)[int]", "lambda x: x[int]"], "__mro_entries__": ["lambda x: type('C', (x,), {})", "lambda x: types.new_class('C', (x,))", "lambda x: types.resolve_bases((x,))"], "__set_name__": ["lambda x: type('C', (), {'a': x}) and 0"],
    "__get__": ["lambda x: type('C', (), {'a': x})().a", "lambda x: type('C', (), {'a': x}).a", "lambda x: getattr(type('C', (), {'a': x})(), 'a', 'default')"], "__set__": ["lambda x: setattr(type('C', (), {'a': x})(), 'a', 1)"], "__delete__": ["lambda x: delattr(type('C', (), {'a': x})(), 'a')"],
    "__copy__": ["copy.copy"], "__deepcopy__": ["copy.deepcopy"], "__reduce__": ["copy.copy", "lambda x: pickled(x, 2)"], "__reduce_ex__": ["copy.copy", "copy.deepcopy", "lambda x: pickled(x, 4)"], "__getstate__": ["copy.copy", "lambda x: x.__reduce_ex__(2)[2]"], "__getnewargs__": ["lambda x: x.__reduce_ex__(2)[1][1:]"],
    "__getnewargs_ex__": ["lambda x: x.__reduce_ex__(4)[1][1:]"], "__sizeof__": ["lambda x: sys.getsizeof(x) and 0", "lambda x: sys.getsizeof(x, 'default') and 0"], "__missing__": ["lambda x: x[1]"], "__await__": ["lambda x: types.coroutine(lambda: (yield from x))().send(None)"], "__buffer__": ["memoryview", "bytes", "lambda x: b'a' + x", "lambda x: b''.join([x])"],
    "__replace__": ["copy.replace"], "__match_args__": ["lambda x: 0"], "__init__": ["lambda x: type(x)()", "lambda x: type(x)(1)"], "__new__": ["lambda x: type(x)()"], "__del__": ["lambda x: 0"], "__init_subclass__": ["lambda x: type('C', (type(x),), {}) and 0"], "__prepare__": ["lambda x: 0"],
}
import re
NAMESPACE.update(os=os, sys=sys, re=re, with_statement=with_statement, with_raise=with_raise, unpack=unpack, star=star, call_star=call_star, call_double_star=call_double_star, loop=loop, pickled=pickled, printed=printed)

def odd_group():
    for special, functions in SPECIALS.items():
        for text in functions:
            function = eval(text, NAMESPACE)
            for result in thin(RESULTS):
                def run(special=special, function=function, result=result):
                    if text == "lambda x: round(1234, x)" and result == "-2 ** 63 - 1":
                        return None  # 10 to that power.
                    try:
                        value = odd(special, eval(result, NAMESPACE))
                    except BaseException as e:
                        return "no such object: %s: %s" % (type(e).__name__, e)
                    return outcome(function, value).replace("__main__.", "").replace("grid.", "")
                yield special, "%s returns %s: %s" % (special, result, text), run

# ---- Arithmetic around the sizes where the representation of an int changes, and on many floats ----

EDGES = sorted({sign * (2 ** k + d) for k in (0, 7, 8, 15, 16, 30, 31, 32, 33, 52, 53, 54, 62, 63, 64, 65, 127, 128) for d in (-2, -1, 0, 1, 2) for sign in (1, -1)})
INT_PAIRS = {
    "+": operator.add, "-": operator.sub, "*": operator.mul, "//": operator.floordiv, "%": operator.mod, "/": operator.truediv, "divmod": divmod, "&": operator.and_, "|": operator.or_, "^": operator.xor, "<": operator.lt, "==": operator.eq,
    ">>": lambda a, b: a >> (abs(b) % 131), "<<": lambda a, b: a << (abs(b) % 131), "**": lambda a, b: a ** (abs(b) % 6), "pow3": lambda a, b: pow(a, abs(b) % 1000, abs(a ^ b) + 1), "inverse": lambda a, b: pow(a, -1, abs(b) + 2), "gcd": math.gcd, "lcm": math.lcm,
    "float op": lambda a, b: (a + float(b), a * float(b), a < float(b), a == float(b), float(a) // b if b else None, a - 0.5 < b), "round": lambda a, b: round(a, -(abs(b) % 25)), "to_bytes": lambda a, b: a.to_bytes(abs(b) % 20, "little", signed=True), "range": lambda a, b: (len(range(a, b)) if abs(a - b) < 2 ** 62 else None, range(a, b, 7)[-1:], a in range(b, a + 3)),
    "in-place": lambda a, b: [operator.iadd(a, b), operator.isub(a, b), operator.imul(a, b), operator.iand(a, b), operator.ior(a, b), operator.ixor(a, b)], "complex": lambda a, b: (complex(a, b), a + 1j * b == complex(a, b)), "Fraction": lambda a, b: fractions.Fraction(a, b) if b else None,
    "format": lambda a, b: ("%d %x %o %e" % (a, a, a, a), format(a, ","), format(a, "_x"), format(a, "+.3e"), format(a, "b")[-40:], "%*d" % (abs(b) % 30, a), f"{a:>{abs(b) % 40}}"),
}
INT_SINGLE = {"str": str, "repr int": lambda a: int(repr(a)) == a, "hash": hash, "float": float, "int float": lambda a: int(float(a)), "bit_length": int.bit_length, "bit_count": int.bit_count, "neg": operator.neg, "abs": abs, "invert": operator.invert, "isqrt": lambda a: math.isqrt(abs(a)), "hex": hex, "oct": oct, "bin": bin,
              "bool": bool, "as_integer_ratio": int.as_integer_ratio, "sqrt": lambda a: math.sqrt(abs(a)), "log": lambda a: (math.log(abs(a)), math.log2(abs(a)), math.log10(abs(a))) if a else None, "bytes": lambda a: int.from_bytes(a.to_bytes(20, "big", signed=True), "big", signed=True) == a, "pickle": lambda a: [pickle.dumps(a, p) for p in (0, 1, 2)],
              "struct": lambda a: [outcome(struct.pack, code, a) for code in "<b <B <h <H <i <I <q <Q <f <d <e <n".split()[:-1]], "array": lambda a: [outcome(array.array, code, [a]) for code in "bBhHiIlLqQfd"], "index": lambda a: [outcome(operator.getitem, s, a) for s in ("abc", [1, 2, 3], (1, 2, 3), b"abc", range(10 ** 30))],
              "chr": lambda a: outcome(chr, a), "sum": lambda a: (sum([a, a, a]), sum([a, 1.5]), sum([a] * 10, -a)), "json": lambda a: __import__("json").loads(__import__("json").dumps(a)) == a, "is_integer": lambda a: a.is_integer(), "key": lambda a: ({a: 1}[a], {float(a): 1}.get(a), a in {a}), "sorted": lambda a: sorted([a, a + 1, a - 1, float(a), -a]),
              "cube": lambda a: a * a * a, "square": lambda a: a ** 2, "divide": lambda a: (a // 3, a % 3, a // -3, a % -3, a / 3, a // 10 ** 18, a % 10 ** 18), "shift": lambda a: [a >> k for k in (1, 31, 32, 53, 63, 64)] + [a << k for k in (1, 21, 22, 31, 32)], "decimal": lambda a: str(a)[::-1]}

def ints_group():
    for name, function in INT_SINGLE.items():
        for a in thin(EDGES):
            yield name, "%s %d" % (name, a), lambda function=function, a=a: outcome(function, a)
    for name, function in INT_PAIRS.items():
        for a, b in thin(itertools.product(EDGES, EDGES)):
            yield name, "%d %s %d" % (a, name, b), lambda function=function, a=a, b=b: outcome(function, a, b)

def doubles(count, seed=12345):
    state = seed
    for _ in range(count):
        state = (state * 6364136223846793005 + 1442695040888963407) % 2 ** 64
        yield struct.unpack("<d", struct.pack("<Q", state))[0]
        yield ((state >> 11) - 2 ** 52) / 2.0 ** ((state & 63) + 20)  # Of ordinary size.
        yield float((state >> 40) - 2 ** 23) / 10 ** (state % 7)  # With few decimals.
FLOAT_SINGLE = {"repr": repr, "round trip": lambda x: float(repr(x)) == x or x != x, "hash": lambda x: hash(x) if x == x else None, "int": int, "hex": float.hex, "fromhex": lambda x: float.fromhex(x.hex()) == x or x != x, "ratio": float.as_integer_ratio, "round": round, "round 2": lambda x: round(x, 2), "round -2": lambda x: round(x, -2), "round 15": lambda x: round(x, 15),
                "%f": lambda x: "%.3f" % x if abs(x) < 1e50 else None, "%g": lambda x: "%.10g %g %.0g %#.3g" % (x, x, x, x), "%e": lambda x: "%e %.0e %.20e" % (x, x, x), ".0f": lambda x: format(x, ".0f") if abs(x) < 1e50 else None, ",": lambda x: format(x, ",.2f") if abs(x) < 1e50 else None, "%": lambda x: format(x, ".1%") if abs(x) < 1e50 else None, "n": lambda x: format(x, "n"),
                "format": lambda x: (format(x, ""), format(x, "10"), format(x, "+"), format(x, "z.1f") if abs(x) < 1e50 else None, format(x, ".17g"), format(x, "G"), format(x, "_.3f") if abs(x) < 1e50 else None), "floor": math.floor, "ceil": math.ceil, "trunc": math.trunc, "frexp": math.frexp, "modf": math.modf, "is_integer": float.is_integer, "// 1": lambda x: x // 1, "% 1": lambda x: x % 1,
                "divmod": lambda x: divmod(x, 3.7), "sqrt": lambda x: math.sqrt(abs(x)), "functions": lambda x: (math.sin(x), math.cos(x), math.atan(x), math.exp(x) if x < 700 else None, math.log(abs(x)) if x else None, math.tanh(x), math.erf(x), math.log1p(abs(x)), math.expm1(x) if x < 700 else None), "ulp": math.ulp, "nextafter": lambda x: math.nextafter(x, 0.0),
                "compare": lambda x: (x < 2 ** 53 + 1, x == int(x), x > -10 ** 30, x <= 2 ** 63, x == 2 ** 1023 * 2, x < fractions.Fraction(1, 3)), "struct": lambda x: [outcome(struct.pack, code, x) for code in ("<d", ">f", "<e")], "str complex": lambda x: (str(complex(x, -x)), repr(complex(0.0, x))), "pickle": lambda x: [pickle.dumps(x, p) for p in (0, 2)],
                "json": lambda x: __import__("json").dumps(x), "Fraction": lambda x: str(fractions.Fraction(x))[:60], "** 2": lambda x: outcome(operator.pow, x, 2), "** .5": lambda x: outcome(operator.pow, x, 0.5), "** -1": lambda x: outcome(operator.pow, x, -1), "sum": lambda x: (sum([x, 1e16, -1e16]), math.fsum([x, 1e16, -1e16])), "gamma": lambda x: outcome(math.gamma, x) if abs(x) < 170 else None}
FLOAT_PAIRS = {"+": operator.add, "-": operator.sub, "*": operator.mul, "/": operator.truediv, "//": operator.floordiv, "%": operator.mod, "divmod": divmod, "<": operator.lt, "==": operator.eq, "**": operator.pow, "atan2": math.atan2, "hypot": math.hypot, "fmod": math.fmod, "remainder": math.remainder, "copysign": math.copysign, "pow": math.pow,
               "fma": getattr(math, "fma", None) and (lambda x, y: math.fma(x, y, 1.0)), "isclose": math.isclose, "nextafter": math.nextafter, "ldexp": lambda x, y: math.ldexp(x, int(y) % 100 - 50) if y == y and abs(y) != inf else None, "complex *": lambda x, y: complex(x, y) * complex(y, x), "complex /": lambda x, y: complex(x, 1) / complex(y, 2), "max": max, "dist": lambda x, y: math.dist((x, y), (y, x))}

def floats_group():
    values = list(doubles(1500)) + FLOATS + [2.0 ** k for k in (-1074, -1022, -53, -1, 31, 32, 52, 53, 63, 64, 1023)] + [0.5, 1.5, 2.5, 3.5, -0.5, -1.5, 2.675, 1.005, 0.125, 1e15 + 0.5, 1e22, 1e23, 9007199254740993.0, 0.1 + 0.2, 5e-324 * 3, 1.7976931348623157e308]
    for name, function in FLOAT_SINGLE.items():
        for x in thin(values):
            yield name, "%s %r" % (name, x), lambda function=function, x=x: outcome(function, x)
    for name, function in FLOAT_PAIRS.items():
        for x, y in thin(zip(values, values[7:] + values[:7])):
            yield name, "%r %s %r" % (x, name, y), lambda function=function, x=x, y=y: outcome(function, x, y)

# ---- What str knows about every character: one line for 256 of them ----

CHARACTER = {name: getattr(str, name) for name in "isalpha isdigit isdecimal isnumeric isalnum isspace isupper islower istitle isprintable isidentifier upper lower title capitalize casefold swapcase".split()}
CHARACTER.update({"repr": repr, "ascii": ascii, "split": lambda c: ("a" + c + "b").split(), "splitlines": lambda c: ("a" + c + "b").splitlines(), "strip": lambda c: (c + "a" + c).strip(), "int": lambda c: outcome(int, c)[:12], "float": lambda c: outcome(float, c)[:12], "utf-8": lambda c: outcome(c.encode, "utf-8")[:30],
                  "utf-16": lambda c: outcome(c.encode, "utf-16-le")[:30], "identifier": lambda c: ("a" + c).isidentifier(), "width": lambda c: (len(c), len(c + c), len(c.center(3)), (c * 3)[1] == c, c in "a" + c), "title word": lambda c: ("a" + c + "b").title(), "lower sigma": lambda c: ("A" + c + "Σ").lower(), "format": lambda c: format(c, c + "^3") if c not in "{}" else None,
                  "compare": lambda c: (c < "￿", c < "\U00010000", c > "z", sorted([c, "퟿", "", "\U00010000"]).index(c)), "escape": lambda c: outcome(c.encode, "unicode_escape")[:20], "hash equal": lambda c: hash(c) == hash(chr(ord(c))), "find": lambda c: ("ab" + c + "cd" + c).find(c, 3), "translate": lambda c: "abc".translate({98: c}), "ord": lambda c: ord(c)})

def characters_group():
    blocks = list(range(0, 0x32400, 0x100)) + list(range(0xE0000, 0xE0200, 0x100)) + [0xF0000, 0x10FF00]
    for name, function in CHARACTER.items():
        for start in thin(blocks):
            def run(function=function, start=start):
                digest = hashlib.md5()
                for code in range(start, start + 0x100):
                    digest.update(ascii(function(chr(code))).encode())
                return digest.hexdigest()[:12]
            yield name, "%s %06x" % (name, start), run

# ---- Attributes: reading, setting and deleting them on everything ----

EVERYTHING = []
for _name, _make in ALL + [(text, BY_NAME[text]) for names in list(MORE_RECEIVERS.values()) + list(DERIVED.values()) for text in names]:
    if _name not in [n for n, _ in EVERYTHING] and not (isinstance(_make(), (int, float, complex, str, bytes)) and type(_make()) in (int, float, complex, str, bytes) and _name not in ("1", "1.5", "1j", "'abc'", "b'abc'", "18446744073709551616")):
        EVERYTHING.append((_name, _make))
EVERYTHING += [(text, lambda code=compile(text, "<sample>", "eval"): eval(code, NAMESPACE)) for text in ("Plain()", "Plain", "Slotted()", "Slotted", "math", "sys.flags", "sys.version_info", "os.stat_result(range(10))", "super(IntSub, IntSub(1))", "type('M', (type,), {})('C', (), {})", "types.GenericAlias(list, int)", "int | str", "typing.TypeVar('T')", "weakref.ref(Plain)", "memoryview(bytearray(b'ab'))", "range(3).__iter__", "Plain.method", "Plain.__dict__['method']", "Plain.__dict__", "globals", "(lambda: (yield))()", "coroutine_type", "staticmethod(len).__func__", "property(len).getter", "frame_like")]
class Slotted:
    __slots__ = ("a", "b")
    def __init__(self): self.a = 1
import weakref, typing
NAMESPACE.update(Slotted=Slotted, weakref=weakref, typing=typing, coroutine_type=types.CoroutineType, frame_like=types.FrameType)
ATTRIBUTES = ["x", "a", "b", "__class__", "__dict__", "__doc__", "__name__", "__qualname__", "__module__", "__slots__", "__weakref__", "real", "imag", "start", "args", "__len__", "__call__", "__hash__", "__eq__", "__init__", "__new__", "__bases__", "__mro__", "__self__", "__func__", "__wrapped__", "__code__", "__defaults__",
              "__kwdefaults__", "__annotations__", "__closure__", "__globals__", "__type_params__", "__traceback__", "__cause__", "__context__", "__suppress_context__", "__notes__", "maxlen", "default_factory", "typecode", "itemsize", "fget", "__isabstractmethod__", "__abstractmethods__", "__text_signature__", "__objclass__", "", "1", "a b", "\u20ac", "\ud800"]
VALUES = pick("None", "1", "'a'", "()", "{}", "int", "[]", "lambda x: x", "True", "(1, 2, 3)", "{'a': 1, 'b': 2}", "object()")

def short(text):
    "Of what is read, the kind is enough where the value is long or says where something is."
    return text if len(text) < 100 else text[:60] + "..."

def attributes_group():
    for sample, make in EVERYTHING:
        for name in thin(ATTRIBUTES):
            yield "get", "getattr(%s, %a)" % (sample, name), lambda make=make, name=name: short(outcome(lambda: type(getattr(make(), name)).__name__ if name in ("__dict__", "__globals__", "__doc__", "__code__", "__hash__", "__mro__", "__bases__", "__weakref__", "__text_signature__", "__module__") else getattr(make(), name)))
            yield "del", "delattr(%s, %a)" % (sample, name), lambda make=make, name=name: changed(delattr, make, name)
            for value, make_value in VALUES:
                yield "set", "setattr(%s, %a, %s)" % (sample, name, value), lambda make=make, name=name, make_value=make_value: changed(setattr, make, name, make_value())
        for name, make_name in pick("None", "1", "b'a'", "()", "StrSub('sub')", "1.5"):
            yield "names", "getattr(%s, %s)" % (sample, name), lambda make=make, make_name=make_name: [outcome(getattr, make(), make_name()), outcome(hasattr, make(), make_name()), outcome(setattr, fresh(make), make_name(), 1), outcome(delattr, fresh(make), make_name()), outcome(getattr, make(), make_name(), "default")]

def changed(operation, make, name, *value):
    target = fresh(make)
    shared = name == "__module__" and isinstance(target, types.BuiltinFunctionType)  # There is only one len().
    if shared: saved = target.__module__
    result = outcome(operation, target, name, *value)
    if shared: target.__module__ = saved
    return result

def fresh(make):
    "What setting attributes on does not change for the calls that follow: a copy of a class, a function or a module of this file."
    value = make()
    if isinstance(value, type) and value.__module__ not in ("builtins", "types", "collections", "typing"):
        return type(value)(value.__name__, value.__bases__, {k: v for k, v in vars(value).items() if k not in ("__dict__", "__weakref__", "a", "b")})
    if isinstance(value, types.FunctionType):
        return types.FunctionType(value.__code__, {}, value.__name__, value.__defaults__, value.__closure__)
    if isinstance(value, types.MethodType) and isinstance(value.__func__, types.FunctionType):
        return types.MethodType(fresh(lambda: value.__func__), value.__self__)
    if isinstance(value, types.ModuleType):
        return types.ModuleType(value.__name__)
    return value

# ---- Which abstract base classes everything belongs to ----

import collections.abc, numbers
ABCS = [getattr(collections.abc, n) for n in sorted(collections.abc.__all__)] + [numbers.Number, numbers.Complex, numbers.Real, numbers.Rational, numbers.Integral, os.PathLike, typing.SupportsInt, typing.SupportsFloat, typing.SupportsIndex, typing.SupportsAbs, typing.SupportsRound, typing.SupportsBytes, typing.SupportsComplex, typing.Hashable]

def abcs_group():
    for sample, make in EVERYTHING:
        yield "isinstance", "abcs of %s" % sample, lambda make=make: outcome(lambda: " ".join(c.__name__ for c in ABCS if isinstance(make(), c)))
        yield "callable", "callable %s" % sample, lambda make=make: (callable(make()), outcome(lambda: bool(make())), outcome(lambda: type(make()).__mro__), type(make()).__module__, type(make()).__qualname__, type(make()).__flags__ & 0x7f5003e0 & ~(1 << 14) & ~(1 << 19))

# ---- The types there are: what is in them, and of what kind ----

def all_types():
    seen = {}
    for module in (__import__("builtins"), types, collections, itertools, functools, operator, array, struct, __import__("contextvars")):
        for name in sorted(dir(module)):
            value = getattr(module, name)
            if isinstance(value, type) and value.__module__ in ("builtins", "collections", "itertools", "functools", "operator", "array", "_struct", "re", "weakref", "_weakref", "_io", "io", "_thread", "_contextvars", "types", "_collections", "_functools", "_operator") and not hasattr(value, "__dict__['__module__']"):
                if type(vars(value).get("__init__")).__name__ != "function" and type(vars(value).get("__repr__")).__name__ != "function":
                    seen.setdefault(value.__module__ + "." + value.__qualname__, value)
    for _, make in EVERYTHING:
        kind = type(make())
        if kind.__module__ == "builtins":
            seen.setdefault("builtins." + kind.__qualname__, kind)
    return seen

# How large objects are, how CPython calls them and that it finalizes them through a method say nothing about the language.
NOT_COMPARED = ("__doc__", "__module__", "__dict__", "__weakref__", "__sizeof__", "__del__", "__vectorcalloffset__")

def types_group():
    for name, kind in thin(sorted(all_types().items())):
        yield "names", "dir(%s)" % name, lambda kind=kind: " ".join(sorted(set(vars(kind)) - set(NOT_COMPARED)))
        yield "bases", "bases of %s" % name, lambda kind=kind: (kind.__bases__, kind.__name__, kind.__module__, outcome(lambda: type("D", (kind,), {}).__name__), kind.__doc__ is None, outcome(lambda: kind.__text_signature__), outcome(lambda: kind.__basicsize__ > 0), type(kind).__name__)
        for attribute, value in sorted(vars(kind).items()):
            if attribute in NOT_COMPARED:
                continue
            yield "kinds", "%s.%s" % (name, attribute), lambda value=value: (type(value).__name__, getattr(value, "__text_signature__", None), getattr(value, "__name__", None), getattr(value, "__qualname__", None))
            yield "docs", "doc of %s.%s" % (name, attribute), lambda value=value: getattr(value, "__doc__", None) if type(value).__name__ not in ("int", "str", "tuple", "NoneType", "bool", "dict") else None
        yield "docs", "doc of %s" % name, lambda kind=kind: kind.__doc__

# ---- Exceptions: every class with every number of arguments ----

EXCEPTIONS = sorted((n for n, v in vars(__import__("builtins")).items() if isinstance(v, type) and issubclass(v, BaseException)))
ARGUMENTS = ["()", "(1,)", "('m',)", "(None,)", "(1, 2)", "(2, 'm')", "('a', 'b')", "(2, 'm', 'f')", "(2, 'm', None)", "(2, 'm', 'f', 3)", "(2, 'm', 'f', None, 'g')", "(2, 'm', 'f', 3, 'g', 6)", "('m', ('f', 1, 2, 't'))", "('m', ('f', 1, 2, 't', 3, 4))", "('m', ('f', 1, 2))", "('m', ('f', 1, 2, 't', 3))", "('m', 1)", "('m', None)", "('m', [])",
             "('m', [ValueError(1)])", "('m', [ValueError(1), KeyboardInterrupt()])", "('m', (ValueError(1),))", "('m', [1])", "(1, [ValueError(1)])", "('utf-8', b'ab', 0, 1, 'r')", "('utf-8', 'ab', 0, 1, 'r')", "('ab', 0, 1, 'r')", "('utf-8', bytearray(b'ab'), 0, 1, 'r')", "('utf-8', b'ab', 0, 1)", "(1, b'ab', 0, 1, 'r')", "('utf-8', b'ab', 'x', 1, 'r')",
             "('utf-8', b'ab', 2 ** 63, 1, 'r')", "('utf-8', '\\u20ac\\U0001f600', 0, 2, 'r')", "('utf-8', b'ab', -1, 5, 'r')", "((1, 2),)", "([],)", "(ValueError(1),)", "(1.5,)", "(b'x',)", "(StrSub('s'),)", "(13, 'm')", "(17, 'm')", "(11, 'm')", "(32, 'm')", "(4, 'm')", "(10, 'm')", "(110, 'm')", "(111, 'm')", "(104, 'm')", "(103, 'm')", "(21, 'm')", "(20, 'm')", "(1, 'm')", "(3, 'm')", "(2 ** 64, 'm')", "('2', 'm')", "(True, 'm')"]
FIELDS = "args errno strerror filename filename2 characters_written msg lineno offset text end_lineno end_offset print_file_and_line code value name path name_from obj encoding object start end reason message exceptions __cause__ __context__ __suppress_context__ __traceback__ __notes__ __dict__".split()

def exceptions_group():
    for name in EXCEPTIONS:
        kind = getattr(__import__("builtins"), name)
        for text in thin(ARGUMENTS):
            def run(kind=kind, text=text):
                e = kind(*eval(text, NAMESPACE))
                return (type(e).__name__, repr(e), str(e), [(f, show(getattr(e, f))) for f in FIELDS if hasattr(e, f) and getattr(e, f) not in (None, False)], outcome(lambda: e.__reduce__()[1:]), outcome(lambda: repr(copy.copy(e))), outcome(lambda: repr(pickle.loads(pickle.dumps(e)))), outcome(lambda: e.__setstate__({"extra": 1}) or e.extra))
            yield name, "%s%s" % (name, text), lambda run=run: outcome(run)
        for keywords in ("{'name': 'n'}", "{'obj': 1}", "{'path': 'p'}", "{'name_from': 'f'}", "{'name': 'n', 'obj': 1}", "{'nope': 1}", "{'errno': 1}", "{'args': ()}", "{'message': 'm'}"):
            yield name, "%s(**%s)" % (name, keywords), lambda kind=kind, keywords=keywords: outcome(lambda: (lambda e: (repr(e), e.args, getattr(e, "name", "-"), getattr(e, "obj", "-"), getattr(e, "path", "-")))(kind("m", **eval(keywords))))
        yield name, "%s: class" % name, lambda kind=kind: (kind.__bases__, kind.__module__, sorted(vars(kind)), kind.__doc__, outcome(lambda: kind.__new__(kind).args), outcome(lambda: str(kind.__new__(kind))), outcome(lambda: type("D", (kind, ), {})().args), outcome(lambda: type("D", (kind, Exception), {}).__mro__[1:3]), outcome(lambda: type("D", (kind, OSError), {}).__name__), outcome(lambda: type("D", (kind, SyntaxError), {}).__name__))
        for field in thin(FIELDS):
            for value, make in pick("None", "1", "'a'", "()", "(1, 2, 3)", "[]", "object()", "9223372036854775808", "1.5", "True", "b'a'"):
                def run(kind=kind, field=field, make=make):
                    e = kind.__new__(kind)
                    setattr(e, field, make())
                    return show(getattr(e, field)), outcome(str, e), outcome(repr, e)
                yield "set " + field, "%s().%s = %s" % (name, field, value), lambda run=run: outcome(run)
            yield "del " + field, "del %s().%s" % (name, field), lambda kind=kind, field=field: outcome(lambda: (lambda e: (delattr(e, field), outcome(getattr, e, field), outcome(str, e)))(kind.__new__(kind)))

# ---- Calls of functions written in Python: how arguments are bound, and what is said when they cannot be ----

SIGNATURES = ["()", "(a)", "(a, b)", "(a, b=2)", "(a=1, b=2)", "(*a)", "(**k)", "(a, *b)", "(a, **k)", "(*a, **k)", "(a, /)", "(a, /, b)", "(a, /, b=2)", "(a=1, /)", "(a, /, **k)", "(*, a)", "(*, a=1)", "(*, a, b)", "(*, a, b=2)", "(a, *, b)", "(a, *, b=2)", "(a, b, c)", "(a, b, c, d, e)", "(a, /, b, *, c)", "(a, /, b=2, *c, d, e=5, **k)",
              "(a, *b, c)", "(a, *b, c=3)", "(a, b=2, *c, d=4, **e)", "(self)", "(self, a)", "(a, b, /, c, d, *, e, f)", "(a=1, *b, c=3, **d)"]
CALLS = ["()", "(1)", "(1, 2)", "(1, 2, 3)", "(1, 2, 3, 4, 5, 6)", "(a=1)", "(b=2)", "(a=1, b=2)", "(1, a=1)", "(1, b=2)", "(1, 2, b=2)", "(c=3)", "(1, c=3)", "(1, 2, c=3)", "(a=1, b=2, c=3)", "(x=1)", "(1, x=1)", "(x=1, y=2)", "(*[1])", "(*[1, 2])", "(*[1, 2, 3])", "(**{'a': 1})", "(**{'b': 2})", "(**{'a': 1, 'b': 2})", "(1, **{'a': 1})", "(a=1, **{'a': 1})",
         "(**{'x': 1})", "(*[1], **{'b': 2})", "(*1)", "(**1)", "(*None)", "(**None)", "(**[1])", "(**{1: 2})", "(*'ab')", "(*[1], *[2])", "(**{'a': 1}, **{'a': 2})", "(**{'a': 1}, **{'b': 2})", "(1, 2, 3, d=4)", "(1, d=4)", "(1, 2, 3, 4, e=5, f=6)", "(1, 2, c=3, d=4, e=5, f=6)", "(1, 2, 3, 4)", "(1, 2, 3, 4, e=5)", "(e=5, f=6)", "(self=1)", "(1, self=1)",
         "(*iter([1, 2]))", "(**OrderedDict(a=1))", "(**MappingProxyType({'a': 1}))", "(*range(3))", "(**Plain())", "(*Plain())", "(1, *[2], 3)", "(1, *[2], b=3)", "(d=4, e=5)", "(1, d=4, x=9)", "(1, 2, 3, 4, 5, d=4, x=9, y=10)"]

def calls_group():
    for signature in SIGNATURES:
        names = re.findall(r"\w+(?==|,|\)|$)", re.sub(r"=\d", "", signature))
        scope = dict(NAMESPACE)
        exec("def target%s: return (%s)\nclass Holder:\n    def method%s: return (%s)\n    @classmethod\n    def class_method%s: return 0\n    @staticmethod\n    def static_method%s: return 0\ntarget_lambda = lambda %s: 0\ndef generator%s: yield 0\nasync def coroutine%s: return 0\nclass Init:\n    def __init__%s: pass\nclass Call:\n    def __call__%s: return 0" %
             (signature, "".join(n + ", " for n in names), signature, "".join(n + ", " for n in names), signature, signature, signature[1:-1], signature, signature, signature, signature), scope)
        for call in thin(CALLS):
            for target in ("target", "Holder().method", "Holder.method", "Holder.class_method", "Holder().static_method", "target_lambda", "generator", "Init", "Call()", "functools.partial(target, 1)", "functools.partial(target, a=1)", "coroutine"):
                code = compile(target + call, "<call>", "eval")
                def run(code=code, scope=scope, target=target):
                    result = outcome(lambda: eval(code, scope))
                    return re.sub(r"<locals>\.|calls_group\.", "", result) if target not in ("generator", "coroutine", "Init") or "Error" in result else "made"
                yield signature, "def %s: %s%s" % (signature, target, call), run

# ---- Containers that change while something goes through them ----

def scenario(text):
    scope = dict(NAMESPACE)
    exec(text, scope)
    return scope.get("result")

class Evil:
    "Equal to everything, or less than everything; and does something each time it is asked."
    def __init__(self, action, answer=True, hashed=1): self.action, self.answer, self.hashed = action, answer, hashed
    def __eq__(self, other): self.action(); return self.answer
    def __lt__(self, other): self.action(); return self.answer
    def __hash__(self): return self.hashed
    def __repr__(self): return "Evil"
    def __index__(self): self.action(); return 0
    def __len__(self): self.action(); return 0
    def __bool__(self): self.action(); return self.answer
    def __call__(self, *args): self.action(); return self.answer
NAMESPACE.update(Evil=Evil)
MUTATIONS = r"""l = [1, 2, 3]\nfor x in l: l.append(x) if len(l) < 6 else None\nresult = l
l = [1, 2, 3]\nfor x in l: l.remove(x)\nresult = l
l = [1, 2, 3, 4]\nresult = []\nfor x in l:\n    result.append(x); l.pop()
l = [1, 2, 3]\nresult = []\nfor x in reversed(l):\n    result.append(x); l.pop() if len(l) > 1 else None
l = [1, 2, 3]\nit = iter(l); next(it); l.clear(); result = (list(it), list(it)); l.append(1); result += (list(it),)
l = [1, 2, 3]\nit = reversed(l); next(it); l.clear(); result = list(it)
l = [1, 2, 3]\nit = reversed(l); l.extend([4, 5]); result = list(it)
l = [3, 1, 2]\nl.sort(key=lambda x: l.append(x) or x)\nresult = l
l = [3, 1, 2]\nl.sort(key=lambda x: l.clear() or x)\nresult = l
l = [3, 1, 2]\nl.sort(key=lambda x: len(l))\nresult = l
l = [Evil(lambda: l.append(1)), Evil(lambda: None)]\nl.sort()\nresult = len(l)
l = [Evil(lambda: l.clear()), Evil(lambda: None), Evil(lambda: None)]\nl.sort()\nresult = len(l)
l = [3, 1, 2]\nresult = sorted(l, key=lambda x: l.clear() or x), l
l = [1, 2, 3]\nresult = l.index(Evil(lambda: l.clear())), l
l = [1, 2, 3]\nresult = l.index(Evil(lambda: l.clear(), False)), l
l = [1, 2, 3]\nresult = l.count(Evil(lambda: l.clear())), l
l = [1, 2, 3]\nresult = l.count(Evil(lambda: l.pop())), l
l = [1, 2, 3]\nresult = l.remove(Evil(lambda: l.clear())), l
l = [1, 2, 3]\nresult = l.remove(Evil(lambda: l.clear(), False)), l
l = [1, 2, 3]\nresult = Evil(lambda: l.clear()) in l, l
l = [1, 2, 3]\nresult = Evil(lambda: l.clear(), False) in l, l
l = [1, 2, 3]\nresult = l == [Evil(lambda: l.clear()), 2, 3], l
l = [1, 2, 3]\nresult = l == [Evil(lambda: l.clear(), False), 2, 3], l
l = [1, 2, 3]\nresult = l < [Evil(lambda: l.clear(), False), 2, 3], l
l = [1, 2, 3]\nresult = [Evil(lambda: l.clear()), 2, 3] == l, l
l = [1, 2, 3]\nl.extend(l)\nresult = l
l = [1, 2, 3]\nl += l\nresult = l
l = [1, 2, 3]\nl[:] = l\nresult = l
l = [1, 2, 3]\nl[1:] = l\nresult = l
l = [1, 2, 3]\nl[::2] = l[::2]\nresult = l
l = [1, 2, 3]\nl[::-1] = l\nresult = l
l = [1, 2, 3]\nl.extend(x for x in l if len(l) < 8)\nresult = l
l = [1, 2, 3]\nl.extend(iter(l)) if False else None\nresult = l
l = [1, 2, 3]\nl[Evil(lambda: l.clear())] = 5\nresult = l
l = [1, 2, 3]\nresult = l[Evil(lambda: l.clear())]
l = [1, 2, 3]\nresult = l[Evil(lambda: l.clear()):], l
l = [1, 2, 3]\nl[Evil(lambda: l.clear()):] = [7]\nresult = l
l = [1, 2, 3]\ndel l[Evil(lambda: l.clear()):]\nresult = l
l = [1, 2, 3]\nresult = l.pop(Evil(lambda: l.clear()))
l = [1, 2, 3]\nl.insert(Evil(lambda: l.clear()), 9)\nresult = l
l = [1, 2, 3]\nresult = l * Evil(lambda: l.clear()), l
l = [1, 2, 3]\nl *= Evil(lambda: l.append(4))\nresult = l
l = [1, 2, 3]\nl[0:2] = (l.clear() or x for x in (7, 8))\nresult = l
l = [1, 2, 3]\nl[::2] = (l.append(0) or x for x in (7, 8))\nresult = l
l = [1, 2, 3]\nresult = list(map(lambda x: l.pop(), l)), l
l = [1, 2, 3]\nresult = [l.pop() for x in l], l
l = [1, 2, 3]\nresult = list(zip(l, map(lambda x: l.clear(), l)))
l = [1, 2, 3]\nresult = max(l, key=lambda x: l.clear() or x)
l = [1, 2, 3]\nresult = sum(l.pop() for x in l)
l = [1, 2, 3]\nresult = tuple(l.pop() for x in l)
l = [[1], [2]]\nresult = repr([Plain.__repr__ and l, l.append(3)][0])
l = [1, 2, 3]\nresult = list(enumerate(l.append(9) or x for x in l[:2])), l
l = [1, 2, 3]\na, *b = (l.pop() for x in l)\nresult = a, b
l = list(range(10))\nresult = [x for x in l if not l.remove(x)]
l = [1, 2, 3]\nresult = ''.join(str(l.pop()) for x in l)
l = ['a', 'b', 'c']\nresult = StrSub('-').join(l)
l = [1, 2, 3]\nresult = heapq.heappush(l, Evil(lambda: l.clear())), l
l = [Evil(lambda: l.clear()), Evil(lambda: None), Evil(lambda: None)]\nresult = heapq.heappop(l) and 0, len(l)
l = [Evil(lambda: l.clear()), Evil(lambda: None), Evil(lambda: None)]\nresult = heapq.heapify(l), len(l)
l = [1, 2, 3]\nresult = bisect.bisect(l, Evil(lambda: l.clear())), l
l = [1, 2, 3]\nresult = bisect.insort(l, Evil(lambda: l.clear())), len(l)
d = {1: 1, 2: 2}\nfor k in d: d[k + 10] = 1\nresult = d
d = {1: 1, 2: 2}\nfor k in d: del d[k]\nresult = d
d = {1: 1, 2: 2}\nfor k in d: d[k] = 5\nresult = d
d = {1: 1, 2: 2}\nfor k in d:\n    del d[k]; d[k + 10] = 1\nresult = d
d = {1: 1, 2: 2}\nfor k in d.values(): d[k + 10] = 1\nresult = d
d = {1: 1, 2: 2}\nfor k in d.items(): d.clear()\nresult = d
d = {1: 1, 2: 2}\nfor k in reversed(d): d[k + 10] = 1\nresult = d
d = {1: 1, 2: 2}\nfor k in reversed(d.items()): d.clear()\nresult = d
d = {1: 1, 2: 2}\nit = iter(d); next(it); d[3] = 3\nresult = outcome(next, it), outcome(next, it), outcome(it.__length_hint__)
d = {1: 1, 2: 2}\nit = iter(d); list(it); d[3] = 3\nresult = outcome(next, it)
d = {1: 1, 2: 2}\nit = iter(d); d[3] = 3; del d[3]\nresult = outcome(list, it)
d = {1: 1, 2: 2}\nit = iter(d); d.pop(2); d[2] = 2\nresult = outcome(list, it)
d = {1: 1, 2: 2}\nk = d.keys(); d[3] = 3\nresult = list(k), len(k), 3 in k
d = {1: 1, 2: 2}\nd.update(d)\nresult = d
d = {1: 1, 2: 2}\nd.update((k + 10, d.pop(k)) for k in list(d))\nresult = d
d = {1: 1, 2: 2}\nd.update((k, 1) for k in d)\nresult = d
d = {1: 1, 2: 2}\nd.update((k + 10, 1) for k in d)\nresult = d
d = {1: 1, 2: 2}\nd |= d\nresult = d
d = {1: 1, 2: 2}\nresult = d == {1: Evil(lambda: d.clear()), 2: 2}, d
d = {1: Evil(lambda: d.clear()), 2: 2}\nresult = d == {1: 1, 2: 2}, len(d)
d = {1: Evil(lambda: d.__setitem__(3, 3)), 2: 2}\nresult = d == {1: 1, 2: 2}, len(d)
d = {Evil(lambda: None): 1}\nresult = d[Evil(lambda: d.clear())]
d = {Evil(lambda: None): 1}\nresult = d.get(Evil(lambda: d.clear(), False)), d
d = {Evil(lambda: None): 1}\nd[Evil(lambda: d.clear())] = 2\nresult = len(d)
d = {Evil(lambda: None): 1}\nresult = d.setdefault(Evil(lambda: d.clear()), 2), len(d)
d = {Evil(lambda: None): 1}\nresult = d.pop(Evil(lambda: d.clear()), 'default'), len(d)
d = {Evil(lambda: None): 1}\nresult = Evil(lambda: d.clear()) in d, len(d)
d = {Evil(lambda: None): 1}\ndel d[Evil(lambda: d.clear())]\nresult = len(d)
d = {Evil(lambda: None): 1}\nresult = d.keys() == {Evil(lambda: d.clear())}, len(d)
d = {Evil(lambda: None, hashed=i): i for i in range(3)}\nresult = len(dict(d)), len(d.copy()), len({**d})
d = {1: 1, 2: 2}\nresult = repr({1: d, 2: d.setdefault(3, 3)})
d = {1: 1, 2: 2}\nresult = [d.popitem() for k in list(d)], d
d = {1: 1, 2: 2}\nresult = [d.popitem() for k in d]
d = {1: 1, 2: 2}\nresult = dict.fromkeys(d, d.clear())
d = {1: 1, 2: 2}\nresult = dict.fromkeys(d.pop(k) for k in list(d)), d
d = {1: 1, 2: 2}\nresult = sorted(d, key=lambda k: d.clear() or k)
d = {1: 1, 2: 2}\nresult = list(d.items() & {(1, 1)}), list(d.keys() | [d.pop(1)])
d = {1: 1, 2: 2}\nresult = function(0, **d), d
d = {'a': 1}\nresult = '{a}'.format(**d), '%(a)s' % d
d = OrderedDict([(1, 1), (2, 2)])\nfor k in d: d[k + 10] = 1\nresult = d
d = OrderedDict([(1, 1), (2, 2)])\nfor k in d: del d[k]\nresult = d
d = OrderedDict([(1, 1), (2, 2)])\nfor k in d: d.move_to_end(k)\nresult = d
d = OrderedDict([(1, 1), (2, 2), (3, 3)])\nresult = []\nfor k in d:\n    result.append(k); d.move_to_end(1) if len(result) < 5 else None
d = OrderedDict([(1, 1), (2, 2)])\nfor k in reversed(d): d.clear()\nresult = d
d = OrderedDict([(1, 1), (2, 2)])\nit = iter(d.items()); next(it); d[3] = 3\nresult = outcome(next, it)
d = defaultdict(lambda: d.clear() or 5)\nd[1] = 1\nresult = d[2], d
d = defaultdict(list)\nfor k in d: pass\nresult = [d[k] for k in (1, 2)], d
d = Counter('aab')\nfor k in d: d[k + 'x'] += 1\nresult = d
s = {1, 2, 3}\nfor x in s: s.add(x + 10)\nresult = s
s = {1, 2, 3}\nfor x in s: s.discard(x)\nresult = s
s = {1, 2, 3}\nfor x in s:\n    s.discard(x); s.add(x + 10)\nresult = s
s = {1, 2, 3}\nit = iter(s); next(it); s.add(4)\nresult = outcome(next, it), outcome(it.__length_hint__)
s = {1, 2, 3}\nit = iter(s); list(it); s.add(4)\nresult = outcome(next, it)
s = {1, 2, 3}\ns.update(s)\nresult = s
s = {1, 2, 3}\ns |= s; s &= s; result = set(s); s -= s; result = result, s
s = {1, 2, 3}\ns ^= s\nresult = s
s = {1, 2, 3}\ns.difference_update(s)\nresult = s
s = {1, 2, 3}\ns.symmetric_difference_update(s)\nresult = s
s = {1, 2, 3}\ns.intersection_update(s)\nresult = s
s = {1, 2, 3}\ns.update(x + 10 for x in s)\nresult = s
s = {1, 2, 3}\ns.difference_update(x for x in s)\nresult = s
s = {Evil(lambda: None)}\nresult = Evil(lambda: s.clear()) in s, len(s)
s = {Evil(lambda: None)}\ns.add(Evil(lambda: s.clear()))\nresult = len(s)
s = {Evil(lambda: None)}\ns.discard(Evil(lambda: s.clear()))\nresult = len(s)
s = {Evil(lambda: None)}\ns.remove(Evil(lambda: s.clear()))\nresult = len(s)
s = {Evil(lambda: None)}\ns.remove(Evil(lambda: s.clear(), False))\nresult = len(s)
s = {Evil(lambda: None)}\nresult = s == {Evil(lambda: s.clear())}, len(s)
s = {Evil(lambda: None)}\nresult = s <= {Evil(lambda: s.clear())}, len(s)
s = {Evil(lambda: None)}\nresult = len(s & {Evil(lambda: s.clear())}), len(s)
s = {Evil(lambda: None)}\nresult = len(s | {Evil(lambda: s.clear())}), len(s)
s = {Evil(lambda: None)}\nresult = len(s - {Evil(lambda: s.clear())}), len(s)
s = {Evil(lambda: None)}\nresult = len(s ^ {Evil(lambda: s.clear())}), len(s)
s = {Evil(lambda: None)}\nresult = s.isdisjoint({Evil(lambda: s.clear())}), len(s)
s = {1, 2, 3}\nresult = [s.pop() for x in list(s)], s
s = {1, 2, 3}\nresult = [s.pop() for x in s]
s = {1, 2, 3}\nresult = sorted(s, key=lambda x: s.clear() or x), s
q = deque([1, 2, 3])\nfor x in q: q.append(x)\nresult = q
q = deque([1, 2, 3])\nfor x in q: q.pop()\nresult = q
q = deque([1, 2, 3])\nfor x in q: q.rotate()\nresult = q
q = deque([1, 2, 3])\nfor x in q: q[0] = 5\nresult = q
q = deque([1, 2, 3])\nfor x in reversed(q): q.clear()\nresult = q
q = deque([1, 2, 3])\nit = iter(q); next(it); q.append(4)\nresult = outcome(next, it), outcome(it.__length_hint__)
q = deque([1, 2, 3])\nit = iter(q); list(it); q.append(4)\nresult = outcome(next, it)
q = deque([1, 2, 3])\nq.extend(q)\nresult = q
q = deque([1, 2, 3])\nq.extendleft(q)\nresult = q
q = deque([1, 2, 3])\nq += q\nresult = q
q = deque([1, 2, 3], 4)\nq.extend(q)\nresult = q
q = deque([1, 2, 3])\nresult = q.index(Evil(lambda: q.clear()))
q = deque([1, 2, 3])\nresult = q.index(Evil(lambda: q.append(1), False))
q = deque([1, 2, 3])\nresult = q.count(Evil(lambda: q.clear()))
q = deque([1, 2, 3])\nresult = q.remove(Evil(lambda: q.clear()))
q = deque([1, 2, 3])\nresult = Evil(lambda: q.clear()) in q
q = deque([1, 2, 3])\nresult = q == deque([Evil(lambda: q.clear()), 2, 3]), q
q = deque([1, 2, 3])\nresult = q[Evil(lambda: q.clear())]
q = deque([1, 2, 3])\nq.extend(x for x in q)\nresult = q
b = bytearray(b'abc')\nfor x in b: b.append(x) if len(b) < 6 else None\nresult = b
b = bytearray(b'abc')\nfor x in b: b.pop()\nresult = b
b = bytearray(b'abc')\nb.extend(b)\nresult = b
b = bytearray(b'abc')\nb += b\nresult = b
b = bytearray(b'abc')\nb[:] = b\nresult = b
b = bytearray(b'abc')\nb[1:] = b\nresult = b
b = bytearray(b'abc')\nb[::-1] = b\nresult = b
b = bytearray(b'abc')\nb.extend(x for x in b if len(b) < 8)\nresult = b
b = bytearray(b'abc')\nm = memoryview(b)\nresult = outcome(b.append, 1), outcome(b.pop), outcome(b.clear), outcome(b.extend, b'x'), outcome(b.__setitem__, 0, 65), outcome(b.__setitem__, slice(0, 1), b'xy'), outcome(b.__setitem__, slice(0, 1), b'x'), outcome(b.__delitem__, 0), outcome(b.__iadd__, b'x'), outcome(b.__imul__, 2), outcome(b.__imul__, 1), outcome(b.insert, 0, 1), outcome(b.remove, 97), outcome(b.reverse), outcome(b.__init__, b'x'), outcome(b.resize, 3), outcome(b.resize, 5), b
b = bytearray(b'abc')\nm = memoryview(b); m.release()\nb.append(1)\nresult = b
b = bytearray(b'abc')\nwith memoryview(b) as m: result = outcome(b.append, 1)\nb.append(2)\nresult = result, b
b = bytearray(b'abc')\nb[Evil(lambda: b.clear())] = 65\nresult = b
b = bytearray(b'abc')\nresult = b[Evil(lambda: b.clear())]
b = bytearray(b'abc')\nb[0] = Evil(lambda: b.clear())\nresult = b
b = bytearray(b'abc')\nb.append(Evil(lambda: b.clear()))\nresult = b
b = bytearray(b'abc')\nb.insert(1, Evil(lambda: b.clear()))\nresult = b
b = bytearray(b'abc')\nresult = b.find(Evil(lambda: b.clear())), b
b = bytearray(b'abc')\nresult = b.count(Evil(lambda: b.clear())), b
b = bytearray(b'abc')\nresult = Evil(lambda: b.clear()) in b, b
b = bytearray(b'abc')\nresult = b.find(b'c', Evil(lambda: b.clear())), b
b = bytearray(b'abc')\nresult = b.center(Evil(lambda: b.clear())), b
b = bytearray(b'abc')\nresult = b.join([b, b]), b.join(b.clear() or x for x in (b'x', b'y'))
b = bytearray(b'abc')\nresult = b.replace(b'b', b), b.split(b), b.partition(b), b.strip(b), b.startswith(b), b.translate(None, b), b.removeprefix(b)
b = bytearray(b'abc')\nb.extend(Evil(lambda: b.clear()) for _ in range(2))\nresult = b
a = array('i', [1, 2, 3])\nfor x in a: a.append(x) if len(a) < 6 else None\nresult = a
a = array('i', [1, 2, 3])\nfor x in a: a.pop()\nresult = a
a = array('i', [1, 2, 3])\na.extend(a)\nresult = a
a = array('i', [1, 2, 3])\na += a\nresult = a
a = array('i', [1, 2, 3])\na[:] = a\nresult = a
a = array('i', [1, 2, 3])\na[1:] = a\nresult = a
a = array('i', [1, 2, 3])\nm = memoryview(a)\nresult = outcome(a.append, 1), outcome(a.pop), outcome(a.extend, a), outcome(a.__setitem__, 0, 5), outcome(a.__delitem__, 0), outcome(a.__imul__, 2), outcome(a.insert, 0, 1), outcome(a.remove, 5), outcome(a.reverse), outcome(a.frombytes, b'abcd'), outcome(a.fromlist, [1]), outcome(a.clear), outcome(a.byteswap), a
a = array('i', [1, 2, 3])\na[Evil(lambda: a.clear())] = 5\nresult = a
a = array('i', [1, 2, 3])\na[0] = Evil(lambda: a.clear())\nresult = a
a = array('i', [1, 2, 3])\nresult = a.index(Evil(lambda: a.clear()))
a = array('i', [1, 2, 3])\nresult = a.count(Evil(lambda: a.clear())), a
a = array('i', [1, 2, 3])\nresult = a.remove(Evil(lambda: a.clear())), a
a = array('i', [1, 2, 3])\nresult = a == array('i', [1, 2, 3]), a < array('d', [1, 2, 4]), Evil(lambda: a.clear()) in a, a
a = array('i', [1, 2, 3])\na.extend(Evil(lambda: a.clear()) for _ in range(2))\nresult = a
a = array('i', [1, 2, 3])\na.fromlist([Evil(lambda: a.clear()), 'x'])\nresult = a
t = (1, 2, 3)\nresult = t.index(Evil(lambda: None)), t.count(Evil(lambda: None)), Evil(lambda: None) in t, t == (Evil(lambda: None), 2, 3), t < (Evil(lambda: None, False), 2, 3)
r = range(3)\nresult = Evil(lambda: None) in r, r.count(Evil(lambda: None)), r.index(Evil(lambda: None)), r[Evil(lambda: None)]
g = (x for x in (1, 2, 3))\nresult = [next(g) for x in g]
g = (x for x in (1, 2, 3))\nresult = list(zip(g, g))
g = (outcome(next, g) for x in (1, 2))\nresult = list(g)
g = (outcome(g.send, 1) for x in (1, 2))\nresult = list(g)
g = (outcome(g.close) for x in (1, 2))\nresult = list(g)
g = (outcome(g.throw, ValueError) for x in (1, 2))\nresult = list(g)
it = iter([1, 2, 3])\nresult = list(zip(it, it)), list(it)
it = iter([1, 2, 3, 4])\nresult = [(x, next(it)) for x in it]
it = iter([1, 2, 3])\nresult = [(x, next(it)) for x in it]
it = iter([1, 2, 3])\nresult = list(map(lambda x: next(it), it))
it = iter([1, 2, 3])\nresult = list(filter(lambda x: next(it), it))
it = iter([1, 2, 3])\nresult = list(itertools.starmap(lambda x: next(it), ((x,) for x in it)))
it = iter([1, 2, 3])\nresult = dict(zip(it, it))
it = iter([1, 2, 3])\na, b = itertools.tee(it); next(it)\nresult = list(a), list(b)
it = iter([1, 2, 3])\nresult = 2 in it, list(it), 2 in it
it = iter('abc')\nresult = 'b' in it, ''.join(it)
it = iter(range(5))\nresult = 2 in it, list(it), sum(it)
it = iter([1, 2, 3])\nresult = max(it), outcome(max, it), max(it, default=0)
it = itertools.count()\nresult = list(itertools.islice(it, 2)), next(it), list(zip(it, 'ab')), next(it)
it = iter([1, 2, 3])\nresult = list(zip('ab', it)), list(it)
it = iter([1, 2, 3])\nresult = list(zip(it, 'ab')), list(it)
it = iter([1, 2, 3])\nresult = outcome(lambda: list(zip(it, 'ab', strict=True))), list(it)
it = iter([1, 2, 3])\na, *b = it\nresult = a, b, list(it)
it = iter([1, 2, 3])\nresult = outcome(unpack, it), list(it)
it = iter([1, 2, 3, 4, 5])\nresult = outcome(unpack, it), list(it)""".split("\n")

def mutation_group():
    for number, text in enumerate(MUTATIONS):
        text = text.replace("\\n", "\n")
        yield text.split(" ")[0], "%03d %s" % (number, ascii(text)), lambda text=text: outcome(scenario, text)
NAMESPACE.update(outcome=outcome)

# ---- Iterators part of the way: what they say of themselves, and what copies of them go on with ----

ITERATORS = ["iter([1, 2, 3])", "iter((1, 2, 3))", "iter('abc')", "iter('a\\u20ac\\U0001f600')", "iter(b'abc')", "iter(bytearray(b'abc'))", "iter(range(3))", "iter(range(10, 0, -3))", "iter(range(2 ** 64, 2 ** 64 + 3))", "iter({1: 1, 2: 2, 3: 3})", "iter({1: 1, 2: 2, 3: 3}.values())", "iter({1: 1, 2: 2, 3: 3}.items())",
             "reversed({1: 1, 2: 2, 3: 3})", "reversed({1: 1, 2: 2, 3: 3}.items())", "iter({1, 2, 3})", "iter(frozenset({1, 2, 3}))", "reversed([1, 2, 3])", "reversed((1, 2, 3))", "reversed('abc')", "reversed(range(3))", "reversed(range(2 ** 64, 2 ** 64 + 3))", "enumerate('abc')", "enumerate('abc', 2 ** 63 - 1)", "zip('abc', [1, 2, 3])",
             "zip('abc', [1, 2, 3], strict=True)", "map(str, [1, 2, 3])", "map(operator.add, [1, 2, 3], [4, 5, 6])", "filter(None, [1, 0, 2, 3])", "iter(deque([1, 2, 3]))", "reversed(deque([1, 2, 3]))", "iter(array('i', [1, 2, 3]))", "iter(OrderedDict([(1, 1), (2, 2), (3, 3)]))", "iter(OrderedDict([(1, 1), (2, 2), (3, 3)]).items())",
             "reversed(OrderedDict([(1, 1), (2, 2), (3, 3)]))", "iter(Getter())", "iter(iter([1, 2, 3]).__next__, 3)", "iter(memoryview(b'abc'))", "itertools.count(1)", "itertools.count(1.5, 0.5)", "itertools.count(2 ** 63 - 1)", "itertools.cycle('ab')", "itertools.repeat(1, 3)", "itertools.repeat(1)", "itertools.accumulate([1, 2, 3])",
             "itertools.chain('a', 'bc')", "itertools.chain.from_iterable(['a', 'bc'])", "itertools.compress('abc', [1, 1, 1])", "itertools.dropwhile(lambda x: x < 1, [0, 1, 2, 3])", "itertools.takewhile(lambda x: x < 9, [1, 2, 3])", "itertools.filterfalse(None, [0, 0, 1, 0])", "itertools.islice('abcdef', 1, 6, 2)", "itertools.starmap(pow, [(1, 1), (2, 2), (3, 3)])",
             "itertools.zip_longest('abc', 'a')", "itertools.product('ab', 'c')", "itertools.permutations('abc', 2)", "itertools.combinations('abc', 2)", "itertools.combinations_with_replacement('ab', 2)", "itertools.pairwise('abcd')", "itertools.batched('abcdef', 2)", "itertools.groupby('aabbc')", "itertools.tee('abc')[0]", "(x for x in (1, 2, 3))",
             "iter(frozendict({1: 1, 2: 2, 3: 3}))", "iter(MappingProxyType({1: 1, 2: 2, 3: 3}))", "iter(struct.iter_unpack('b', b'abc'))", "iter(Counter('abc'))", "iter(types.GenericAlias(tuple, int))", "os.scandir and iter(())", "iter(sys.version_info[:3])"]
class Getter:
    def __getitem__(self, index):
        if index > 2: raise IndexError
        return index
NAMESPACE.update(Getter=Getter)

def iterators_group():
    for text in thin(ITERATORS):
        code = compile(text, "<iterator>", "eval")
        for steps in range(6):
            def advanced(code=code, steps=steps):
                it = eval(code, NAMESPACE)
                for _ in range(steps):
                    try: next(it)
                    except StopIteration: pass
                return it
            some = lambda it: list(itertools.islice(it, 5))
            yield "rest", "%s after %d" % (text, steps), lambda advanced=advanced: outcome(lambda: some(advanced()))
            yield "hint", "%s after %d: hint" % (text, steps), lambda advanced=advanced: (outcome(lambda: advanced().__length_hint__()), outcome(operator.length_hint, advanced(), 7))
            yield "reduce", "%s after %d: reduce" % (text, steps), lambda advanced=advanced: outcome(lambda: advanced().__reduce__())
            yield "copy", "%s after %d: copy" % (text, steps), lambda advanced=advanced: outcome(lambda: (lambda it: (some(copy.copy(it)), some(it)))(advanced()))
            yield "deepcopy", "%s after %d: deepcopy" % (text, steps), lambda advanced=advanced: outcome(lambda: (lambda it: (some(copy.deepcopy(it)), some(it)))(advanced()))
            yield "pickle", "%s after %d: pickle" % (text, steps), lambda advanced=advanced: [outcome(lambda: some(pickle.loads(pickle.dumps(advanced(), p)))) for p in (0, 2, 5)]
            yield "self", "%s after %d: itself" % (text, steps), lambda advanced=advanced: outcome(lambda: (lambda it: (iter(it) is it, type(it).__name__, bool(it), outcome(len, it), outcome(lambda: it[0]), outcome(lambda: it == it), outcome(reversed, it)))(advanced()))
            for state in ("0", "1", "2", "-1", "100", "None", "'a'", "(1,)", "2 ** 64"):
                yield "setstate", "%s after %d: setstate %s" % (text, steps, state), lambda advanced=advanced, state=state: outcome(lambda: (lambda it: (it.__setstate__(eval(state)), some(it)))(advanced()))

GROUPS = {"operators": operators_group, "unary": unary_group, "builtins": builtins_group, "format": format_group, "subscript": subscript_group}
for type_name in RECEIVERS:
    GROUPS[type_name] = lambda type_name=type_name: methods_group(type_name)
GROUPS.update({"keywords": keywords_group, "itertools": lambda: functions_group(itertools, ITERTOOLS), "functools": lambda: functions_group(functools, FUNCTOOLS), "math": lambda: math_group(math, MATH),
               "cmath": lambda: math_group(cmath, CMATH), "operator": lambda: functions_group(operator, OPERATOR, few=FEWER + pick("9223372036854775808", "()", "{}", "int")), "struct": struct_group, "codecs": codecs_group, "literals": literals_group,
               "attributes": attributes_group, "abcs": abcs_group, "types": types_group, "exceptions": exceptions_group, "calls": calls_group, "mutation": mutation_group, "iterators": iterators_group, "odd": odd_group, "ints": ints_group, "floats": floats_group, "characters": characters_group, "equality": equality_group, "sorting": sorting_group, "nested": nested_group, "copies": copies_group})

def run_groups(groups=None, only=None, every=1, lines=False):
    """Makes the calls of the groups (all of them by default), or about each `every`th of them (see thin()), and prints a line for each
    call, or a line for each group and name: how many calls, and a digest of what came out."""
    global EVERY, TURN
    write = sys.stdout.write
    for group, make in GROUPS.items():
        if groups and group not in groups:
            continue
        EVERY, TURN = every, 0
        digests, counts = {}, {}
        for name, text, run in make():
            if only and name != only:
                continue
            result = run()
            if result is None:
                continue
            assert " -> " not in text, text  # The tools split the lines there.
            line = "%s -> %s" % (text, result)
            line = line.encode("utf-8", "backslashreplace")
            if lines:
                sys.stdout.buffer.write(line + b"\n")
            else:
                digests.setdefault(name, hashlib.md5()).update(line)
                counts[name] = counts.get(name, 0) + 1
        for name in digests:
            write("%s %s %d %s\n" % (group, name, counts[name], digests[name].hexdigest()[:12]))
        sys.stdout.flush()

def main(arguments):
    every = 1
    if arguments[:1] == ["--every"]:
        every = int(arguments[1])
        arguments = arguments[2:]
    if arguments == ["--groups"]:
        print(" ".join(GROUPS))
    elif arguments:
        run_groups(arguments[:1], arguments[1] if len(arguments) > 1 else None, every, lines=True)
    else:
        run_groups(every=every)

if __name__ == "__main__":
    # As a module: some messages name a class with its module and some without, which cannot be told apart in __main__.
    import os
    sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
    import grid
    grid.main(sys.argv[1:])
