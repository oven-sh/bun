# An assignment to __bases__ that fails gives the old bases back, unless they would then lead from the class to itself. Here an old base has come under the class only by the bases that an outer
# assignment has given for the time being, and that one is taken back in its turn. The class is left with the new bases and its old MRO. (No oracle: CPython gives the bases back.)
acts = {}
class Meta(type):
    def mro(cls):
        act = acts.pop(cls.__name__, None)
        if act:
            act()
        return type.mro(cls)


def names(classes):
    return [c.__name__ for c in classes]


def attempt(f):
    try:
        f()
        return 'ok'
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


def run(new_bases):
    class Base(metaclass=Meta): pass
    class Old(Base): pass
    class New(Base): pass
    class T(Old): pass
    class P(Base): pass
    def show():
        for c in (Base, Old, New, T, P):
            print('   ', c.__name__, names(c.__bases__), names(c.__mro__), names(c.__subclasses__()))
        print('    T.w:', getattr(T, 'w', 'none'), '| P.w:', getattr(P, 'w', 'none'))
    log = []
    def in_mro_of_T():
        log.append('P.__bases__ = (T,): ' + attempt(lambda: setattr(P, '__bases__', (T,))))
        raise ValueError('the mro() of T')
    def in_mro_of_Old():
        acts['T'] = in_mro_of_T
        log.append('T.__bases__ = ...: ' + attempt(lambda: setattr(T, '__bases__', new_bases(New))))
        raise ValueError('the mro() of Old')
    acts['Old'] = in_mro_of_Old
    log.append('Old.__bases__ = (P,): ' + attempt(lambda: setattr(Old, '__bases__', (P,))))
    print(log)
    show()
    # It is told by the classes of the MRO that it has.
    New.w = 'new'
    Old.w = 'old'
    print('    T.w:', T.w, '| P.w:', P.w)
    Old.w = 'old again'
    print('    T.w:', T.w, '| P.w:', P.w)
    print('an assignment whose walk comes to T:', attempt(lambda: setattr(New, '__bases__', (Base,))))
    show()
    print('T is given bases:', attempt(lambda: setattr(T, '__bases__', (New,))))
    show()
    New.w = 'new again'
    print('    T.w:', T.w, '| P.w:', P.w)


print('--- bases that have an MRO')
run(lambda New: (New,))
print('--- bases that have none')
run(lambda New: (New, New))
