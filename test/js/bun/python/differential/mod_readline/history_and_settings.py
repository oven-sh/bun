# The part of readline that needs no terminal: the history, its files, the settings.
import os, sys, tempfile
import readline


def attempt(label, f, *args):
    try:
        print(label, repr(f(*args)))
    except Exception as e:
        print(label, type(e).__name__, e)


def history():
    return [readline.get_history_item(i) for i in range(1, readline.get_current_history_length() + 1)]


print(readline.backend, "libedit" in readline.__doc__, type(readline).__name__)
print(repr(readline.get_completer_delims()), readline.get_completer(), readline.get_history_length(), readline.get_current_history_length())
print(repr(readline.get_line_buffer()), readline.get_begidx(), readline.get_endidx(), readline.get_completion_type(), readline.get_pre_input_hook())

for line in ("one", "two", "two", "", " ", "é€\U0001f600", "with\ttab", "a\nb"):
    attempt("add", readline.add_history, line)
print(history())
for bad in (1, None, b"bytes", "nul\0", "\udc80", "\ud800"):
    attempt("add %a" % (bad,), readline.add_history, bad)
print(history())
for index in (0, 1, -1, 3, 100, True, 1.0, "1", None, 2 ** 31, 2 ** 70):
    attempt("item %r" % (index,), readline.get_history_item, index)
for position in (-1, 100, "0", None, 2 ** 70):
    attempt("remove %r" % (position,), readline.remove_history_item, position)
    attempt("replace %r" % (position,), readline.replace_history_item, position, "x")
attempt("replace", readline.replace_history_item, 0, "ONE")
attempt("replace", readline.replace_history_item, 1, 5)
attempt("remove", readline.remove_history_item, 1)
print(history())

directory = tempfile.mkdtemp()
path = os.path.join(directory, "history")
attempt("read a missing file", readline.read_history_file, path)
attempt("append to a missing file", readline.append_history_file, 1, path)
attempt("write", readline.write_history_file, path)
print(open(path, "rb").read(), oct(os.stat(path).st_mode & 0o777))
attempt("append", readline.append_history_file, 2, path)
attempt("append", readline.append_history_file, 0, path)
attempt("append", readline.append_history_file, 1000, path)
attempt("append", readline.append_history_file, -1, path)
print(open(path, "rb").read().count(b"\n"))
readline.clear_history()
print(history())
attempt("read", readline.read_history_file, path)
print(len(history()), history()[:12])
attempt("read bytes", readline.read_history_file, os.fsencode(path))
attempt("read a path object", readline.read_history_file, __import__("pathlib").Path(path))
attempt("read a directory", readline.read_history_file, directory)
attempt("read 1", readline.read_history_file, 1)
print(len(history()))

readline.clear_history()
with open(path, "wb") as f:
    f.write(b"first\n\n  \nsecond\r\nthird \n#comment\n\xff\xfe\nlast without newline")
readline.read_history_file(path)
print([ascii(h) for h in history()])

# The length that files are cut to.
for length in (2, 0, -1, -5, "1", None, 1.5, 2 ** 70):
    attempt("set length %r" % (length,), readline.set_history_length, length)
    print(readline.get_history_length())
readline.clear_history()
for i in range(5):
    readline.add_history("line %d" % i)
readline.set_history_length(2)
print(readline.get_current_history_length())
readline.write_history_file(path)
print(open(path).read().split("\n"), readline.get_current_history_length())
readline.append_history_file(1, path)
print(open(path).read().split("\n"))
readline.set_history_length(0)
readline.write_history_file(path)
print(open(path).read().split("\n"))
readline.set_history_length(-1)

# HOME decides where the default file is.
os.environ["HOME"] = directory
attempt("default file", readline.write_history_file)
print(sorted(os.listdir(directory)))
attempt("default file", readline.read_history_file)
print(readline.get_current_history_length())
attempt("tilde", readline.write_history_file, "~/tilde")
print(sorted(os.listdir(directory)))


def completer(text, state):
    return None


for name in ("completer", "startup_hook", "pre_input_hook", "completion_display_matches_hook"):
    setter = getattr(readline, "set_" + name)
    for value in (completer, None, 1, "x", print):
        attempt("set_%s(%s)" % (name, getattr(value, "__name__", value)), setter, value)
    attempt("set_%s()" % name, setter)
readline.set_completer(completer)
print(readline.get_completer() is completer)
readline.set_completer()
print(readline.get_completer())
readline.set_pre_input_hook(completer)
print(readline.get_pre_input_hook() is completer)
readline.set_pre_input_hook()
print(readline.get_pre_input_hook())

for delimiters in (" \t", "", "abc", "é", 1, None, b" ", "a\0b"):
    attempt("delims %a" % (delimiters,), readline.set_completer_delims, delimiters)
    print(ascii(readline.get_completer_delims()))

for enabled in (True, False, 0, 1, "", "x", None, []):
    attempt("auto history %r" % (enabled,), readline.set_auto_history, enabled)

for text in ("tab: complete", "", "set editing-mode vi", "set editing-mode emacs", '"\\C-x": beginning-of-line', "a\0b", 1, None, b"tab: complete"):
    attempt("bind %a" % (text,), readline.parse_and_bind, text)
attempt("init file", readline.read_init_file, os.path.join(directory, "no such file"))
with open(os.path.join(directory, "inputrc"), "w") as f:
    f.write("# comment\nset bell-style none\n$if Python\ntab: complete\n$else\ntab: tab-insert\n$endif\n$if mode=vi\nset keymap vi\n$endif\n")
attempt("init file", readline.read_init_file, os.path.join(directory, "inputrc"))
attempt("init file", readline.read_init_file, 1)

attempt("insert_text", readline.insert_text, "text")
attempt("insert_text", readline.insert_text, 1)

# Without a terminal input() is what it always was.
sys.stdin = __import__("io").StringIO("from a file\n")
print(repr(input("prompt> ")))
print(history()[-1:])
