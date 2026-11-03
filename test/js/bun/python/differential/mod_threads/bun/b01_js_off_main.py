import js, threading, time
res = []
arr = js.eval("[1, 2, 3]")
obj = js.eval("({ a: 1, f() { return 2 } })")
def work():
    for name, f in [
        ("call", lambda: js.parseInt("12")), ("getattr", lambda: obj.a), ("setattr", lambda: setattr(obj, "b", 1)),
        ("getitem", lambda: obj["a"]), ("repr", lambda: repr(obj)), ("method", lambda: obj.f()), ("new", lambda: js.Date.new()),
        ("iter", lambda: list(obj)), ("len", lambda: len(obj)),
    ]:
        try: f(); res.append((name, "allowed"))
        except RuntimeError as e: res.append((name, str(e)))
    # What is the same thing in both languages needs no JS to run.
    arr.append(4); res.append(("list", arr, len(arr), "abc".upper(), 2 ** 70))
t = threading.Thread(target=work); t.start(); t.join()
for r in res: print(*r)
print(js.JSON.stringify(arr), obj.a, obj.f())
