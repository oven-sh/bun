# sys.audit() and sys.addaudithook(): what a hook hears, who may refuse what.
import sys

heard = []
def first(event, args):
    if event.startswith("test."):
        heard.append(("first", event, args))

print(sys.audit("test.nobody", 1, 2))
sys.addaudithook(first)
print(sys.audit("test.one"))
print(sys.audit("test.two", 1, "a", None, [3]))
print(heard)
heard.clear()

# A second hook; the first hears of it.
seen = []
def watcher(event, args):
    if event == "sys.addaudithook":
        seen.append((event, args))
sys.addaudithook(watcher)
def second(event, args):
    if event.startswith("test."):
        heard.append(("second", event, args))
sys.addaudithook(second)
print(seen)
sys.audit("test.three", 3)
print(heard)
heard.clear()

# A hook that raises stops the event, and those after it do not hear it.
class Refused(Exception):
    pass
def refusing(event, args):
    if event == "test.refuse":
        raise Refused(args)
    if event.startswith("test."):
        heard.append(("refusing", event, args))
sys.addaudithook(refusing)
def last(event, args):
    if event.startswith("test."):
        heard.append(("last", event, args))
sys.addaudithook(last)
try:
    sys.audit("test.refuse", 42)
except Refused as e:
    print("refused", e.args)
print(heard)
heard.clear()

# An Exception from a hook on sys.addaudithook silently keeps the new hook out. A BaseException goes through.
blocking = [Exception]
def blocker(event, args):
    if event == "sys.addaudithook" and blocking:
        raise blocking[0]("no more hooks")
sys.addaudithook(blocker)
def never(event, args):
    if event.startswith("test."):
        heard.append(("never", event, args))
print(sys.addaudithook(never))
sys.audit("test.four")
print([who for who, *_ in heard])
heard.clear()
blocking[0] = KeyboardInterrupt
try:
    sys.addaudithook(never)
except KeyboardInterrupt as e:
    print("KeyboardInterrupt", e)
blocking.clear()

# Arguments.
for call in (lambda: sys.audit(), lambda: sys.audit(1), lambda: sys.audit(b"x"), lambda: sys.audit("test.kw", a=1),
             lambda: sys.addaudithook(), lambda: sys.addaudithook(hook=first) and None):
    try:
        print(call())
    except TypeError as e:
        print("TypeError", e)

# A hook that is not callable is found out when it is called.
sys.addaudithook(3)
try:
    sys.audit("test.five")
except TypeError as e:
    print("TypeError", e)
