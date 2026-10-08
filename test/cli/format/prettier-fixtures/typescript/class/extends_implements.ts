class Class extends AbstractClass implements Interface1, Interface2, Interface3, Interface4 {}

class ExtendsAbstractClassAndImplementsInterfaces1 extends AbstractClass
  implements Interface1, Interface2, Interface3, Interface4 {}

class ExtendsAbstractClassAndImplementsInterfaces2
  extends AAAAAAAAAAAAAAbstractClass
  implements Interface1, Interface2, Interface3, Interface4 {}

class ExtendsAbstractClassAndImplementsInterfaces3
  extends AAAAAAAAAAAAAAbstractClass
  implements
    Interface1,
    Interface2,
    Interface3,
    Interface4,
    Interface5,
    Interface6,
    Interface7,
    Interface8 {}

class ExtendsAbstractClassAndImplementsInterfaces4
  extends AAAAAAAAAAAAAAbstractClass<Type1, Type2, Type3, Type4, Type5, Type6, Type7> {}

class ExtendsAbstractClassAndImplementsInterfaces5
  extends AAAAAAAAAAAAAAbstractClass<Type1, Type2, Type3, Type4, Type5, Type6, Type7>
  implements
    Interface1,
    Interface2,
    Interface3,
    Interface4,
    Interface5,
    Interface6,
    Interface7,
    Interface8 {}

class ImplementsInterfaceAndExtendsAbstractClass1<Foo>
  extends FOOOOOOOOOOOOOOOOO
  implements FOOOOOOOOOOOOOOOOO, BARRRRRRRRRR {}

class Foo<FOOOOOOOOOOOOOOOOOOOOOOOOOOO, FOOOOOOOOOOOOOOOOOOOOOOOOOOO> implements Foo {}
class Foo___<FOOOOOOOOOOOOOOOOOOOOOOOOOOO, FOOOOOOOOOOOOOOOOOOOOOOOOOOO> extends Foo {}
interface Foo<FOOOOOOOOOOOOOOOOOOOOOOOOOOO, FOOOOOOOOOOOOOOOOOOOOOOOOOO> extends Foo {}

class ImplementsInterfaceAndExtendsAbstractClass2<
    TypeArgumentNumberOne,
    TypeArgumentNumberTwo,
    TypeArgumentNumberThree
  >
   extends FOOOOOOOOOOOOOOOOOO implements BaseInterface {}

class ImplementsInterfaceClass1<
    TypeArgumentNumberOne,
    TypeArgumentNumberTwo,
    TypeArgumentNumberThree
  >
    implements BaseInterface {}

class ImplementsInterfaceClassWithComments1<
    TypeArgumentNumberOne,
    TypeArgumentNumberTwo,
    TypeArgumentNumberThree
  > // comments
    implements BaseInterface {}
