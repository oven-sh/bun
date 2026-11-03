# types.MappingProxyType: == and != go to the mapping, the rest is not there; a foreign operand never gets at the dict itself.
try: import collections, types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import collections, types')

try:
    def t(label, f):
        try:
            print(label, 'ok', f())
        except Exception as e:
            print(label, type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(label, f):')

try: d = {'a': 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: d = {'a': 1}")
try: p = types.MappingProxyType(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = types.MappingProxyType(d)')
try:
    for other, name in ((dict(d), 'dict'), ({'a': 2}, 'other dict'), (types.MappingProxyType(dict(d)), 'proxy'), (frozendict(d), 'frozendict'),
                        (collections.OrderedDict(d), 'OrderedDict'), (collections.UserDict(d), 'UserDict'), (collections.ChainMap(d), 'ChainMap'), ([('a', 1)], 'list'), (1, 'int'), (None, 'None')):
        try: t(name, lambda: (p == other, p != other, other == p, other != p))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(name, lambda: (p == other, p != other, other == p, other != p))')
        for op, symbol in ((lambda a, b: a < b, '<'), (lambda a, b: a <= b, '<='), (lambda a, b: a > b, '>'), (lambda a, b: a >= b, '>=')):
            try: t(name + ' ' + symbol, lambda: op(p, other))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t(name + ' ' + symbol, lambda: op(p, other))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for other, name in ((dict(d), 'dict'), ({'a': 2}, 'other dict'), (typ...")
try: print('p.__eq__(d) =>', p.__eq__(d))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__eq__(d)')
try: print('p.__ne__(d) =>', p.__ne__(d))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__ne__(d)')
try: print('p.__eq__(1) =>', p.__eq__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__eq__(1)')
try: print('p.__lt__(d) =>', p.__lt__(d))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__lt__(d)')
try: print('p.__le__(p) =>', p.__le__(p))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__le__(p)')
try: print('p.__gt__(1) =>', p.__gt__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__gt__(1)')
try: print('p.__ge__(d) =>', p.__ge__(d))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.__ge__(d)')

# The operand sees a copy.
try:
    class Thief:
        def __eq__(self, other):
            self.got = other
            return True
        __ne__ = __eq__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Thief:')
try:
    for op in (lambda a, b: a == b, lambda a, b: a != b):
        try: thief = Thief()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thief = Thief()')
        try: print('op(p, thief) [' + 'op=' + (repr(op) if type(op) in (str, int, float, bytes, bool, type(None)) or (type(op) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in op)) else op.__name__ if type(op) is type else type(op).__name__) + '] =>', op(p, thief))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: op(p, thief)')
        try: print('type(thief.got).__name__ [' + 'op=' + (repr(op) if type(op) in (str, int, float, bytes, bool, type(None)) or (type(op) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in op)) else op.__name__ if type(op) is type else type(op).__name__) + '] =>', type(thief.got).__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(thief.got).__name__')
        try: print('thief.got == d [' + 'op=' + (repr(op) if type(op) in (str, int, float, bytes, bool, type(None)) or (type(op) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in op)) else op.__name__ if type(op) is type else type(op).__name__) + '] =>', thief.got == d)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thief.got == d')
        try: print('thief.got is d [' + 'op=' + (repr(op) if type(op) in (str, int, float, bytes, bool, type(None)) or (type(op) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in op)) else op.__name__ if type(op) is type else type(op).__name__) + '] =>', thief.got is d)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thief.got is d')
        try: thief.got['stolen'] = True
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: thief.got['stolen'] = True")
        try: print('d [' + 'op=' + (repr(op) if type(op) in (str, int, float, bytes, bool, type(None)) or (type(op) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in op)) else op.__name__ if type(op) is type else type(op).__name__) + '] =>', d)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for op in (lambda a, b: a == b, lambda a, b: a != b):')
try:
    class D(dict):
        def __eq__(self, other):
            self.got = other
            return NotImplemented
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(dict):')
try: sub = D()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub = D()')
try: print('p == sub =>', p == sub)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p == sub')
try: print('type(sub.got).__name__ =>', type(sub.got).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(sub.got).__name__')
try: print('sub.got is d =>', sub.got is d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub.got is d')
# A proxy of something that is not exactly a dict hands that over as it is.
try: user = collections.UserDict(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: user = collections.UserDict(d)')
try: thief = Thief()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thief = Thief()')
try: print('types.MappingProxyType(user) == thief =>', types.MappingProxyType(user) == thief)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: types.MappingProxyType(user) == thief')
try: print('thief.got is user =>', thief.got is user)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thief.got is user')
try: sub = D(d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sub = D(d)')
try: thief = Thief()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thief = Thief()')
try: print('types.MappingProxyType(sub) == thief =>', types.MappingProxyType(sub) == thief)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: types.MappingProxyType(sub) == thief')
try: print('thief.got is sub =>', thief.got is sub)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thief.got is sub')
try: t('hash', lambda: hash(p))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('hash', lambda: hash(p))")
try: t('hash of a proxy of a frozendict', lambda: hash(types.MappingProxyType(frozendict(d))) == hash(frozendict(d)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('hash of a proxy of a frozendict', lambda: hash(types.MappingProxyT...")
try: t('|', lambda: (p | {'b': 2}, {'b': 2} | p, type(p | p).__name__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('|', lambda: (p | {'b': 2}, {'b': 2} | p, type(p | p).__name__))")
try:
    def ior():
        q = types.MappingProxyType({}); q |= {}; return q
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ior():')
try: t('|=', ior)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('|=', ior)")
