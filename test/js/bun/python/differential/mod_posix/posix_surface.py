# What the modules contain: names, the values of the constants, the kinds of everything else.
import posix, pwd, grp, fcntl, _locale, resource

# Left out on purpose: a copy of a process whose other threads are gone cannot go on.
ABSENT = {'fork', 'forkpty'}

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
