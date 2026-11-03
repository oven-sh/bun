# Every pair of public built-in types as the bases of a class: which pairs make a class, and why the others do not.
import array, ast, builtins, collections, functools, io, itertools, re, struct, types, weakref

def public_types():
    seen = []
    for module in (builtins, types, collections, functools, itertools, io, weakref, array, ast, struct, re):
        names = sorted(n for n in dir(module) if not n.startswith('_'))
        if module is ast:
            names = ['AST', 'Name', 'expr']
        for name in names:
            value = getattr(module, name)
            if isinstance(value, type) and '__firstlineno__' not in vars(value) and value not in seen:
                seen.append(value)
    return seen

def label(t):
    return t.__name__ if t.__module__ == 'builtins' else t.__module__ + '.' + t.__name__

def classify(message):
    for code, text in (('N', 'is not an acceptable base type'), ('L', 'multiple bases have instance lay-out conflict'),
                       ('M', 'Cannot create a consistent method resolution'), ('D', 'duplicate base class'),
                       ('C', 'metaclass conflict')):
        if text in message:
            return code
    return '?' + message

TYPES = public_types()
print(len(TYPES), 'types')

# Alone.
BASES = []
for a in TYPES:
    try:
        type('X', (a,), {})
    except TypeError as e:
        print(label(a), classify(str(e)))
    else:
        BASES.append(a)

# Most exceptions are laid out as BaseException is; a few of those stand for them all.
PLAIN = (ArithmeticError, KeyError, ValueError, Warning)
BASES = [t for t in BASES if not issubclass(t, BaseException) or t in PLAIN or vars(t).keys() - vars(ValueError).keys()]
print(len(BASES), 'to pair:', ' '.join(map(label, BASES)))
for a in BASES:
    row = {}
    for b in BASES:
        try:
            cls = type('X', (a, b), {})
        except TypeError as e:
            code = classify(str(e))
        else:
            code = 'ok:' + label(cls.__base__)
        row.setdefault(code, []).append(label(b))
    print(label(a))
    for code in sorted(row):
        print('   ', code, len(row[code]), ' '.join(row[code]))
