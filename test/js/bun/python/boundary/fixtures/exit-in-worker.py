# What exit-in-worker-fixture.ts runs. HOW says how it exits.
import atexit, os, sys, threading
def say(text): os.write(1, text.encode() + b"\n")
class Finalized:
    def __del__(self): say("finalizer")
kept = Finalized()
atexit.register(say, "atexit")
how = os.environ["HOW"]
if how == "sys.exit(3)":
    sys.exit(3)
elif how == "raise SystemExit(3)":
    raise SystemExit(3)
elif how == "sys.exit(3) in a function that a callback of the event loop calls":
    import js
    js.setTimeout(lambda: sys.exit(3), 0)
elif how == "sys.exit(5) in a thread":
    thread = threading.Thread(target=sys.exit, args=(5,))
    thread.start()
    thread.join()
    say("the thread has ended")
elif how == "sys.exit(3), and sys.exit(4) in a function of atexit":
    def again():
        say("atexit, which exits")
        sys.exit(4)
    atexit.register(again)
    sys.exit(3)
elif how == "sys.exit(3), and sys.exit(4) in a listener of exit":
    exits_again = lambda: sys.exit(4)
    sys.exit(3)
