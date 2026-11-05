# See 017_dict_keys.js.
class Probe:
    def __hash__(self): return 12345
    def __eq__(self, other): return False
# Asking a dict for such a key makes it place its str keys by hash().
def switch(mapping): return Probe() in mapping
def fresh(): return {'a': 1, 'b': 2, 'é': 3, '€': 4, '\U0001f600': 5, 'x' * 70: 6, '': 7, '10': 8}
def get(mapping, key): return mapping.get(key)
def put(mapping, key, value): mapping[key] = value
def drop(mapping, key): return mapping.pop(key, None)
def has(container, key): return key in container
def same_hash(a, b): return hash(a) == hash(b)
def hashes(keys): return [hash(k) for k in keys]
def as_set(keys): return set(keys)
def as_dict(keys): return {k: i for i, k in enumerate(keys)}
def show(value): return repr(value)
def own(): return ['a', 'b', 'é', '€', '\U0001f600', 'x' * 70, '', '10']
