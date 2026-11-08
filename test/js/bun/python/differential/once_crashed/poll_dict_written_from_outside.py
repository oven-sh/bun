# A poll object keeps what has been registered in a dict, from a descriptor to a mask. gc.get_objects() hands it out, and poll() read keys and values as small ints, unseen.
import gc, os, select
r, w = os.pipe()
p = select.poll(); p.register(r, select.POLLIN)
dicts = [o for o in gc.get_objects() if type(o) is dict and list(o.items()) == [(r, select.POLLIN)]]
print(len(dicts), [list(d.values()) for d in dicts])
[d] = dicts
for key, value in (('x', 1), (1.5, 1), (None, 1), (w, 'y'), (w, None), (w, 2 ** 40), (2 ** 40, 1)):
    d[key] = value
    try: print('no exception:', p.poll(0))
    except SystemError as e: print(type(key).__name__, type(value).__name__, 'SystemError:', e)
    del d[key]
print(p.poll(0))
os.write(w, b'x'); print([mask for fd, mask in p.poll(0)] == [select.POLLIN])
