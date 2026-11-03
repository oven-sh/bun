# python -X dev: names of encodings and of error handlers are looked up even where nothing has a use for them yet.
import subprocess
import sys

program = r"""
import io, sys, _pyio
def t(what, f):
    try:
        f(); print(what, "fine")
    except Exception as e:
        print(what, type(e).__name__, e)
name = sys.argv[1]
for module in (io, _pyio):
    t("open encoding", lambda: module.open(name, encoding="invalid").close())
    t("open errors", lambda: module.open(name, errors="invalid").close())
    t("open both fine", lambda: module.open(name, encoding="latin-1", errors="namereplace").close())
    with module.open(name, "rb") as f:
        t("wrapper encoding", lambda: module.TextIOWrapper(f, encoding="invalid").detach())
        t("wrapper errors", lambda: module.TextIOWrapper(f, errors="invalid").detach())
        t("wrapper errors of the wrong type", lambda: module.TextIOWrapper(f, errors=1).detach())
        t("wrapper errors with a null", lambda: module.TextIOWrapper(f, errors="a\0b").detach())
        w = module.TextIOWrapper(f, encoding="utf-8")
        t("reconfigure errors", lambda: w.reconfigure(errors="invalid"))
        t("reconfigure encoding", lambda: w.reconfigure(encoding="invalid"))
        w.detach()
t("str.encode", lambda: "".encode("invalid"))
t("str.encode errors", lambda: "".encode("utf-8", "invalid"))
t("bytes.decode", lambda: b"".decode("invalid"))
t("bytes.decode errors", lambda: b"".decode("utf-8", "invalid"))
t("bytearray.decode errors", lambda: bytearray().decode("utf-8", "invalid"))
t("str()", lambda: str(b"", "utf-8", "invalid"))
t("bytes()", lambda: bytes("", "utf-8", "invalid"))
"""
for options in ([], ["-X", "dev"]):
    result = subprocess.run([sys.executable, "-I", "-W", "ignore", *options, "-c", program, __file__], capture_output=True, text=True)
    print("==", options, result.returncode)
    print(result.stdout, end="")
    print(result.stderr[-300:], end="")
