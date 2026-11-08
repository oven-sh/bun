# An object of JavaScript's in a list, a tuple, a dict, an attribute or a closure of Python's is a value of the program's like any other: what holds it is among its referrers, and it is among the referents of a container
# that holds it. So for an instance of a class of Python's that derives from a class of JavaScript's. (An instance and the cell of a closure do not give it among their referents: what such a cell refers to beside
# objects of Python may be the engine's own, and nothing tells the two apart there. A gap, written down as it is.)
import gc, _js
js = _js.globalThis
class Holder: pass
class MapOfPython(js.Map): pass
among = lambda o, objects: any(r is o for r in objects)
def closes_over(p): return lambda: p
for name, p in (('an object', js.Object()), ('a Map', js.Map()), ('a function', js.parseInt), ('an instance of a class of Python that derives from Map', MapOfPython()), ('an instance of Python, for comparison', Holder())):
    l = [p]; t = (p, 1); d = {'k': p}; h = Holder(); h.a = p; f = closes_over(p); cell = f.__closure__[0]
    referrers = gc.get_referrers(p)
    print('%s: kept track of: %s' % (name, gc.is_tracked(p)))
    for what, holder in (('a list', l), ('a tuple', t), ('a dict', d), ('an instance', h), ('the cell of a closure', cell)):
        print('    %s: it is among the referents: %s; the holder is among its referrers: %s' % (what, among(p, gc.get_referents(holder)), among(holder, referrers)))
