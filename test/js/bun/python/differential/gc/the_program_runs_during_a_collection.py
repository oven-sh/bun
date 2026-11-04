# The program walks the list of objects with finalizers while a collection that the engine began by itself is under way: what such
# an object keeps alive takes long to mark (a chain, which is marked link by link), and the program runs meanwhile.
import gc

count = 0


class A:
    def __del__(self):
        global count
        count += 1


class Q:
    pass


for round in range(6):
    a = A()
    chain = None
    for j in range(300000):
        chain = [chain]
    a.chain = chain
    del a, chain
    for i in range(4000):
        q = Q()
        q.__class__ = A   # Looks whether it is in the list.
        q.__class__ = Q
        [[j] for j in range(40)]
del q
gc.collect()
print(count)
