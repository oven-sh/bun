# Whether CPython's collector keeps track of a tuple goes by its items, and an item that is a tuple is asked the same. There the answer is a bit of the tuple. Whoever works it out has to do so for tuples in tuples 200,000
# deep, and for a tuple that is an item of the next twice over, forty levels up (2 ** 40 ways down): without recursion, and asking each tuple once.
import gc
def deep(n, bottom):
    t = bottom
    for i in range(n): t = (t,)
    return t
def wide(n, bottom):
    t = bottom
    for i in range(n): t = (t, t)
    return t
among = lambda o, objects: any(r is o for r in objects)
for name, make, n in (('deep', deep, 200000), ('wide', wide, 40)):
    # (With nothing at the bottom that is kept track of, what CPython says of the top goes by how many collections have come, and in which order they met the tuples: not compared.)
    t = make(n, (1, 'a')); gc.collect()
    print('%s, nothing that is kept track of at the bottom: there is an answer: %s; all objects: %s; the referrers of its item: %s' % (name, gc.is_tracked(t) in (True, False), len(gc.get_objects()) > 0, len(gc.get_referrers(t[0])) in (0, 1)))
    t = make(n, ([],)); gc.collect()
    print('%s, a list at the bottom: kept track of: %s; among all objects: %s; the referrers of its item: %d, it among them: %s' % (name, gc.is_tracked(t), among(t, gc.get_objects()), len(gc.get_referrers(t[0])), among(t, gc.get_referrers(t[0]))))
    del t
