# The environment.
import posix

def show(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
    except BaseException as e:
        print(type(e).__name__, e)
    else:
        print(repr(result))

env = posix.environ
print(type(env).__name__, all(type(k) is bytes and type(v) is bytes for k, v in env.items()), b'PATH' in env)
print(posix._create_environ() == env, posix._create_environ() is env, posix._create_environ() is posix._create_environ())

def current(name):
    return posix._create_environ().get(name)

show(posix.putenv, 'PYPOSIX_A', 'one')
print(current(b'PYPOSIX_A'), env.get(b'PYPOSIX_A'))
show(posix.putenv, b'PYPOSIX_A', b'two')
print(current(b'PYPOSIX_A'))
show(posix.putenv, 'PYPOSIX_B', '')
print(current(b'PYPOSIX_B'))
show(posix.putenv, 'PYPOSIX_U', 'caf\xe9 € \udcff')
print(current(b'PYPOSIX_U'))
show(posix.putenv, b'PYPOSIX_R\xff', b'\xfe')
print(current(b'PYPOSIX_R\xff'))
show(posix.putenv, 'PYPOSIX_E', 'a=b=c')
print(current(b'PYPOSIX_E'))
show(posix.putenv, 'A=B', 'x')
show(posix.putenv, '=', 'x')
show(posix.putenv, '', 'x')
show(posix.putenv, 'x')
show(posix.putenv, name='x', value='y')
print(posix.system('test "$PYPOSIX_A" = two && test "$PYPOSIX_E" = a=b=c'))

show(posix.unsetenv, 'PYPOSIX_A')
print(current(b'PYPOSIX_A'))
show(posix.unsetenv, 'PYPOSIX_A')
show(posix.unsetenv, b'PYPOSIX_B')
print(current(b'PYPOSIX_B'))
show(posix.unsetenv, '')
show(posix.unsetenv, 'A=B')
show(posix.unsetenv)
print(posix.system('test -z "$PYPOSIX_A"'))

class P:
    def __fspath__(self):
        return 'PYPOSIX_P'
show(posix.putenv, P(), P())
print(current(b'PYPOSIX_P'))

show(posix._clearenv)
print(posix._create_environ())
show(posix._clearenv, 1)
posix.putenv('ONLY', '1')
print(posix._create_environ())
