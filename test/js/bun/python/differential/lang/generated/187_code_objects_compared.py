# Code objects are equal if they do the same and say the same of where they come from, whatever they were made from,
# and their hashes do not change while something traces them.
try: import ast, sys, types, weakref
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import ast, sys, types, weakref')

try: SOURCES = (
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: SOURCES = ( 'x = 5', 'if True:\\n pass\\n', 'for n in [1, 2, 3]:\\n prin...")
try:
    for source in SOURCES:
        try: a = compile(source, 'a', 'exec')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: a = compile(source, 'a', 'exec')")
        try: b = compile(ast.parse(source), 'b', 'exec')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: b = compile(ast.parse(source), 'b', 'exec')")
        try: c = compile(source, 'c', 'exec')
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: c = compile(source, 'c', 'exec')")
        try: print('a == b [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', a == b)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a == b')
        try: print('a == c [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', a == c)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a == c')
        try: print('a != b [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', a != b)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a != b')
        try: print('hash(a) == hash(b) [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', hash(a) == hash(b))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(a) == hash(b)')
        try: print('hash(a) == hash(c) [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', hash(a) == hash(c))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(a) == hash(c)')
        try: print('list(a.co_positions()) == list(b.co_positions()) [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', list(a.co_positions()) == list(b.co_positions()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(a.co_positions()) == list(b.co_positions())')
        try: print('a.co_consts == b.co_consts [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', a.co_consts == b.co_consts)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.co_consts == b.co_consts')
        try: print('a.co_names == b.co_names [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', a.co_names == b.co_names)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.co_names == b.co_names')
        try: print('list(a.co_lines()) == list(b.co_lines()) [' + 'source=' + (repr(source) if type(source) in (str, int, float, bytes, bool, type(None)) or (type(source) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in source)) else source.__name__ if type(source) is type else type(source).__name__) + '] =>', list(a.co_lines()) == list(b.co_lines()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(a.co_lines()) == list(b.co_lines())')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for source in SOURCES:')

try:
    def same(first, second, mode='eval'):
        return compile(first, 'a', mode) == compile(second, 'a', mode)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def same(first, second, mode='eval'):")

try: print('constants', "same('1', '1.0') =>", same('1', '1.0'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('1', '1.0')")
try: print("same('1', 'True') =>", same('1', 'True'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('1', 'True')")
try: print("same('0.0', '-0.0') =>", same('0.0', '-0.0'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('0.0', '-0.0')")
try: print('same("\'a\'", "b\'a\'") =>', same("'a'", "b'a'"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: same("\'a\'", "b\'a\'")')
try: print("same('(1, 2)', '(1, 2.0)') =>", same('(1, 2)', '(1, 2.0)'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('(1, 2)', '(1, 2.0)')")
try: print("same('(0.0,)', '(-0.0,)') =>", same('(0.0,)', '(-0.0,)'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('(0.0,)', '(-0.0,)')")
try: print("same('1j', '1j') =>", same('1j', '1j'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('1j', '1j')")
try: print("same('0j', '-0j') =>", same('0j', '-0j'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('0j', '-0j')")
try: print("same('...', 'None') =>", same('...', 'None'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('...', 'None')")
try: print("same('(1, (2, 3))', '(1, (2, 3))') =>", same('(1, (2, 3))', '(1, (2, 3))'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('(1, (2, 3))', '(1, (2, 3))')")
try: print('names', "same('x', 'y') =>", same('x', 'y'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('x', 'y')")
try: print("same('x.a', 'x.b') =>", same('x.a', 'x.b'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('x.a', 'x.b')")
try: print("same('x', 'x') =>", same('x', 'x'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('x', 'x')")
try: print('places', "same('x', 'x ') =>", same('x', 'x '))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('x', 'x ')")
try: print("same('x', 'x#c') =>", same('x', 'x#c'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('x', 'x#c')")
try: print("same('(x)', ' x '.strip()) =>", same('(x)', ' x '.strip()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('(x)', ' x '.strip())")
try: print("same('x+1', 'x +1') =>", same('x+1', 'x +1'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('x+1', 'x +1')")
try: print("same('x', 'x\\n', 'exec') =>", same('x', 'x\n', 'exec'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('x', 'x\\n', 'exec')")
try: print("same('x', 'x\\n\\n#c\\n', 'exec') =>", same('x', 'x\n\n#c\n', 'exec'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('x', 'x\\n\\n#c\\n', 'exec')")
try: print("same('x', '\\nx', 'exec') =>", same('x', '\nx', 'exec'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('x', '\\nx', 'exec')")
try: print("same('f(x)', 'f( x)') =>", same('f(x)', 'f( x)'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: same('f(x)', 'f( x)')")
try: print('kinds', "compile('x', 'a', 'exec') == compile('x', 'a', 'eval') =>", compile('x', 'a', 'exec') == compile('x', 'a', 'eval'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: compile('x', 'a', 'exec') == compile('x', 'a', 'eval')")
try: print("compile('x', 'a', 'exec') == compile('x', 'a', 'single') =>", compile('x', 'a', 'exec') == compile('x', 'a', 'single'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: compile('x', 'a', 'exec') == compile('x', 'a', 'single')")
try: print('files', "compile('x', 'a', 'eval') == compile('x', 'b', 'eval') =>", compile('x', 'a', 'eval') == compile('x', 'b', 'eval'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: compile('x', 'a', 'eval') == compile('x', 'b', 'eval')")

try: g1, g2 = lambda: 1, lambda: 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g1, g2 = lambda: 1, lambda: 1')
try: print('two on a line', 'g1.__code__ == g2.__code__ =>', g1.__code__ == g2.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g1.__code__ == g2.__code__')
try: h = [(lambda: 1) for _ in range(2)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h = [(lambda: 1) for _ in range(2)]')
try: print('one, twice', 'h[0].__code__ == h[1].__code__ =>', h[0].__code__ == h[1].__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h[0].__code__ == h[1].__code__')
try: print('h[0].__code__ is h[1].__code__ =>', h[0].__code__ is h[1].__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h[0].__code__ is h[1].__code__')
try: print('others', 'g1.__code__ == 1 =>', g1.__code__ == 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g1.__code__ == 1')
try: print('g1.__code__ != 1 =>', g1.__code__ != 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g1.__code__ != 1')
try: print('g1.__code__ == None =>', g1.__code__ == None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g1.__code__ == None')
try: print('g1.__code__.__eq__(1) =>', g1.__code__.__eq__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g1.__code__.__eq__(1)')
try: print('g1.__code__.__ne__(1) =>', g1.__code__.__ne__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g1.__code__.__ne__(1)')
try:
    for operator in ('__lt__', '__le__', '__gt__', '__ge__'):
        try: print('operator [' + 'operator=' + (repr(operator) if type(operator) in (str, int, float, bytes, bool, type(None)) or (type(operator) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in operator)) else operator.__name__ if type(operator) is type else type(operator).__name__) + '] =>', operator)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: operator')
        try: print('getattr(g1.__code__, operator)(g2.__code__) [' + 'operator=' + (repr(operator) if type(operator) in (str, int, float, bytes, bool, type(None)) or (type(operator) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in operator)) else operator.__name__ if type(operator) is type else type(operator).__name__) + '] =>', getattr(g1.__code__, operator)(g2.__code__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(g1.__code__, operator)(g2.__code__)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for operator in ('__lt__', '__le__', '__gt__', '__ge__'):")

try:
    def replaced(**changes):
        return g1.__code__.replace(**changes)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def replaced(**changes):')
try: print('replace', 'replaced() == g1.__code__ =>', replaced() == g1.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: replaced() == g1.__code__')
try: print('hash(replaced()) == hash(g1.__code__) =>', hash(replaced()) == hash(g1.__code__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(replaced()) == hash(g1.__code__)')
try: print("replaced(co_name='n') == g1.__code__ =>", replaced(co_name='n') == g1.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: replaced(co_name='n') == g1.__code__")
try: print('replaced(co_firstlineno=1) == g1.__code__ =>', replaced(co_firstlineno=1) == g1.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: replaced(co_firstlineno=1) == g1.__code__')
try: print("replaced(co_filename='f') == g1.__code__ =>", replaced(co_filename='f') == g1.__code__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: replaced(co_filename='f') == g1.__code__")
try:
    for changes in ({'co_nlocals': 1}, {'co_nlocals': -1}):
        try:
            print('replaced(**changes) [' + 'changes=' + (repr(changes) if type(changes) in (str, int, float, bytes, bool, type(None)) or (type(changes) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in changes)) else changes.__name__ if type(changes) is type else type(changes).__name__) + '] =>', replaced(**changes))
        except Exception as e:
            print('type(e).__name__ [' + 'changes=' + (repr(changes) if type(changes) in (str, int, float, bytes, bool, type(None)) or (type(changes) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in changes)) else changes.__name__ if type(changes) is type else type(changes).__name__) + '] =>', type(e).__name__)
            print('e [' + 'changes=' + (repr(changes) if type(changes) in (str, int, float, bytes, bool, type(None)) or (type(changes) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in changes)) else changes.__name__ if type(changes) is type else type(changes).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for changes in ({'co_nlocals': 1}, {'co_nlocals': -1}):")

# A debugger keeps what it knows of code objects in dictionaries, and looks there while it traces them.
try:
    def helper(n):
        total = 0
        for i in range(n):
            if i % 2:
                total += i
        return total
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def helper(n):')

try: code = helper.__code__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code = helper.__code__')
try: kept = {code: 'kept'}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: kept = {code: 'kept'}")
try: weakly = weakref.WeakKeyDictionary({code: 'weakly'})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: weakly = weakref.WeakKeyDictionary({code: 'weakly'})")
try: before = hash(code)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: before = hash(code)')
try: twin = compile(ast.parse('def helper(n):\n    total = 0\n    for i in range(n):\n        if i % 2:\n            total += i\n    return total\n'), 'f', 'exec').co_consts[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: twin = compile(ast.parse('def helper(n):\\n total = 0\\n for i in range...")
try: twin = twin.replace(co_firstlineno=code.co_firstlineno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: twin = twin.replace(co_firstlineno=code.co_firstlineno)')
try: seen = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')
try:
    def tracer(frame, event, arg):
        if frame.f_code is code:
            seen.append((event, kept[frame.f_code], weakly[frame.f_code], hash(frame.f_code) == before))
        return tracer
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tracer(frame, event, arg):')
try: sys.settrace(tracer)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(tracer)')
try: helper(2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: helper(2)')
try: sys.settrace(None)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.settrace(None)')
try: print('len(seen) =>', len(seen))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(seen)')
try: print("set(seen) == {(event, 'kept', 'weakly', True) for event in ('call', '... =>", set(seen) == {(event, 'kept', 'weakly', True) for event in ('call', 'line', 'return')})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(seen) == {(event, 'kept', 'weakly', True) for event in ('call', '...")

try: TOOL = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TOOL = 3')
try: sys.monitoring.use_tool_id(TOOL, 'test')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sys.monitoring.use_tool_id(TOOL, 'test')")
try: events = sys.monitoring.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: events = sys.monitoring.events')
try: found = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: found = []')
try:
    for event in (events.LINE, events.INSTRUCTION, events.BRANCH_LEFT | events.BRANCH_RIGHT, events.PY_START | events.PY_RETURN, events.CALL):
        try: sys.monitoring.set_local_events(TOOL, code, event)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.monitoring.set_local_events(TOOL, code, event)')
        try: copy = compile('def helper(n):\n    total = 0\n    for i in range(n):\n        if i % 2:\n            total += i\n    return total\n', 'f', 'exec').co_consts[0]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: copy = compile('def helper(n):\\n total = 0\\n for i in range(n):\\n if ...")
        try: found.append((kept.get(code), weakly.get(code), hash(code) == before, code == code, hash(copy) == hash(twin.replace(co_firstlineno=1))))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: found.append((kept.get(code), weakly.get(code), hash(code) == before,...')
        try: helper(2)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: helper(2)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for event in (events.LINE, events.INSTRUCTION, events.BRANCH_LEFT | e...')
try: sys.monitoring.set_local_events(TOOL, code, 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.monitoring.set_local_events(TOOL, code, 0)')
try: sys.monitoring.free_tool_id(TOOL)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.monitoring.free_tool_id(TOOL)')
try: print(found)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: found')
try: print('hash(code) == before =>', hash(code) == before)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(code) == before')
try: print('kept[code] =>', kept[code])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept[code]')
try: print('weakly[code] =>', weakly[code])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: weakly[code]')
