import json, _json, json.decoder, json.scanner, decimal, collections

def show(f, *a, **k):
    try:
        r = f(*a, **k)
        print(repr(r))
    except json.JSONDecodeError as e:
        print('JSONDecodeError', e, e.msg, e.pos, e.lineno, e.colno)
    except BaseException as e:
        print(type(e).__name__, e)

print(json.decoder.scanstring is _json.scanstring, json.scanner.make_scanner is _json.make_scanner, json.decoder.c_scanstring is _json.scanstring)
print(type(json.JSONDecoder().scan_once))

good = ['1', '-1', '0', '-0', '1.5', '-1.5', '1e3', '1E3', '1e+3', '1e-3', '1.5e10', '-0.0', '0.0', '1e400', '-1e400', '1e-400', '123456789012345', '1234567890123456',
        '12345678901234567890', '-12345678901234567890123456789', '9007199254740991', '9007199254740992', '9007199254740993', '-9007199254740993', '0.1', '1.0', '100.0', '1e2', '1e0',
        '"x"', '""', '"\\n"', '"\\u00e9"', '"\\ud83d\\ude00"', '"\\ud83d"', '"\\ude00"', '"\\ud83dx"', '"\\ud83d\\n"', '"\\ud83d\\u0041"', '"\\ud83d\\ud83d\\ude00"', '"\u00e9"', '"\U0001f600"',
        '"\\"\\\\\\/\\b\\f\\n\\r\\t"', 'null', 'true', 'false', 'NaN', 'Infinity', '-Infinity', '[]', '{}', '[1]', '[1,2]', '[ 1 , 2 ]', '{"a":1}', '{ "a" : 1 , "b" : [ ] }',
        ' 1 ', '\t\n\r 1 \t\n\r', '[[[[]]]]', '{"a":{"b":{"c":{}}}}', '[1,"a",null,true,false,1.5,{"x":[]}]', '{"a":1,"a":2}', '{"":0}', '["\U0001f600",1]', '{"\U0001f600":"\U0001f601"}',
        '"\x7f"', '"\u2028\u2029"', '[1e5,1E5,1.0e5]', '"\\u0000"', '"\\uFFFF"', '"\\uabcd\\uABCD"', '1E400', '[-0, -0.0, 0, 0.0]']
for s in good:
    show(json.loads, s)

bad = ['', ' ', '-', '+1', '01', '1.', '.5', '1e', '1e+', '1.e5', '--1', '-a', 'nul', 'tru', 'fals', 'nulll', 'Nan', 'Infinit', '-Infinit', '-Inf', 'None', 'True', "'x'", '"', '"x', '"\\', '"\\x"', '"\\u"',
       '"\\u1"', '"\\u12"', '"\\u123"', '"\\u123g"', '"\\u123', '"\\u1234', '"\\ud83d\\u"', '"\\ud83d\\u12"', '"\\ud83d\\uzzzz"', '"\\ud83d\\ude0"', '"\\ud83d\\ude00', '"\\ud83d\\', '"\\ud83d\\u',
       '"\n"', '"\t"', '"\x00"', '"\x1f"', '"a\nb"', '[', ']', '[1', '[1,', '[1,]', '[,1]', '[1 2]', '[1,,2]', '{', '}', '{"a"', '{"a":', '{"a":1', '{"a":1,', '{"a":1,}', '{,}', '{a:1}', '{1:1}', "{'a':1}",
       '{"a" 1}', '{"a":1 "b":2}', '{"a":}', '{"a":1,,}', '[1]]', '1 2', '{}{}', '[] x', '\ufeff1', '[\U0001f600]', '["\U0001f600", x]', '{"\U0001f600": x}', '"\U0001f600\\x"', '"\U0001f600\n"',
       '["\U0001f600\U0001f601",]', '\U0001f600', '[1,\n2,\n x]', '{"a":\n[1,\n{"b": tru}]}', '"\\ud83d\\u\U0001f600abc"', '"\\u\U0001f600ab"', '"\\u12\U0001f600"', '[1.5.5]', '[1e5e5]', '0x10', '1_000', '\u0661',
       '[\u00a01]', '\x0b1', '\x0c1', '[1\x00]', 'nan', 'inf', '-nan', 'NaNx', 'Infinityx', 'truex', '1x', '"a"x', '-Infinity1']
for s in bad:
    show(json.loads, s)

# strict
for s in ['"\n"', '"\t\x00\x1f"', '"a\nb\\n"', '["\r"]', '{"\n":"\n"}']:
    show(json.loads, s, strict=False)

# scanstring
ss = _json.scanstring
for a in [('"abc"', 1), ('"abc"', 2), ('"abc"', 4), ('"abc"', 5), ('"abc"', 6), ('"abc"', 0), ('"abc"', -1), ('abc"def"', 0), ('abc"def"', 4), ('', 0), ('', 1), ('"', 1), ('"', 0), ('"\n"', 1), ('"\n"', 1, False), ('"\n"', 1, True),
          ('"\n"', 1, 0), ('"\n"', 1, None), ('"\n"', 1, 'x'), ('\U0001f600"ab\U0001f601c"x', 2), ('\U0001f600"ab\U0001f601c\\n"x', 2), ('\U0001f600"ab\U0001f601c', 2), ('\U0001f600"ab\U0001f601\\q', 2),
          ('\U0001f600\U0001f600"', 1), ('\U0001f600\U0001f600"', 2), ('\U0001f600\U0001f600"', 3), ('\U0001f600\U0001f600"', 4), ('"\\ud834\\udd20x"', 1), ('"\\ud834\\u0079x"', 1), ('"\\ud834\\udd20"', 1), ('"\\ud834\\udd2"', 1),
          ('"\\ud834\\ud834\\udd20"', 1), ('"\\udd20\\ud834"', 1), ('"z\\ud834\\udd20x"', 1), ('"\\u007b"', 1), ('"A JSON payload should be an object or array, not a string."', 1), ('"\\/"', 1), ('"\\u0123\\u4567\\u89AB\\uCDEF\\uabcd\\uef4A"', 1)]:
    show(ss, *a)
show(ss)
show(ss, 'x')
show(ss, b'"x"', 1)
show(ss, 1, 1)
show(ss, None, 1)
show(ss, '"x"', 'a')
show(ss, '"x"', 1.0)
show(ss, '"x"', None)
show(ss, '"x"', 2**70)
show(ss, '"x"', -2**70)
show(ss, '"x"', 1, True, 1)
show(ss, '"x"', end=1)
show(ss, pystr='"x"', end=1)
class S(str): pass
show(ss, S('"x"'), 1)
class Idx:
    def __index__(self): return 1
show(ss, '"x"', Idx())
print(type(ss('"x"', 1)[0]), type(ss(S('"x"'), 1)[0]))

# scan_once
so = json.JSONDecoder().scan_once
for a in [('1', 0), ('1', 1), ('1', 2), ('1', -1), (' 1', 0), (' 1', 1), ('[1, 2] x', 0), ('x[1, 2]', 1), ('\U0001f600[1, "\U0001f601"]z', 1), ('\U0001f600x', 1), ('\U0001f600', 1), ('\U0001f600', 2), ('\U0001f600-', 1),
          ('-', 0), ('-x', 0), ('1.', 0), ('1.x', 0), ('1e', 0), ('1ex', 0), ('1e+', 0), ('1e+x', 0), ('1e5', 0), ('1e+5', 0), ('1.5e', 0), ('1.5e-', 0), ('00', 0), ('-01', 0), ('12a', 0), ('nullx', 0), ('nul', 0), ('', 0),
          ('1E', 0), ('1E5', 0), ('1e55x', 0), ('1.e5', 0), ('[1,\U0001f600]', 0), ('"\U0001f600"', 0), ('{"\U0001f600":1}x', 0)]:
    show(so, *a)
show(so)
show(so, '1')
show(so, 1, 0)
show(so, b'1', 0)
show(so, None, 0)
show(so, '1', 'a')
show(so, '1', None)
show(so, '1', 1.0)
show(so, '1', 2**70)
show(so, '1', 0, 0)
show(so, string='1', idx=0)
show(so, '1', idx=0)
show(so, '1', 0, idx=0)
show(so, '1', foo=0)
show(so, S('[1]'), Idx())
print(so.strict, so.object_hook, so.object_pairs_hook, so.array_hook, so.parse_float, so.parse_int, so.parse_constant('NaN'))
show(setattr, so, 'strict', False)
show(setattr, so, 'foo', False)
show(_json.make_scanner)
show(_json.make_scanner, 1)
show(_json.make_scanner, 1, 2)
show(_json.make_scanner, foo=1)
show(lambda: type(_json.make_scanner(context=json.JSONDecoder())))
class Ctx:
    strict = True; object_hook = None; object_pairs_hook = None; array_hook = None; parse_float = float; parse_int = int
show(_json.make_scanner, Ctx())
Ctx.parse_constant = None
show(lambda: _json.make_scanner(Ctx())('[1, 2.5]', 0))
show(lambda: _json.make_scanner(Ctx())('NaN', 0))
class BadTruth:
    def __bool__(self): raise KeyError('truth')
Ctx.strict = BadTruth()
show(_json.make_scanner, Ctx())
try:
    class Sub(_json.make_scanner): pass
    print('subclassed')
except TypeError as e:
    print('TypeError', e)

# Hooks
doc = '{"a": 1, "b": [1.5, {"c": null, "d": NaN}], "e": {"f": -Infinity, "g": 12345678901234567890}, "h": []}'
show(json.loads, doc, object_hook=lambda d: sorted(d.items(), key=str))
show(json.loads, doc, object_pairs_hook=lambda p: p)
show(json.loads, doc, object_pairs_hook=collections.OrderedDict)
show(json.loads, doc, object_hook=lambda d: 'H', object_pairs_hook=lambda p: ('P', len(p)))
show(json.loads, doc, array_hook=tuple)
show(json.loads, doc, array_hook=lambda l: ('A', len(l)))
show(json.loads, doc, parse_float=decimal.Decimal)
show(json.loads, doc, parse_float=lambda s: ('F', s))
show(json.loads, doc, parse_int=lambda s: ('I', s))
show(json.loads, doc, parse_int=float)
show(json.loads, doc, parse_constant=lambda s: ('C', s))
show(json.loads, '[-0, -1, 1e5, -1.5E-3, 0.0]', parse_int=str, parse_float=str)
def boom(*a): raise KeyError('boom')
for k in ('object_hook', 'object_pairs_hook', 'array_hook', 'parse_float', 'parse_int', 'parse_constant'):
    show(json.loads, doc, **{k: boom})
    show(json.loads, doc, **{k: 5})
show(json.loads, '{}', object_hook=lambda d: 'empty')
show(json.loads, '{}', object_pairs_hook=lambda d: ('empty', d))
show(json.loads, '[]', array_hook=lambda d: ('empty', d))

# Equal keys are one object
a, b = json.loads('[{"a_key": 1, "b_\u00e9": 2}, {"a_key": 3, "b_\u00e9": 4}]')
print([x is y for x, y in zip(sorted(a), sorted(b))])

# Types of the results
r = json.loads('[1, 1.0, 1e2, 10000000000000000000000, -0, -0.0]')
print([type(x).__name__ for x in r], r)

# bytes
for b in [b'[1]', bytearray(b'[1]'), '[1, "\u00e9"]'.encode('utf-8'), '[1, "\u00e9"]'.encode('utf-16'), '[1, "\u00e9"]'.encode('utf-32'), '[1]'.encode('utf-16-le'), '[1]'.encode('utf-32-be'), b'\xef\xbb\xbf[1]', b'\xff']:
    show(json.loads, b)
show(json.loads, 1)
show(json.loads, None)
show(json.loads, [])
show(json.loads, memoryview(b'1'))

# raw_decode
d = json.JSONDecoder()
show(d.raw_decode, '[1] x')
show(d.raw_decode, 'x [1]', 2)
show(d.raw_decode, ' [1]')
show(d.raw_decode, '')
show(d.raw_decode, '\U0001f600[1]', 1)
show(d.raw_decode, '[1]', -1)
show(d.raw_decode, '[1]', 10)

# The limit on digits
import sys
show(lambda: len(str(json.loads('1' * 4300))))
show(json.loads, '1' * 4301)
show(json.loads, '-' + '1' * 4301)
show(json.loads, '[' + '1' * 5000 + ']')
show(lambda: json.loads('1' * 5000 + '.5'))
show(lambda: json.loads('0.' + '1' * 5000))
