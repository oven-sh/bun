import sys
print("before")
def f(): sys.exit()
try: f()
except SystemExit as e: print("caught", repr(e), e.code)
try: sys.exit(None)
except SystemExit as e: print("caught", repr(e), e.code)
try: sys.exit(1, 2)
except TypeError as e: print("TypeError", e)
try: sys.exit((1, 2))
except SystemExit as e: print("caught", repr(e), e.code)
try: raise SystemExit
except BaseException as e: print(type(e).__mro__[1].__name__, e.args)
try:
    try: sys.exit(2)
    except Exception: print("SystemExit is not an Exception")
except SystemExit: print("outer")
sys.exit(None)
