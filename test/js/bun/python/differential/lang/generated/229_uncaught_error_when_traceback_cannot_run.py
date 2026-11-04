# An uncaught AttributeError when traceback.py cannot run: what prints it instead looks for a similar name as well.
import builtins

def other(*a, **k):
    pass
inst = other
builtins.len = 0
print("before", flush=True)
callee = inst.meth
