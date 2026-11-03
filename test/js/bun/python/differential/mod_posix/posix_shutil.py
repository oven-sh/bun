# shutil and tempfile: the standard library's heaviest users of the module posix.
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

base = '/tmp/pyposix_shutil_%d' % os.getpid()
os.mkdir(base)
os.chdir(base)
old_mask = os.umask(0o022)
try:
    print('-- copying files')
    write_file('src', b'some data\n' * 1000)
    os.chmod('src', 0o640)
    os.utime('src', ns=(1234567890123456789, 1111111111222222222))
    show(shutil.copyfile, 'src', 'copyfile')
    print(read_file('copyfile') == read_file('src'), stat.filemode(os.stat('copyfile').st_mode))
    show(shutil.copy, 'src', 'copy')
    print(read_file('copy') == read_file('src'), stat.filemode(os.stat('copy').st_mode), os.stat('copy').st_mtime_ns == os.stat('src').st_mtime_ns)
    show(shutil.copy2, 'src', 'copy2')
    print(read_file('copy2') == read_file('src'), stat.filemode(os.stat('copy2').st_mode), os.stat('copy2').st_mtime_ns)
    os.mkdir('into')
    show(shutil.copy, 'src', 'into')
    show(shutil.copyfile, 'src', 'src')
    show(shutil.copyfile, 'nope', 'x')
    show(shutil.copyfile, 'src', 'into')
    show(shutil.copyfile, 'src', 'no/such/dir')
    write_file('empty', b'')
    show(shutil.copyfile, 'empty', 'empty2')
    print(os.stat('empty2').st_size)
    write_file('big', bytes(range(256)) * 20000)
    show(shutil.copyfile, 'big', 'big2')
    print(read_file('big2') == read_file('big'))
    os.symlink('src', 'link')
    show(shutil.copyfile, 'link', 'link_copy', follow_symlinks=False)
    print(os.readlink('link_copy'))
    show(shutil.copymode, 'src', 'empty')
    print(stat.filemode(os.stat('empty').st_mode))
    show(shutil.copystat, 'src', 'empty')
    print(os.stat('empty').st_mtime_ns)
    os.setxattr('src', 'user.note', b'kept')
    shutil.copy2('src', 'with_xattr')
    print(os.listxattr('with_xattr'), os.getxattr('with_xattr', 'user.note'))
    os.mkfifo('fifo')
    show(shutil.copyfile, 'fifo', 'x')

    print('-- trees')
    os.makedirs('tree/a/b')
    os.makedirs('tree/c')
    write_file('tree/top', b't')
    write_file('tree/a/one', b'1')
    write_file('tree/a/b/two', b'22')
    os.chmod('tree/a/one', 0o600)
    os.symlink('a/one', 'tree/rel_link')
    os.symlink('nowhere', 'tree/broken')
    show(shutil.copytree, 'tree', 'tree2', symlinks=True)
    print(tree('tree2'))
    show(shutil.copytree, 'tree', 'tree2')
    show(shutil.copytree, 'tree', 'tree3', ignore_dangling_symlinks=True)
    print(tree('tree3'))
    show(shutil.copytree, 'tree', 'tree4', symlinks=True, ignore=shutil.ignore_patterns('t*', 'b'))
    print(tree('tree4'))
    show(shutil.copytree, 'tree', 'tree2', symlinks=True, dirs_exist_ok=True)
    try:
        shutil.copytree('tree', 'tree5')
    except shutil.Error as e:
        print('Error', [(a, b, c) for a, b, c in e.args[0]])
    show(shutil.rmtree, 'tree5')
    show(shutil.rmtree, 'tree2')
    show(shutil.rmtree, 'tree2')
    show(shutil.rmtree, 'tree2', ignore_errors=True)
    show(shutil.rmtree, 'src')
    show(shutil.rmtree, 'link')
    seen = []
    shutil.rmtree('nope', onexc=lambda function, path, exc: seen.append((function.__name__, path, type(exc).__name__)))
    print(seen)
    print(shutil.rmtree.avoids_symlink_attacks)
    os.mkdir('locked')
    os.mkdir('locked/inner')
    write_file('locked/inner/f', b'')
    show(shutil.rmtree, 'locked')
    dfd = os.open('.', os.O_RDONLY)
    show(shutil.rmtree, 'tree3', dir_fd=dfd)
    os.close(dfd)
    print(sorted(os.listdir('.')))

    print('-- move')
    show(shutil.move, 'copy', 'moved')
    show(shutil.move, 'moved', 'into')
    show(shutil.move, 'tree4', 'into')
    show(shutil.move, 'nope', 'x')
    show(shutil.move, 'copy2', 'into/src')
    print(tree('into'))

    print('-- the rest')
    usage = shutil.disk_usage('.')
    print(type(usage).__name__, usage._fields, usage.total > 0, usage.total >= usage.used)
    print(shutil.which('sh') in ('/bin/sh', '/usr/bin/sh'), shutil.which('no_such_command_here'), shutil.which('sh', path='/nowhere'), shutil.which('/bin/sh'))
    write_file('script', b'#!/bin/sh\n')
    print(shutil.which('script', path='.'), shutil.which('./script'))
    os.chmod('script', 0o755)
    print(shutil.which('script', path='.'), shutil.which('./script'), shutil.which(b'script', path=b'.'))
    print(shutil.get_terminal_size((70, 20)))
    os.environ['COLUMNS'] = '123'; os.environ['LINES'] = '45'
    print(shutil.get_terminal_size())
    show(shutil.chown, 'script', os.getuid(), os.getgid())
    show(shutil.chown, 'script', 'root' if os.getuid() == 0 else None, 'root' if os.getuid() == 0 else os.getgid())
    show(shutil.chown, 'script', 'no_such_user_here')
    show(shutil.chown, 'script')

    print('-- tempfile')
    import tempfile
    tempfile.tempdir = base
    d = tempfile.mkdtemp(prefix='pre', suffix='suf')
    print(os.path.dirname(d) == base, os.path.basename(d).startswith('pre'), d.endswith('suf'), stat.filemode(os.stat(d).st_mode))
    os.rmdir(d)
    fd, name = tempfile.mkstemp()
    print(type(fd).__name__, stat.filemode(os.fstat(fd).st_mode), os.get_inheritable(fd), os.path.exists(name))
    os.close(fd); os.unlink(name)
    with tempfile.TemporaryDirectory() as d:
        write_file(os.path.join(d, 'x'), b'x')
        os.mkdir(os.path.join(d, 'sub'))
        print(sorted(os.listdir(d)))
    print(os.path.exists(d))
    with tempfile.NamedTemporaryFile() as f:
        f.write(b'named')
        f.flush()
        print(read_file(f.name), os.path.exists(f.name))
    print(os.path.exists(f.name))
    with tempfile.TemporaryFile() as f:
        f.write(b'anonymous')
        f.seek(0)
        print(f.read())
    print(tempfile.gettempdir() == base, tempfile.gettempdirb() == base.encode())

finally:
    os.umask(old_mask)
    os.chdir('/')
    shutil.rmtree(base)
print(os.path.exists(base))
