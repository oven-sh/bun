# break and continue in an except* block are refused wherever they stand, code that cannot be reached included.
DEAD = ['return\n{s}', 'raise E\n{s}', 'if 0:\n    {s}', 'while False:\n    {s}', 'if not 1:\n    {s}', 'while 1:\n    pass\nelse:\n    {s}', 'if 1:\n    pass\nelse:\n    {s}', '{s}']
def indent(text, by):
    return '\n'.join(' ' * by + line for line in text.split('\n'))
for statement in ('break', 'continue', 'return', 'pass'):
    for dead in DEAD:
        if 'while' in dead and statement in ('break', 'continue') and 'else' not in dead:
            continue  # It would belong to the inner loop.
        source = 'def f():\n    for i in x:\n        try:\n            pass\n        except* E:\n' + indent(dead.format(s=statement), 12) + '\n'
        try:
            compile(source, '<s>', 'exec')
            print(statement, repr(dead), 'compiles')
        except SyntaxError as e:
            print(statement, repr(dead), e.msg, e.lineno, e.offset)
