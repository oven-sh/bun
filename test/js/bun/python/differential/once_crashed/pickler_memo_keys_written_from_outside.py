# The memo of a Pickler is a table by identity and a list that keeps the objects alive. gc.get_referents() hands out the list. Its items were taken for objects that have a number, and its length for the number of the next.
import gc, io, pickle
def keys_of(pickler): return [o for o in gc.get_referents(pickler) if type(o) is list]
p = pickle.Pickler(io.BytesIO()); p.dump([[1], [2]])
print([len(keys) for keys in keys_of(p)])
[keys] = keys_of(p)
kept = []
def uses(how):
    q = pickle.Pickler(io.BytesIO()); kept.append(q)
    for name, use in (('copy', lambda: p.memo.copy()), ('assign', lambda: setattr(q, 'memo', p.memo))):
        try: use(); print(how, name, 'no exception')
        except SystemError as e: print(how, name, 'SystemError:', e)
for junk in (1, 2.5, None, 'not memoized', object()):
    keys.append(junk); uses('one more: ' + type(junk).__name__); keys.pop()
    was = keys[1]; keys[1] = junk; uses('in the place of another: ' + type(junk).__name__); keys[1] = was
was = keys.pop(); uses('one less:'); keys.append(was)
was = keys[1]; keys[1] = keys[0]; uses('one of them twice:'); keys[1] = was
uses('as it was:')
print(sorted(number for number, value in p.memo.copy().values()))
gc.collect()

# With the list emptied no number is given twice.
file = io.BytesIO(); p = pickle.Pickler(file); x = ['x']; y = ['y']
p.dump([x])
for keys in keys_of(p): keys.clear()
p.dump([y, y, x])
u = pickle.Unpickler(io.BytesIO(file.getvalue())); first = u.load(); second = u.load()
print(first, second, second[0] is second[1], second[2] is first[0])
