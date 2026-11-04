# When the interpreter exits, what is still held by something else is finalized last, in the order it was made. Among it may be
# what a finalizer has made a moment ago and dropped: nothing holds it but the queue it waits in, while the finalizers before it
# make a lot of objects. (The collector was not told of the queue: the object was gone, and something else in its place, when its
# turn came.)
import os, sys

write = os.write


class Keeper:
    def __del__(self, write=write, range=range):
        junk = None
        for i in range(100000):
            junk = [junk and None, (i,), {i: i}]
        write(1, b"the one that sys holds is finalized\n")


sys.keeper = Keeper()


class Link:
    made = 0

    def __init__(self):
        Link.made += 1
        self.payload = [1, 2, 3]
        self.name = "link"

    def __del__(self, write=write):
        if self.payload != [1, 2, 3] or self.name != "link":
            write(1, b"a link is not what it was\n")
        # One more to finalize, more often than an exit looks for more: it gave up after 257 when this was written. (CPython finalizes
        # each inside the finalizer of the last, so there cannot be a thousand.)
        if Link.made < 600:
            Link()


Link()
print("the program ends", flush=True)
