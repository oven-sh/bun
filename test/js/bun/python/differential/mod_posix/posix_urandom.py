# os.urandom() and what is built on it. The bytes come from the system, which gives them in pieces and lets signals in between.
import os, random, secrets, signal, uuid

for size in (0, 1, 16, 255, 256, 257, 65536):
    data = os.urandom(size)
    print(size, type(data).__name__, len(data))
print("different each time:", len({os.urandom(16) for i in range(1000)}))

# More than Linux gives at a time (32 MiB less one byte): the rest has to be asked for, not left as it was.
size = (1 << 25) + 1000
data = os.urandom(size)
print(len(data) == size, any(data[:1000]), any(data[-1000:]), len(set(data[-1000:])) > 100)
del data


class Index:
    def __index__(self):
        return 3


print(len(os.urandom(Index())), len(os.urandom(True)))
for bad in (-1, 1.5, "1", None, 1 << 70, -(1 << 70)):
    try:
        print(len(os.urandom(bad)))
    except Exception as e:
        print(repr(bad), type(e).__name__, e)

# A signal arrives in the middle: its handler runs, and no byte is missing.
arrived = []
signal.signal(signal.SIGALRM, lambda number, frame: arrived.append(number))
signal.setitimer(signal.ITIMER_REAL, 0.001, 0.001)
sizes = set()
while len(arrived) < 3:
    sizes.add(len(os.urandom(1 << 24)))
signal.setitimer(signal.ITIMER_REAL, 0)
print("with handlers in between:", sizes == {1 << 24})


# What a handler raises ends it.
def raising(number, frame):
    raise KeyError("from the handler")


signal.signal(signal.SIGALRM, raising)
signal.setitimer(signal.ITIMER_REAL, 0.001)
try:
    while True:
        os.urandom(1 << 24)
except KeyError as e:
    print("ended by", repr(e))
signal.signal(signal.SIGALRM, signal.SIG_DFL)

# Generators that are given no seed get one from there.
print("seeds differ:", len({random.Random().random() for i in range(200)}))
generator = random.Random()
generator.seed()
first = generator.random()
generator.seed(None)
print(first != generator.random())
system = random.SystemRandom()
print(len({system.getrandbits(64) for i in range(200)}), 0 <= system.random() < 1, len(system.randbytes(5)))
print(len(secrets.token_bytes(8)), len(secrets.token_hex(8)), len({secrets.token_urlsafe() for i in range(100)}))
print(uuid.uuid4().version, len({uuid.uuid4() for i in range(100)}))
