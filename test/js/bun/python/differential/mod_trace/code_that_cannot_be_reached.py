# A code object has no lines for statements that cannot be reached, and no constants that only they need.
SOURCES = [
    'return 1\nx = "dead"',
    'raise E\nx = "dead"\ndef g(): pass',
    'for i in y:\n    break\n    x = "dead"\nx = "live"',
    'for i in y:\n    continue\n    x = "dead"\nx = "live"',
    'for i in y:\n    return\nelse:\n    raise E\nx = "dead"',
    'for i in y:\n    break\nelse:\n    raise E\nx = "live"',
    'while c:\n    x = 1\nelse:\n    return\nx = "dead"',
    'while c:\n    break\nelse:\n    return\nx = "live"',
    'while True:\n    x = 1\nx = "dead"',
    'while True:\n    break\nx = "live"',
    'while 1:\n    if c:\n        break\nx = "live"',
    'while True:\n    return\n    break\nx = "dead"',
    'while True:\n    for i in y:\n        break\nx = "dead"',
    'while False:\n    x = "dead"\nelse:\n    x = "live"',
    'if c:\n    return\nelse:\n    raise E\nx = "dead"',
    'if c:\n    return\nelif d:\n    return\nelse:\n    return\nx = "dead"',
    'if c:\n    return\nelif d:\n    return\nx = "live"',
    'if True:\n    return\nx = "dead"',
    'if False:\n    x = "dead"\nx = "live"',
    'if True:\n    x = "live"\nelse:\n    x = "dead"',
    'if 0:\n    return\nx = "live"',
    'try:\n    return 1\n    x = "dead"\nexcept E:\n    return 2\nx = "dead too"',
    'try:\n    return 1\nexcept E:\n    pass\nx = "live"',
    'try:\n    x = 1\nexcept E:\n    return 2\nelse:\n    return 3\nx = "dead"',
    'try:\n    raise E\nexcept E:\n    return 2\nelse:\n    x = "dead"\nx = "dead too"',
    'try:\n    raise E\nfinally:\n    x = "live"\nx = "dead"',
    'try:\n    x = 1\nfinally:\n    return 1\nx = "dead"',
    'try:\n    return 1\nfinally:\n    x = "live"\nx = "dead"\ndef g(): pass',
    'try:\n    try:\n        return 1\n    finally:\n        x = "live"\n    x = "dead"\nfinally:\n    x = "live too"\nx = "dead too"',
    'for i in y:\n    try:\n        break\n    finally:\n        x = "live"\n    x = "dead"\nx = "live too"',
    'try:\n    raise E\nexcept* E:\n    x = 1\nelse:\n    x = "dead"\nx = "live"',
    'with c:\n    return 1\nx = "live"',
    'with c:\n    return 1\n    x = "dead"',
    'match c:\n    case 1:\n        return\n    case _:\n        return\nx = "dead"',
    'match c:\n    case 1:\n        return\n    case 2:\n        return\nx = "live"',
    'return\nclass K:\n    x = "dead"',
    'return\nx = lambda: "dead"\ny = [i for i in "dead too"]\nz = (i for i in "dead as well")',
    'class K:\n    raise E\n    x = "dead"\nx = "live"',
    'def g():\n    return 1\n    x = "dead"\n    def h(): pass\nx = "live"',
    'x = "both"\nreturn\nx = "both"',
    'return "first"\nx = "dead"',
    'assert False\nx = "live"',
    'yield 1\nreturn\nyield "dead"',
]


def walk(code):
    yield code
    for constant in code.co_consts:
        if hasattr(constant, 'co_code'):
            yield from walk(constant)


for number, body in enumerate(SOURCES):
    source = 'def f():\n' + ''.join('    ' + line + '\n' for line in body.split('\n'))
    code = compile(source, '<%d>' % number, 'exec').co_consts[0]
    print(number, repr(body))
    for inner in walk(code):
        print('   ', inner.co_name, sorted({line for _, _, line in inner.co_lines() if line}), [c for c in inner.co_consts if isinstance(c, str)])
