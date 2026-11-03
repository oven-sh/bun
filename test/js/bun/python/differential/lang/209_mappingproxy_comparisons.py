# types.MappingProxyType: == and != go to the mapping, the rest is not there; a foreign operand never gets at the dict itself.
import collections, types

def t(label, f):
    try:
        print(label, 'ok', f())
    except Exception as e:
        print(label, type(e).__name__, e)

d = {'a': 1}
p = types.MappingProxyType(d)
for other, name in ((dict(d), 'dict'), ({'a': 2}, 'other dict'), (types.MappingProxyType(dict(d)), 'proxy'), (frozendict(d), 'frozendict'),
                    (collections.OrderedDict(d), 'OrderedDict'), (collections.UserDict(d), 'UserDict'), (collections.ChainMap(d), 'ChainMap'), ([('a', 1)], 'list'), (1, 'int'), (None, 'None')):
    t(name, lambda: (p == other, p != other, other == p, other != p))
    for op, symbol in ((lambda a, b: a < b, '<'), (lambda a, b: a <= b, '<='), (lambda a, b: a > b, '>'), (lambda a, b: a >= b, '>=')):
        t(name + ' ' + symbol, lambda: op(p, other))
print(p.__eq__(d), p.__ne__(d), p.__eq__(1), p.__lt__(d), p.__le__(p), p.__gt__(1), p.__ge__(d))

# The operand sees a copy.
class Thief:
    def __eq__(self, other):
        self.got = other
        return True
    __ne__ = __eq__
for op in (lambda a, b: a == b, lambda a, b: a != b):
    thief = Thief()
    print(op(p, thief), type(thief.got).__name__, thief.got == d, thief.got is d)
    thief.got['stolen'] = True
    print(d)
class D(dict):
    def __eq__(self, other):
        self.got = other
        return NotImplemented
sub = D()
print(p == sub, type(sub.got).__name__, sub.got is d)
# A proxy of something that is not exactly a dict hands that over as it is.
user = collections.UserDict(d)
thief = Thief()
print(types.MappingProxyType(user) == thief, thief.got is user)
sub = D(d)
thief = Thief()
print(types.MappingProxyType(sub) == thief, thief.got is sub)
t('hash', lambda: hash(p))
t('hash of a proxy of a frozendict', lambda: hash(types.MappingProxyType(frozendict(d))) == hash(frozendict(d)))
t('|', lambda: (p | {'b': 2}, {'b': 2} | p, type(p | p).__name__))
def ior():
    q = types.MappingProxyType({}); q |= {}; return q
t('|=', ior)
