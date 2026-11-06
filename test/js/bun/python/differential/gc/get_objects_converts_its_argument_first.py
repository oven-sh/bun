# gc.get_objects(generation): the argument is converted first (__index__(), TypeError, OverflowError), then the audit hooks are shown the number, then the number is checked.
import gc, sys

log = []
def hook(event, args):
    if event.startswith('gc.'): log.append((event, [(type(a).__name__, a) for a in args]))
sys.addaudithook(hook)
class Index:
    def __index__(self):
        log.append('__index__')
        return 1
for what in (Index(), 'x', 1.5, True, None, 2, 2**40, -(2**40), 2**70, -(2**70), -1, -2, 3):
    del log[:]
    try: result = type(gc.get_objects(what)).__name__
    except Exception as error: result = '%s: %s' % (type(error).__name__, error)
    print('Index()' if isinstance(what, Index) else repr(what), '->', result, '|', log)
