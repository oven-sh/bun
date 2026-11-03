# The modules pwd and grp.
import pwd, grp, posix

def show(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
    except BaseException as e:
        print(type(e).__name__, e, e.args)
    else:
        print(repr(result))

print('-- pwd')
root = pwd.getpwuid(0)
print(root)
print(type(root), len(root), root.pw_name, root.pw_uid, root.pw_gid, root.pw_dir, root.pw_shell, root[0], root[2])
print([type(x).__name__ for x in root])
print(pwd.getpwnam('root') == root, pwd.getpwnam(root.pw_name).pw_uid)
me = pwd.getpwuid(posix.getuid())
print(me.pw_uid == posix.getuid(), pwd.getpwnam(me.pw_name) == me)
everyone = pwd.getpwall()
print(type(everyone).__name__, all(type(e) is pwd.struct_passwd for e in everyone), root in everyone, [e.pw_name for e in everyone][:5])
print(everyone == pwd.getpwall())
for e in everyone:
    assert pwd.getpwnam(e.pw_name).pw_name == e.pw_name
class Index:
    def __index__(self):
        return 0
print(pwd.getpwuid(Index()).pw_name, pwd.getpwuid(False).pw_name)
for value in ('a', 1.5, None, -1, -2, 2**31, 2**32 - 1, 2**32, 2**64, -2**70, 54321, b'0'):
    show(pwd.getpwuid, value)
for value in ('no_such_user', '', 5, None, b'root', 'a\0b', '\udcff', '\ud800', 'caf\xe9', "it's", 'x' * 300):
    show(pwd.getpwnam, value)
show(pwd.getpwuid)
show(pwd.getpwuid, 0, 1)
show(pwd.getpwuid, uidobj=0)
show(pwd.getpwnam)
show(pwd.getpwnam, name='root')
show(pwd.getpwall, 1)

print('-- grp')
root = grp.getgrgid(0)
print(root)
print(type(root), len(root), root.gr_name, root.gr_gid, root.gr_mem, root[0], root[2], [type(x).__name__ for x in root])
print(grp.getgrnam('root') == root, grp.getgrgid(id=0) == root, grp.getgrnam(name='root') == root)
everyone = grp.getgrall()
print(type(everyone).__name__, all(type(e) is grp.struct_group for e in everyone), root in everyone, [e.gr_name for e in everyone][:5])
print(everyone == grp.getgrall(), all(type(e.gr_mem) is list for e in everyone))
print(sorted((e.gr_name, e.gr_mem) for e in everyone if e.gr_mem)[:3])
for e in everyone:
    assert grp.getgrnam(e.gr_name).gr_gid == e.gr_gid
print(grp.getgrgid(Index()).gr_name, grp.getgrgid(False).gr_name)
for value in ('a', 1.5, None, -1, -2, 2**31, 2**32 - 1, 2**32, 2**64, -2**70, 54321, b'0'):
    show(grp.getgrgid, value)
for value in ('no_such_group', '', 5, None, b'root', 'a\0b', '\udcff', '\ud800', 'caf\xe9'):
    show(grp.getgrnam, value)
show(grp.getgrgid)
show(grp.getgrgid, 0, 1)
show(grp.getgrnam)
show(grp.getgrall, 1)
