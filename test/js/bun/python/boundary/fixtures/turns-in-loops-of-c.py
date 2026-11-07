import collections, itertools, os, signal, threading

def start_thread(path):
    "A thread that waits for a byte, and then makes the file as soon as it gets its turn. Returns where to write the byte."
    readable, writable = os.pipe()
    def work():
        os.read(readable, 1)
        open(path, "w").close()
    threading.Thread(target=work, daemon=True).start()
    return writable

class Finalized:
    def __init__(self, path):
        self.path = path
        self.me = self
    def __del__(self):
        open(self.path, "w").close()

def drop(path):
    Finalized(path)

def handle(path):
    signal.signal(signal.SIGUSR1, lambda *a: open(path, "w").close())

class Stop(Exception):
    pass

def handle_by_raising():
    def raises(*a): raise Stop("from the handler")
    signal.signal(signal.SIGUSR1, raises)

def contains(iterable, item): return item in iterable
def consume_set(iterable): return len(set(iterable)) > 0
def consume_join(iterable): return len("".join(iterable)) >= 0
def consume_dict(iterable): return len(dict.fromkeys(iterable)) > 0

# Loops that call a function for every item, until it says that it is over, or as long as it says that it goes on.
def any_map(is_over, goes_on): return any(map(is_over, itertools.count()))
def next_filter(is_over, goes_on): return next(filter(is_over, itertools.count())) >= 0
def next_filterfalse(is_over, goes_on): return next(itertools.filterfalse(goes_on, itertools.count())) >= 0
def next_dropwhile(is_over, goes_on): return next(itertools.dropwhile(goes_on, itertools.count())) >= 0
def all_takewhile(is_over, goes_on): return len(collections.deque(itertools.takewhile(goes_on, itertools.count()), maxlen=0)) == 0
def any_starmap(is_over, goes_on): return any(itertools.starmap(is_over, zip(itertools.count())))
def any_accumulate(is_over, goes_on): return any(itertools.accumulate(itertools.repeat(0), is_over))
def all_iter(is_over, goes_on): return len(collections.deque(iter(is_over, True), maxlen=0)) == 0

# Until the constructor throws.
def construct(cls): collections.deque(map(cls, itertools.count()), maxlen=0)
def construct_by_new(cls): collections.deque(map(cls.new, itertools.count()), maxlen=0)
def construct_subclass(cls):
    class Derived(cls): pass
    collections.deque(map(Derived, itertools.count()), maxlen=0)
def send(generator): return len(collections.deque(map(generator.send, itertools.repeat(None)), maxlen=0)) == 0
