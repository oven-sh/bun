# test_descr.ClassPropertiesAndMethods.test_altmro: an mro() that does not start with the class
class M(type):
    def mro(cls):
        return type.mro(cls)[::-1]
class X(metaclass=M):
    pass
print(X.__mro__)
print(type(X()).__name__)
