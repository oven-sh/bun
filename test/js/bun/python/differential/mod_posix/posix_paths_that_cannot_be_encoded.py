# Functions of os.path and pathlib that only look at the text of a path take any text; those that ask the system say no.
import os
import os.path
import pathlib

samples = ["a/\udfff/../b", "\ud800", "/x//\udc80/./y/", "//\udcff", "América/\ud800York", "a\0b/../c", "\udfff\ud800/.."]
for path in samples:
    print(ascii(path))
    for name in ("normpath", "splitroot", "split", "splitext", "basename", "dirname", "isabs", "normcase", "splitdrive"):
        try:
            print("  ", name, ascii(getattr(os.path, name)(path)))
        except Exception as e:
            print("  ", name, type(e).__name__, e)
    for name in ("exists", "lexists", "isfile", "isdir", "islink", "ismount", "isjunction", "isdevdrive"):
        try:
            print("  ", name, getattr(os.path, name)(path))
        except Exception as e:
            print("  ", name, type(e).__name__, e)
    for name in ("abspath", "realpath", "getsize", "expanduser", "expandvars"):
        try:
            result = getattr(os.path, name)(path)
            print("  ", name, ascii(result[len(os.getcwd()):] if isinstance(result, str) and result.startswith(os.getcwd()) else result))
        except Exception as e:
            print("  ", name, type(e).__name__, str(e)[:60])
    try:
        p = pathlib.PurePosixPath(path)
        print("  ", "pure", ascii(str(p)), ascii(p.parts), ascii(p.name), ascii(p.anchor))
    except Exception as e:
        print("  ", "pure", type(e).__name__, e)
    p = pathlib.Path(path)
    for name in ("exists", "is_file", "is_dir", "is_symlink", "is_mount", "is_junction", "is_socket", "is_fifo", "is_block_device", "is_char_device"):
        try:
            print("  ", name, getattr(p, name)())
        except Exception as e:
            print("  ", name, type(e).__name__, str(e)[:60])
    for name in ("exists", "is_file", "is_dir", "is_symlink"):
        try:
            print("  ", "info." + name, getattr(p.info, name)())
        except Exception as e:
            print("  ", "info." + name, type(e).__name__, str(e)[:60])
for path in [b"a/\xff/../b", b"//\x80", b"a\0b/../c"]:
    print(path, os.path.normpath(path), os.path.splitroot(path))
for bad in (1, None, ["a"], bytearray(b"a")):
    for name in ("normpath", "splitroot"):
        try:
            print(name, getattr(os.path, name)(bad))
        except Exception as e:
            print(name, type(e).__name__, e)


class Path:
    def __init__(self, value):
        self.value = value

    def __fspath__(self):
        return self.value


print(ascii(os.path.normpath(Path("a/\udfff/.."))), os.path.normpath(Path(b"a/./b")), ascii(os.path.splitroot(Path("/\ud800"))))
