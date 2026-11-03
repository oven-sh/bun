# no functions in the way: plain objects of a class from another module
import collections, sys, types
m = types.ModuleType("helper")
exec("class A:\n    def __init__(self, n): self.n = n\n    def __del__(self): print('del', self.n)\n", m.__dict__)
x = m.A("x"); y = m.A("y"); z = [m.A("in list 1"), m.A("in list 2")]; d = {"k1": m.A("in dict 1"), "k2": m.A("in dict 2")}
_private = m.A("_private")
print("end")
