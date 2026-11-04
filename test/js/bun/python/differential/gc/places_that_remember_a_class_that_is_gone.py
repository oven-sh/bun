# A place in a program remembers what it found in a class. The class goes, and all that was in it. The collector, which forgets
# what was remembered, must not look at it again in the collections that follow: there is nothing there any more.
import gc


def read(o): return len(o.table)
def call(o): return o.method()
def read_of_class(c): return len(c.table)
def call_static(o): return o.static()
def call_class_method(o): return o.of_class()


def once(size):
    class Gone:
        table = tuple(range(size))          # The larger ones are allocations of their own, given back at once.
        def method(self): return 1
        @staticmethod
        def static(): return 2
        @classmethod
        def of_class(cls): return 3
    o = Gone()
    for i in range(3):
        result = read(o), call(o), read_of_class(Gone), call_static(o), call_class_method(o)
    return result


for size in (3, 1000, 100000, 1000000):
    print(once(size))
    for i in range(3):
        gc.collect()
    junk = [bytearray(size * 8) for i in range(4)]     # Something else takes the memory.
    del junk
    gc.collect()
# The places still work.
print(once(5))
