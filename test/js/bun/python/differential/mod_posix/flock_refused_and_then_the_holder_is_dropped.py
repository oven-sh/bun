# A file of the program's holds the lock. Another asks without waiting and is refused, rightly. Then the holder is dropped.
# (With reference counts it is closed at once. A collector that looked when the first call asked has to look again, and soon: that it
# looked in vain is no reason to wait.)
import fcntl, os, tempfile, time

directory = tempfile.TemporaryDirectory()
path = os.path.join(directory.name, "lock")


def has_lock(file):
    try:
        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return False
    return True


holder = open(path, "w")
fcntl.flock(holder, fcntl.LOCK_EX)
other = open(path, "w")
print("while it is held:", has_lock(other))
del holder
deadline = time.monotonic() + 60
polls = 1
while not has_lock(other) and time.monotonic() < deadline:
    polls += 1
    time.sleep(0.05)
print("dropped: had at poll", polls)
