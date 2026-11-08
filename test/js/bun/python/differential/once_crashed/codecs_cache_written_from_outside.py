# What a search function has found for an encoding is kept in a dict, and was taken apart as a tuple of four when it came out again, unseen. The dict stood in the module as _codecs._cache; gc.get_objects() hands it out too.
import _codecs, codecs, encodings, gc
print([name for name in ('_search_path', '_cache', '_errors') if hasattr(_codecs, name)])
'x'.encode('cp037')
caches = [o for o in gc.get_objects() if type(o) is dict and o and o is not encodings._cache and all(type(v) is codecs.CodecInfo for v in o.values())]
print(len(caches), [sorted(cache) for cache in caches])
for junk in (1, 'junk', (), [], object(), (1, 2, 3)):
    for cache in caches:
        for name in cache: cache[name] = junk
    for use in (lambda: 'x'.encode('cp037'), lambda: b'x'.decode('cp037'), lambda: codecs.lookup('cp037'), lambda: codecs.getincrementalencoder('cp037')):
        try: print('no exception:', use())
        except SystemError as e: print(type(junk).__name__, 'SystemError:', e)
for cache in caches: cache.clear()
print('x'.encode('cp037'))
