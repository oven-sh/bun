class Bad(Exception):
    def __str__(self): raise RuntimeError("str failed")
print("before")
raise Bad("x")
