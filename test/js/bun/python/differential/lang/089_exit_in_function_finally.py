import sys
def f():
    try:
        sys.exit(9)
    finally:
        print("cleanup 1")
def g():
    try: f()
    finally: print("cleanup 2")
class CM:
    def __enter__(self): return self
    def __exit__(self, t, v, tb): print("exit sees", t.__name__, v.code); return False
with CM(): g()
