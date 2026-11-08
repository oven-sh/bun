# When JS changes a variable of the environment, it is written into posix.environ too. That dict was looked for under its name in the first namespace of the module, which gc.get_objects() hands out, and what stood there was believed.
import gc, os, posix, js
found = [o for o in gc.get_objects() if type(o) is dict and o is not posix.__dict__ and o.get('environ') is posix.environ and '__package__' in o]
print(len(found))
for n, junk in enumerate((1, None, 'junk', [], object())):
    for d in found: d['environ'] = junk
    setattr(js.process.env, 'ONCE_CRASHED_%d' % n, 'set by JS')
    print(type(junk).__name__, os.environ.get('ONCE_CRASHED_%d' % n), posix.environ.get(b'ONCE_CRASHED_%d' % n))
for d in found: del d['environ']
js.process.env.ONCE_CRASHED_5 = 'set by JS'
print('gone', os.environ.get('ONCE_CRASHED_5'), posix.environ.get(b'ONCE_CRASHED_5'))
