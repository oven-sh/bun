# A JSON encoder and decoder written from scratch, and a round trip through both.
class JSONError(ValueError):
    def __init__(self, msg, pos): super().__init__("%s at position %d" % (msg, pos)); self.pos = pos
ESC = {'"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f"}
def enc_str(s, ascii_only=True):
    out = ['"']
    for c in s:
        o = ord(c)
        if c in ESC: out.append(ESC[c])
        elif o < 0x20: out.append("\\u%04x" % o)
        elif o < 0x7F or not ascii_only: out.append(c)
        elif o < 0x10000: out.append("\\u%04x" % o)
        else: o -= 0x10000; out.append("\\u%04x\\u%04x" % (0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)))
    return "".join(out) + '"'
def dumps(v, indent=None, sort_keys=False, ascii_only=True, _level=0, _seen=None):
    _seen = _seen if _seen is not None else []
    if v is None: return "null"
    if v is True: return "true"
    if v is False: return "false"
    if isinstance(v, int): return int.__repr__(v)
    if isinstance(v, float):
        if v != v: return "NaN"
        if v in (float("inf"), float("-inf")): return "Infinity" if v > 0 else "-Infinity"
        return float.__repr__(v)
    if isinstance(v, str): return enc_str(v, ascii_only)
    if isinstance(v, (list, tuple, dict)):
        if any(v is s for s in _seen): raise ValueError("Circular reference detected")
        _seen.append(v)
        nl = "" if indent is None else "\n" + " " * indent * (_level + 1); end = "" if indent is None else "\n" + " " * indent * _level; sep = "," if indent is not None else ", "
        kw = dict(indent=indent, sort_keys=sort_keys, ascii_only=ascii_only, _level=_level + 1, _seen=_seen)
        if isinstance(v, dict):
            items = []
            for k in (sorted(v) if sort_keys else v):
                if isinstance(k, bool) or k is None: ks = dumps(k)
                elif isinstance(k, (int, float)): ks = dumps(k)
                elif isinstance(k, str): ks = None
                else: raise TypeError("keys must be str, int, float, bool or None, not " + type(k).__name__)
                items.append((enc_str(k, ascii_only) if ks is None else '"%s"' % ks) + ": " + dumps(v[k], **kw))
            r = "{" + nl + (sep + nl).join(items) + end + "}" if items else "{}"
        else:
            r = "[" + nl + (sep + nl).join(dumps(x, **kw) for x in v) + end + "]" if v else "[]"
        _seen.pop(); return r
    raise TypeError("Object of type %s is not JSON serializable" % type(v).__name__)
def loads(s):
    i = 0; n = len(s)
    def ws():
        nonlocal i
        while i < n and s[i] in " \t\n\r": i += 1
    def value():
        nonlocal i
        ws()
        if i >= n: raise JSONError("Expecting value", i)
        c = s[i]
        if c == "{": return obj()
        if c == "[": return arr()
        if c == '"': return string()
        for lit, v in (("true", True), ("false", False), ("null", None), ("NaN", float("nan")), ("Infinity", float("inf")), ("-Infinity", float("-inf"))):
            if s.startswith(lit, i): i += len(lit); return v
        return number()
    def number():
        nonlocal i
        j = i
        if j < n and s[j] == "-": j += 1
        if j < n and s[j] == "0": j += 1
        elif j < n and s[j] in "123456789":
            while j < n and s[j].isdigit() and s[j].isascii(): j += 1
        else: raise JSONError("Expecting value", i)
        is_float = False
        if j + 1 < n and s[j] == "." and s[j + 1] in "0123456789":
            is_float = True; j += 1
            while j < n and s[j] in "0123456789": j += 1
        if j < n and s[j] in "eE":
            k = j + 1
            if k < n and s[k] in "+-": k += 1
            if k < n and s[k] in "0123456789":
                is_float = True
                while k < n and s[k] in "0123456789": k += 1
                j = k
        text = s[i:j]; i = j
        return float(text) if is_float else int(text)
    def string():
        nonlocal i
        start = i; i += 1; out = []
        while True:
            if i >= n: raise JSONError("Unterminated string starting", start)
            c = s[i]
            if c == '"': i += 1; return "".join(out)
            if c == "\\":
                i += 1
                if i >= n: raise JSONError("Unterminated string starting", start)
                e = s[i]
                if e == "u":
                    def hex4(p):
                        h = s[p:p + 4]
                        if len(h) != 4 or any(ch not in "0123456789abcdefABCDEF" for ch in h): raise JSONError("Invalid \\uXXXX escape", p - 1)
                        return int(h, 16)
                    u = hex4(i + 1); i += 5
                    if 0xD800 <= u < 0xDC00 and s[i:i + 2] == "\\u":
                        lo = hex4(i + 2)
                        if 0xDC00 <= lo < 0xE000: u = 0x10000 + ((u - 0xD800) << 10) + (lo - 0xDC00); i += 6
                    out.append(chr(u))
                elif e in '"\\/bfnrt': out.append({"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}.get(e, e)); i += 1
                else: raise JSONError("Invalid \\escape", i - 1)
            elif ord(c) < 0x20: raise JSONError("Invalid control character", i)
            else: out.append(c); i += 1
    def arr():
        nonlocal i
        i += 1; out = []; ws()
        if i < n and s[i] == "]": i += 1; return out
        while True:
            out.append(value()); ws()
            if i < n and s[i] == ",": i += 1; continue
            if i < n and s[i] == "]": i += 1; return out
            raise JSONError("Expecting ',' delimiter", i)
    def obj():
        nonlocal i
        i += 1; out = {}; ws()
        if i < n and s[i] == "}": i += 1; return out
        while True:
            ws()
            if i >= n or s[i] != '"': raise JSONError("Expecting property name enclosed in double quotes", i)
            k = string(); ws()
            if i >= n or s[i] != ":": raise JSONError("Expecting ':' delimiter", i)
            i += 1; out[k] = value(); ws()
            if i < n and s[i] == ",": i += 1; continue
            if i < n and s[i] == "}": i += 1; return out
            raise JSONError("Expecting ',' delimiter", i)
    v = value(); ws()
    if i != n: raise JSONError("Extra data", i)
    return v
for v in (None, True, False, 0, -1, 10 ** 30, 1.5, -0.0, 1e100, 1e-7, 0.1, float("inf"), float("-inf"), float("nan"), "", "plain", 'q"uote', "back\\slash", "nl\n\ttab", "\x00\x1f\x7f", "é€", "😀", "\ud800", [], {}, (), [1, [2, [3]]], (1, 2), {"a": 1}, {"b": [1, {"c": None}], "a": "x"}, {1: "int key", 2.5: "float key", True: "bool key", None: "none key"}, [[], {}, [[]], [{}]], {"": ""}, {"nested": {"deep": {"deeper": [1, 2, {"x": ()}]}}}):
    print(dumps(v))
doc = {"name": "Zoë 😀", "tags": ["a", "b"], "n": 3, "pi": 3.14159, "ok": True, "none": None, "child": {"k": [1, 2, {"z": []}], "e": {}}, "t": (1, (2,))}
print(dumps(doc, sort_keys=True)); print(dumps(doc, indent=2)); print(dumps(doc, ascii_only=False, sort_keys=True)); print(dumps([1, [2, 3], {}], indent=4)); print(dumps([], indent=2), dumps({}, indent=2), dumps([[]], indent=1))
for bad in (object(), {1, 2}, b"bytes", 1j, {(1, 2): 3}, [1, {"a": len}], range(3)):
    try: dumps(bad)
    except TypeError as e: print("TypeError:", e)
loop = [1]; loop.append(loop)
try: dumps(loop)
except ValueError as e: print("ValueError:", e)
dl = {}; dl["self"] = {"inner": dl}
try: dumps(dl)
except ValueError as e: print("ValueError:", e)
shared = [1]; print(dumps([shared, shared, {"a": shared}]))
class MyInt(int):
    def __repr__(self): return "custom"
class MyStr(str): pass
class MyList(list): pass
class MyDict(dict): pass
print(dumps([MyInt(5), MyStr("s"), MyList([1]), MyDict(a=1)]))
for src in ("null", "true", "false", "0", "-0", "123", "-123", "1.5", "-1.5e3", "1E5", "1e-2", "1e+2", "0.0", "-0.0", "12345678901234567890123", '""', '"abc"', '"\\n\\t\\"\\\\\\/\\b\\f\\r"', '"\\u00e9\\u20ac"', '"\\ud83d\\ude00"', '"\\ud83d"', '"\\ud83dx"', '"\\ude00\\ud83d"', '"é😀"', "[]", "[ ]", "[1]", "[1, 2, 3]", "[1,[2,[3,[]]]]", "{}", "{ }", '{"a": 1}', '{"a": {"b": {"c": [1, 2, {"d": null}]}}}', '{"a": 1, "a": 2}', ' \n\t[ 1 ,\r\n 2 ] \n', '{"": ""}', "NaN", "Infinity", "-Infinity", "[NaN]", "1e400", "-1e400", "1e-400", '[true, false, null]', '"\\u0000"', '{"a":[],"b":{}}'):
    print(repr(src), "->", repr(loads(src)))
for src in ("", " ", "nul", "True", "tru", "'a'", '"abc', '"abc\\', '"\\x"', '"\\u12"', '"\\u12g4"', '"a\nb"', '"\t"', "[", "[1", "[1,", "[1,]", "[,1]", "[1 2]", "[1,,2]", "]", "{", '{"a"', '{"a":', '{"a":1', '{"a":1,', '{"a":1,}', "{a:1}", "{1:1}", '{"a" 1}', '{"a":1 "b":2}', "}", "01", "-", "+1", ".5", "1.", "1.e5", "1e", "1e+", "--1", "0x10", "1 2", "[] []", "null null", "{}x", "[1]]", '"a" "b"', "nan", "inf", "-Inf", "١", "[1, 2", '{"a": [1, {"b": }]}', "﻿1", "/* c */ 1", "1 // c", "[1, #]", '["a", \'b\']'):
    try: print(repr(src), "->", repr(loads(src)))
    except JSONError as e: print(repr(src), "-> JSONError:", e, e.pos)
def same(a, b):
    if isinstance(a, float) and a != a: return isinstance(b, float) and b != b
    if isinstance(a, (list, tuple)): return isinstance(b, list) and len(a) == len(b) and all(map(same, a, b))
    if isinstance(a, dict): return isinstance(b, dict) and list(a) == list(b) and all(same(a[k], b[k]) for k in a)
    return type(a) is type(b) and a == b
for v in (doc, [1, 2.5, "x", None, True, [], {}], {"k": [float("nan"), float("inf"), -0.0]}, "\x00\x1f é€😀 \\ \" /", list(range(50)), {str(i): [i, i * 0.5, str(i) * 3] for i in range(20)}, [[[[[[[[[[1]]]]]]]]]], 10 ** 40, 1e-300, 1.7976931348623157e308, 5e-324, 0.30000000000000004):
    print(same(v, loads(dumps(v))), same(v, loads(dumps(v, indent=3))), same(v, loads(dumps(v, ascii_only=False))), dumps(loads(dumps(v))) == dumps(v))
big = {"rows": [{"id": i, "name": "row %d" % i, "vals": [i * j for j in range(5)], "flag": i % 3 == 0, "ratio": i / 7} for i in range(60)]}
text = dumps(big); back = loads(text); print(len(text), same(big, back), back["rows"][59], sum(r["id"] for r in back["rows"]), text[:80], text.count("{"), text.count("true"))
