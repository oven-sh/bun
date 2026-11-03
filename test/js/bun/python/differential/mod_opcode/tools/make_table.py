# Prints the table of PyOpcodeModule.cpp, from what CPython says of its instructions. Run with the oracle:
#   python3 make_table.py /path/to/cpython
import re, sys, _opcode
root = sys.argv[1]
header = open(root + '/Include/internal/pycore_opcode_metadata.h').read()
ids = {}
for path in ('/Include/opcode_ids.h',):
    for m in re.finditer(r'#define (\w+)\s+(\d+)\n', open(root + path).read()):
        ids[m.group(1)] = int(m.group(2))
for m in re.finditer(r'#define (\w+)\s+(\d+)\n', header):
    ids.setdefault(m.group(1), int(m.group(2)))

def forms(function):
    body = re.search(r'int %s\(int opcode, int oparg\)  \{(.*?)\n\}' % function, header, re.S).group(1)
    out = {}
    for m in re.finditer(r'case (\w+):\s+return (.*?);', body):
        out[ids[m.group(1)]] = m.group(2)
    return out

def fit(text):
    f = eval('lambda oparg: ' + text)
    a = f(0)
    b = (f(2) - a) // 2
    c = f(1) - a - b
    if all(f(x) == a + b * x + c * (x & 1) for x in (0, 1, 2, 3, 4, 5, 7, 255, 256, 257, 1000, -1, -2, -3)):
        return a, b, c, 0
    g = lambda x: 1 + (x & 0xFF) + (x >> 8)
    assert all(f(x) == g(x) for x in range(-600, 600)), text
    return 0, 0, 0, 1

popped, pushed = forms('_PyOpcode_num_popped'), forms('_PyOpcode_num_pushed')
rows = []
for op in range(0, 400):
    if not _opcode.is_valid(op):
        continue
    flags = []
    for name, f in (('Arg', _opcode.has_arg), ('Const', _opcode.has_const), ('Name', _opcode.has_name), ('Jump', _opcode.has_jump), ('Free', _opcode.has_free), ('Local', _opcode.has_local), ('Exc', _opcode.has_exc)):
        if f(op):
            flags.append(name)
    try:
        _opcode.stack_effect(op, 0)
        known = True
    except ValueError:
        try:
            _opcode.stack_effect(op, 5)
            known = True
        except ValueError:
            known = False
    if known:
        flags.append('Effect')
    p, q = fit(popped[op]), fit(pushed[op])
    assert not p[3]
    if q[3]:
        flags.append('UnpackEx')
    rows.append((op, flags, p[:3], q[:3]))
for op, flags, p, q in rows:
    print('    { %d, %s, %d, %d, %d, %d, %d, %d },' % (op, ' | '.join(flags) or '0', *p, *q))
print(len(rows), file=sys.stderr)
print(_opcode.get_nb_ops(), file=sys.stderr)
print(_opcode.get_intrinsic1_descs(), file=sys.stderr)
print(_opcode.get_intrinsic2_descs(), file=sys.stderr)
print(_opcode.get_special_method_names(), file=sys.stderr)
print(_opcode.ENABLE_SPECIALIZATION, [n for n in dir(_opcode) if not n.startswith('__')], file=sys.stderr)
