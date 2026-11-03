import opcode
for n in opcode.__all__:
    print(n, getattr(opcode, n) if n != 'stack_effect' else '')
print(opcode._intrinsic_1_descs, opcode._intrinsic_2_descs, opcode._special_method_names, opcode._nb_ops, opcode._common_constants)
print(opcode._inline_cache_entries)
