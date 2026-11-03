import dis, opcode, io

print(len(dis.opname), dis.opmap['LOAD_CONST'] == opcode.opmap['LOAD_CONST'], dis.cmp_op, dis.EXTENDED_ARG, dis.HAVE_ARGUMENT)
print(sorted(dis.COMPILER_FLAG_NAMES.items()))
print(dis.pretty_flags(3 | 32 | 128), dis.stack_effect(dis.opmap['POP_TOP']), dis.stack_effect(dis.opmap['BUILD_LIST'], 3))
def f(a, b=1, *c, d, **e):
    "doc"
    x = a + b
    return x
print(dis.code_info(f).replace(__file__, 'FILE').split('Stack size')[0])
print(dis.pretty_flags(f.__code__.co_flags))
