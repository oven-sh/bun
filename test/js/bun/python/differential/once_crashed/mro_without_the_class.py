# test_descr.MroTest.test_disappearing_custom_mro: an mro() that leaves out the class and its bases must be a TypeError
class B:
    pass
class M(type):
    def mro(cls):
        return (B,)
try:
    class A(metaclass=M):
        pass
except TypeError as e:
    print("TypeError", e)
