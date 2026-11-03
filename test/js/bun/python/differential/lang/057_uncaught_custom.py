class Outer:
    class MyError(Exception):
        def __str__(self): return "custom str: " + repr(self.args)
print("before")
raise Outer.MyError(1, "two")
