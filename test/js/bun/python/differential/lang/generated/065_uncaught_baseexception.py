class Stop(BaseException): pass
print("before")
try:
    raise Stop("not an Exception")
except Exception:
    print("not caught here")
finally:
    print("finally runs")
