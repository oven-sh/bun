# glob and pathlib, on top of os and the module posix.
import os, shutil, stat, sys

def show(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
    except BaseException as e:
        print(type(e).__name__, e)
    else:
        print(repr(result))

def write_file(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.write(fd, data)
    os.close(fd)

def read_file(path):
    fd = os.open(path, os.O_RDONLY)
    data = os.read(fd, 10**7)
    os.close(fd)
    return data

def tree(top):
    result = []
    for root, dirs, files in os.walk(top):
        dirs.sort()
        for name in sorted(dirs + files):
            path = os.path.join(root, name)
            result.append((path, stat.filemode(os.lstat(path).st_mode)))
    return result

base = '/tmp/pyposix_glob_%d' % os.getpid()
os.mkdir(base)
os.chdir(base)
old_mask = os.umask(0o022)
try:
    os.makedirs('into/tree4/a')
    os.makedirs('into/tree4/c')
    write_file('into/tree4/a/one', b'1')
    os.symlink('a/one', 'into/tree4/rel_link')
    os.symlink('nowhere', 'into/tree4/broken')
    write_file('into/moved', b'm')
    write_file('into/src', b'src')
    write_file('big', b'b')
    write_file('copy', b'c')
    print('-- glob, fnmatch')
    import glob
    print(sorted(glob.glob('*')), sorted(glob.glob('into/*')), sorted(glob.glob('into/**', recursive=True)), sorted(glob.glob('[bc]*')), glob.glob('nope*'))
    print(sorted(glob.glob(b'into/*')), sorted(glob.iglob('*/src')), sorted(glob.glob('*', root_dir='into')))
    dfd = os.open('into', os.O_RDONLY)
    print(sorted(glob.glob('*', dir_fd=dfd)))
    os.close(dfd)

    print('-- pathlib')
    import pathlib
    p = pathlib.Path('into')
    print(p, p.exists(), p.is_dir(), p.is_file(), sorted(str(c) for c in p.iterdir()), sorted(str(c) for c in p.glob('*/a')), sorted(str(c) for c in p.rglob('one')))
    q = p / 'new.txt'
    print(q.write_text('text'), q.read_text(), q.read_bytes(), q.stat().st_size, q.name, q.suffix, q.parent, q.resolve() == pathlib.Path(os.path.realpath(base)) / 'into' / 'new.txt')
    q.chmod(0o600)
    print(stat.filemode(q.stat().st_mode), q.owner() == __import__('pwd').getpwuid(os.getuid()).pw_name, q.group() == __import__('grp').getgrgid(q.stat().st_gid).gr_name)
    r = q.rename(p / 'renamed.txt')
    print(r, q.exists(), r.exists())
    r.unlink()
    show(r.unlink)
    r.unlink(missing_ok=True)
    (p / 'x' / 'y').mkdir(parents=True)
    show((p / 'x' / 'y').mkdir)
    (p / 'x' / 'y').mkdir(exist_ok=True)
    (p / 'x' / 'y').rmdir()
    (p / 'l').symlink_to('src')
    print((p / 'l').is_symlink(), (p / 'l').readlink(), (p / 'l').samefile(p / 'src'), (p / 'l').lstat().st_size)
    (p / 'touched').touch()
    print((p / 'touched').stat().st_size, pathlib.Path.cwd() == pathlib.Path(os.getcwd()), pathlib.Path('~root').expanduser())
    for root, dirs, files in p.walk():
        dirs.sort()
        print(root, dirs, sorted(files))
finally:
    os.umask(old_mask)
    os.chdir('/')
    shutil.rmtree(base)
print(os.path.exists(base))
