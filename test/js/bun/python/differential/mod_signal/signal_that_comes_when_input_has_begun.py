# A signal that comes when input() has begun, off a terminal: what its handler raises comes out of input(), whether there is a prompt or not, and
# whether or not another file holds output, which is written out ahead of whatever input() writes or reads. Only a sys.stdout that has something to
# write takes it along if there is no prompt: how its flush() went is of no interest to input().
# (Both files at once are left out: what is raised while the other file is written out is reported here. DEFERRED.md, "input() on a terminal".)
import _thread, os, sys

r, w = os.pipe()
os.write(w, b"line\n" * 20)
os.close(w)
os.dup2(r, 0)


class Errors:
    def __init__(self): self.written = []
    def write(self, text): self.written.append(text)
    # The first thing that input() calls.
    flush = staticmethod(_thread.interrupt_main)


def ask(name, which, *prompt):
    sys.stdout.flush()
    file = open(os.devnull, "w")
    if which == "another file":
        file.write("text")
    if which == "sys.stdout":
        sys.stdout.write("text, ")
    sys.stderr = errors = Errors()
    try:
        result = "returned " + repr(input(*prompt))
    except KeyboardInterrupt:
        result = "KeyboardInterrupt"
    sys.stderr = sys.__stderr__
    file.close()
    print()
    print(name, "| holds output:", which, "|", result, errors.written)


for which in ("nothing", "another file", "sys.stdout"):
    ask("a prompt", which, "prompt? ")
    ask("no prompt", which)
    ask("an empty prompt", which, "")
    ask("a prompt that is not a str", which, 42)

# And without a signal all is as ever.
print(repr(input("prompt? ")))
