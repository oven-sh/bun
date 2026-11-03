# os._exit(): at once, with nothing flushed and no cleanup.
import posix, sys, atexit
atexit.register(print, 'never printed')
print('before')
sys.stdout.flush()
try:
    posix._exit('a')
except TypeError as e:
    print(e)
try:
    posix._exit()
except TypeError as e:
    print(e)
try:
    posix._exit(2**40)
except OverflowError as e:
    print(e)
sys.stdout.flush()
try:
    posix._exit(status=7)
finally:
    print('not even this')
