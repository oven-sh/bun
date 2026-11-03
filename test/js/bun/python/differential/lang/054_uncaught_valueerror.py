print("before")
def f(): raise ValueError("uncaught message")
f()
print("not reached")
