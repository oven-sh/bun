# Code objects are equal if they do the same and say the same of where they come from, whatever they were made from,
# and their hashes do not change while something traces them.
import ast, sys, types, weakref

SOURCES = (
    'x = 5',
    'if True:\n    pass\n',
    'for n in [1, 2, 3]:\n    print(n)\n',
    'def foo():\n    pass\nfoo()\n',
    "x = '\u00e4' + f(1.5, b'x', (1, 2))\n",
    "class C:\n  '''doc'''\n  def m(self): return [y for y in z]\n",
    'def f():\n        class M:\n            "doc"\n            x = 1\n        g = lambda: 1\n        return M, g\n',
    'async def f():\n    async with a as b:\n        async for c in d:\n            yield c\n',
    'try:\n    a\nexcept* E as e:\n    b\nfinally:\n    c\n',
    'match a:\n    case [1, *b] if c:\n        d\n    case {"k": v}:\n        e\n',
)
for source in SOURCES:
    a = compile(source, 'a', 'exec')
    b = compile(ast.parse(source), 'b', 'exec')
    c = compile(source, 'c', 'exec')
    print(a == b, a == c, a != b, hash(a) == hash(b), hash(a) == hash(c), list(a.co_positions()) == list(b.co_positions()),
          a.co_consts == b.co_consts, a.co_names == b.co_names, list(a.co_lines()) == list(b.co_lines()))

def same(first, second, mode='eval'):
    return compile(first, 'a', mode) == compile(second, 'a', mode)

print('constants', same('1', '1.0'), same('1', 'True'), same('0.0', '-0.0'), same("'a'", "b'a'"), same('(1, 2)', '(1, 2.0)'),
      same('(0.0,)', '(-0.0,)'), same('1j', '1j'), same('0j', '-0j'), same('...', 'None'), same('(1, (2, 3))', '(1, (2, 3))'))
print('names', same('x', 'y'), same('x.a', 'x.b'), same('x', 'x'))
print('places', same('x', 'x '), same('x', 'x#c'), same('(x)', ' x '.strip()), same('x+1', 'x +1'), same('x', 'x\n', 'exec'),
      same('x', 'x\n\n#c\n', 'exec'), same('x', '\nx', 'exec'), same('f(x)', 'f( x)'))
print('kinds', compile('x', 'a', 'exec') == compile('x', 'a', 'eval'), compile('x', 'a', 'exec') == compile('x', 'a', 'single'))
print('files', compile('x', 'a', 'eval') == compile('x', 'b', 'eval'))

g1, g2 = lambda: 1, lambda: 1
print('two on a line', g1.__code__ == g2.__code__)
h = [(lambda: 1) for _ in range(2)]
print('one, twice', h[0].__code__ == h[1].__code__, h[0].__code__ is h[1].__code__)
print('others', g1.__code__ == 1, g1.__code__ != 1, g1.__code__ == None, g1.__code__.__eq__(1), g1.__code__.__ne__(1))
for operator in ('__lt__', '__le__', '__gt__', '__ge__'):
    print(operator, getattr(g1.__code__, operator)(g2.__code__))

def replaced(**changes):
    return g1.__code__.replace(**changes)
print('replace', replaced() == g1.__code__, hash(replaced()) == hash(g1.__code__), replaced(co_name='n') == g1.__code__,
      replaced(co_firstlineno=1) == g1.__code__, replaced(co_filename='f') == g1.__code__)
for changes in ({'co_nlocals': 1}, {'co_nlocals': -1}):
    try:
        print(replaced(**changes))
    except Exception as e:
        print(type(e).__name__, e)

# A debugger keeps what it knows of code objects in dictionaries, and looks there while it traces them.
def helper(n):
    total = 0
    for i in range(n):
        if i % 2:
            total += i
    return total

code = helper.__code__
kept = {code: 'kept'}
weakly = weakref.WeakKeyDictionary({code: 'weakly'})
before = hash(code)
twin = compile(ast.parse('def helper(n):\n    total = 0\n    for i in range(n):\n        if i % 2:\n            total += i\n    return total\n'), 'f', 'exec').co_consts[0]
twin = twin.replace(co_firstlineno=code.co_firstlineno)
seen = []
def tracer(frame, event, arg):
    if frame.f_code is code:
        seen.append((event, kept[frame.f_code], weakly[frame.f_code], hash(frame.f_code) == before))
    return tracer
sys.settrace(tracer)
helper(2)
sys.settrace(None)
print(len(seen), set(seen) == {(event, 'kept', 'weakly', True) for event in ('call', 'line', 'return')})

TOOL = 3
sys.monitoring.use_tool_id(TOOL, 'test')
events = sys.monitoring.events
found = []
for event in (events.LINE, events.INSTRUCTION, events.BRANCH_LEFT | events.BRANCH_RIGHT, events.PY_START | events.PY_RETURN, events.CALL):
    sys.monitoring.set_local_events(TOOL, code, event)
    copy = compile('def helper(n):\n    total = 0\n    for i in range(n):\n        if i % 2:\n            total += i\n    return total\n', 'f', 'exec').co_consts[0]
    found.append((kept.get(code), weakly.get(code), hash(code) == before, code == code, hash(copy) == hash(twin.replace(co_firstlineno=1))))
    helper(2)
sys.monitoring.set_local_events(TOOL, code, 0)
sys.monitoring.free_tool_id(TOOL)
print(found)
print(hash(code) == before, kept[code], weakly[code])
