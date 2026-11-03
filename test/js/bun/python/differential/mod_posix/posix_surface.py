# What the modules contain: names, the values of the constants, the kinds of everything else.
import posix, pwd, grp, fcntl, _locale, resource

# Left out on purpose: a copy of a process whose other threads are gone cannot go on.
ABSENT = {'fork', 'forkpty'}
# In their place: os.py makes these of fork() where the module has none.
ABSENT |= {'spawnv', 'spawnve', 'spawnvp', 'spawnvpe', 'P_WAIT', 'P_NOWAIT', 'P_NOWAITO'}
# CPython has those that the headers knew which it was built with.
ABSENT |= {'STATX_MNT_ID', 'STATX_DIOALIGN', 'STATX_MNT_ID_UNIQUE', 'STATX_SUBVOL', 'STATX_WRITE_ATOMIC', 'STATX_DIO_READ_ALIGN'}

for module in (posix, pwd, grp, fcntl, _locale, resource):
    print('==', module.__name__)
    for name in sorted(dir(module)):
        if name.startswith('__') or name in ABSENT:
            continue
        value = getattr(module, name)
        if isinstance(value, int) and not isinstance(value, bool):
            print(name, value)
        else:
            print(name, type(value).__name__)

print(posix._have_functions)
print(posix.error is OSError, resource.error is OSError)
for names in (posix.pathconf_names, posix.confstr_names, posix.sysconf_names):
    print(len(names), list(names.items()))

for function in (posix.stat, posix.getcwd, posix.DirEntry.is_dir, pwd.getpwuid, fcntl.fcntl, _locale.setlocale, resource.getrusage):
    print(function.__name__, function.__qualname__, getattr(function, '__module__', None), type(function).__name__)
print(repr(posix.stat), repr(posix.DirEntry.stat))
print(posix.__name__, type(posix).__name__)

# Every member of the result of statx() has its mask, and the other way round.
if hasattr(posix, 'statx'):
    masks = {name: getattr(posix, name, None) for name in ('STATX_MNT_ID', 'STATX_DIOALIGN', 'STATX_MNT_ID_UNIQUE', 'STATX_SUBVOL', 'STATX_WRITE_ATOMIC', 'STATX_DIO_READ_ALIGN')}
    members = {'STATX_MNT_ID': ['stx_mnt_id'], 'STATX_DIOALIGN': ['stx_dio_mem_align', 'stx_dio_offset_align'], 'STATX_MNT_ID_UNIQUE': ['stx_mnt_id'],
               'STATX_SUBVOL': ['stx_subvol'], 'STATX_DIO_READ_ALIGN': ['stx_dio_read_offset_align'],
               'STATX_WRITE_ATOMIC': ['stx_atomic_write_unit_min', 'stx_atomic_write_unit_max', 'stx_atomic_write_segments_max', 'stx_atomic_write_unit_max_opt']}
    wanted = 0
    for mask in masks.values():
        wanted |= mask or 0
    result = posix.statx('.', posix.STATX_BASIC_STATS | wanted)
    for name, mask in masks.items():
        for member in members[name]:
            if mask is None:
                print(name, member, hasattr(result, member) and 'a member without a mask')
            else:
                value = getattr(result, member)
                print(name, member, not isinstance(value, int) if result.stx_mask & mask else value is not None)
