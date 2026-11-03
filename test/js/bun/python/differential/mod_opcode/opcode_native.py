import _opcode

print(sorted(n for n in dir(_opcode) if not n.startswith('__')))
names = ('is_valid', 'has_arg', 'has_const', 'has_name', 'has_jump', 'has_free', 'has_local', 'has_exc')
for n in names:
    f = getattr(_opcode, n)
    print(n, [op for op in range(-3, 400) if f(op)])
def t(f):
    try:
        return f()
    except Exception as e:
        return type(e).__name__ + ': ' + str(e)
for op in range(-2, 300):
    row = []
    for arg in (None, 0, 1, 2, 3, 7, 255, 256, 257, 1000, -1, -2, -300):
        for jump in (None, True, False):
            row.append(t(lambda: _opcode.stack_effect(op, arg, jump=jump)))
    if len(set(row)) == 1:
        row = row[:1]
    print(op, row)
print(_opcode.get_nb_ops())
print(_opcode.get_intrinsic1_descs())
print(_opcode.get_intrinsic2_descs())
print(_opcode.get_special_method_names())
print(_opcode.get_specialization_stats())
print(t(lambda: _opcode.stack_effect('a')))
print(t(lambda: _opcode.stack_effect(1, 'a')))
print(t(lambda: _opcode.stack_effect(1, 1, jump=1)))
print(t(lambda: _opcode.stack_effect(1, 1, True)))
print(t(lambda: _opcode.stack_effect()))
print(t(lambda: _opcode.stack_effect(opcode=1)))
print(t(lambda: _opcode.stack_effect(1.5)))
print(t(lambda: _opcode.stack_effect(2 ** 40)))
print(t(lambda: _opcode.stack_effect(1, 2 ** 70)))
print(t(lambda: _opcode.is_valid(opcode=1)), t(lambda: _opcode.has_arg('x')), t(lambda: _opcode.has_arg()), t(lambda: _opcode.has_arg(2 ** 40)))
print(t(lambda: _opcode.get_executor(1, 2)))
print(t(lambda: _opcode.get_executor((lambda: 0).__code__, 'x')))
print(t(lambda: _opcode.get_executor(code=(lambda: 0).__code__, offset=0)))
