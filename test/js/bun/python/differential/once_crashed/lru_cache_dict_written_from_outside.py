# A cache with a bound maps a key to a link in a ring. gc.get_referents() hands out the dict, and what it gave for a key was taken for a link, unseen.
import functools, gc
@functools.lru_cache(4)
def f(a): return a * 2
print(f(1), f(2))
dicts = [o for o in gc.get_referents(f) if type(o) is dict and o and all(type(v).__name__ == '_lru_list_elem' for v in o.values())]
print(len(dicts), [len(d) for d in dicts])
[d] = dicts; links = dict(d)
for junk in (1, 'junk', (), object(), f):
    for key in d: d[key] = junk
    try: print('no exception:', f(1))
    except SystemError as e: print(type(junk).__name__, 'SystemError:', e)
d.update(links)
print(f(1), f(2), f(3), f.cache_info())
