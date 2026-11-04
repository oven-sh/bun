# Where set.pop() goes on looking is a matter of the set, not of its table: it stays when the set is emptied, refilled or given the table of another.
def rows():
    def start(): t = {1, 2, 3, 4, 5}; return t, [t.pop(), t.pop()], t.add(1)
    t, r, _ = start(); t.intersection_update([1, 3, 4, 5]); yield 'intersection_update', r + [t.pop()]
    t, r, _ = start(); t.clear(); t.update([1, 3, 4, 5]); yield 'clear', r + [t.pop()]
    t, r, _ = start(); t &= {1, 3, 4, 5}; yield '&=', r + [t.pop()]
    t, r, _ = start(); t.__init__([1, 3, 4, 5]); yield '__init__', r + [t.pop()]
    t, r, _ = start(); u = t.copy(); yield 'copy', r + [u.pop(), t.pop()]
    t, r, _ = start(); t.update(range(10, 40)); yield 'grown', r + [t.pop()]
    t, r, _ = start(); t.symmetric_difference_update([9]); yield '^=', r + [t.pop()]
    t, r, _ = start(); t -= {4}; yield '-=', r + [t.pop()]
    t, r, _ = start(); t.difference_update([4]); yield 'difference_update', r + [t.pop()]
    t, r, _ = start(); t |= {6, 7}; yield '|=', r + [t.pop()]
    t, r, _ = start(); t.discard(3); t.add(3); yield 'discard and add', r + [t.pop()]
    t, r, _ = start(); yield 'new sets', r + [(t | set()).pop(), (t & t).pop(), (t - set()).pop(), (t ^ set()).pop(), set(t).pop()]
    t = {1, 2, 3, 4, 5, 6, 7}; r = [t.pop() for _ in range(7)]; t.update([1, 2, 3]); yield 'emptied by pop', r + [t.pop()]
    t = set(range(40)); r = [t.pop() for _ in range(35)][-1:]; t.add(1); t.add(2); t.difference_update([36]); yield 'large', r + [t.pop()]
    t = set(range(40)); r = [t.pop() for _ in range(35)][-1:]; t.clear(); t.update([1, 2, 3, 4, 5]); yield 'large, cleared', r + [t.pop(), t.pop()]
    t = set(range(40)); r = [t.pop() for _ in range(35)][-1:]; t.intersection_update([36, 37]); t.update([1, 2]); yield 'large, smaller table', r + [t.pop(), t.pop()]
    t = {1, 2, 3, 4}; a = t.pop(); t.clear(); t.update([1, 2, 3, 4]); yield 'four', [a, t.pop()]
    t = set(); t.update([1, 2, 3]); t.clear(); t.clear(); t.update([5, 6]); yield 'never popped', [t.pop()]
for name, row in rows(): print(name, row)
