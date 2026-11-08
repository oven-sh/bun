# OrderedDict.update(a dict whose keys are not all strings) makes a list of the pairs and stores them one by one. The __hash__ of a key runs in between, and gc.get_objects() hands it the list, whose items were believed.
import collections, gc
class K:
    junk = None
    def __init__(self, n): self.n = n
    def __eq__(self, other): return self is other
    def __hash__(self):
        junk, K.junk = K.junk, None
        if junk is not None:
            for o in gc.get_objects():
                if type(o) is list and len(o) == 3 and all(type(p) is tuple and len(p) == 2 and type(p[0]) is K for p in o):
                    o[1] = o[2] = junk[0]
        return self.n
class T(tuple):
    def __iter__(self): return iter(('from', '__iter__'))
for name, junk in (('int', 5), ('None', None), ('()', ()), ('(1,)', (1,)), ('(1, 2, 3)', (1, 2, 3)), ("'ab'", 'ab'), ("'abc'", 'abc'), ('[K(7), 7]', [K(7), 7]), ('T((1, 2))', T((1, 2))), ('object', object())):
    d = {K(1): 1, K(2): 2, K(3): 3}; od = collections.OrderedDict()
    K.junk = [junk]
    try: od.update(d); print(name, '-> update() returned:', [(k.n if type(k) is K else k, v) for k, v in od.items()])
    except (TypeError, ValueError) as e: print(name, '->', type(e).__name__, e, '|', len(od))
