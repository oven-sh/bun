# A guard over several lines: what the function returns, by the pattern, by which of the cases it is and by where the `match` is.
#
# Where a guard fails, the compiler may have a way out for each of its lines. Each of them has to lead somewhere: a `case _ if (a or` / `b):` that was the last of several, at the end of
# a function or in front of a jump, once branched to itself.
def indent(t, n=4): return '\n'.join(' ' * n + l for l in t.split('\n'))
GUARDS = {'one line': ' if b', 'or': ' if (a or\n        b)', 'and': ' if (a and\n        b)', 'below': ' if (\n        b)', 'not': ' if (not\n        b)',
          'conditional': ' if (a if b\n        else c)', 'compare': ' if (a <\n        b < c)', 'call': ' if bool(\n        b)', 'not or': ' if not (a or\n        b)',
          'walrus': ' if (d := a or\n        b)'}
PATTERNS = {'_': '_', 'v': 'v', '1': '1', '[x]': '[x]', 'two lines': '(0 |\n        1)'}
# The cases in front of the one with the guard, and behind it.
WHICH = {'only': ('', ''), 'last of two': ('case 7:\n    x = 7\n', ''), 'first of two': ('', 'case 7:\n    x = 7\n'), 'last of three': ('case 7:\n    x = 7\ncase 8:\n    x = 8\n', ''),
         'in front of default': ('', 'case _:\n    x = 9\n')}
PLACES = {'function': '%s', 'return': '%s\nreturn x', 'arm': 'if c < 9:\n%s\nelse:\n    x = 3\nreturn x', 'arm, nothing behind': 'if c < 9:\n%s\nelse:\n    x = 3',
          'loop': 'for i in (1, 2):\n%s\nreturn x', 'try': 'try:\n%s\nexcept KeyError:\n    x = 3\nreturn x', 'finally': 'try:\n%s\nfinally:\n    y = 3',
          'with': 'with CM():\n%s\nreturn x', 'default': 'match c:\n    case 5:\n        x = 3\n    case _:\n%s'}
class CM:
    def __enter__(self): return self
    def __exit__(self, *a): return False
def rows():
    for place, outer in PLACES.items():
        for which, (before, behind) in WHICH.items():
            for pname, pattern in PATTERNS.items():
                for gname, guard in GUARDS.items():
                    match = 'match a:\n' + indent(before + 'case ' + pattern + guard + ':\n    x = 2\n' + behind).rstrip()
                    depth = 0 if outer.startswith('%s') else 8 if place == 'default' else 4
                    namespace = {'CM': CM}
                    exec(compile('def f(a, b, c):\n    x = 0\n' + indent(outer % indent(match, depth)) + '\n', 'm', 'exec'), namespace)
                    results = []
                    for arguments in ((0, 0, 0), (0, 1, 0), (1, 0, 0), (5, 0, 1), (7, 1, 1), ([3], 1, 0)):
                        try: results.append(repr(namespace['f'](*arguments)))
                        except TypeError: results.append('TypeError')
                    yield '%s | %s | %s | %s | %s' % (place, which, pname, gname, ' '.join(results))
print('\n'.join(rows()))

# The body of a class.
a = 0; b = 0
class C:
    match a:
        case 1:
            x = 1
        case _ if (a or
                   b):
            x = 2
print(sorted(n for n in vars(C) if not n.startswith('__')))
