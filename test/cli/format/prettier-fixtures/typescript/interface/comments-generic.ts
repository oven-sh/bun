interface ReallyReallyLongName<
  TypeArgumentNumberOne,
  TypeArgumentNumberTwo,
  TypeArgumentNumberThree
> // 1
extends BaseInterface {}

interface ReallyReallyLongName2<
  TypeArgumentNumberOne,
  TypeArgumentNumberTwo,
  TypeArgumentNumberThree
> // 1
// 2
extends BaseInterface {}

interface ReallyReallyLongName3<
  TypeArgumentNumberOne,
  TypeArgumentNumberTwo,
  TypeArgumentNumberThree
> // 1
// 2
extends BaseInterface // 3
{}

interface Foo<
  FOOOOOOOOOOOOOOOOOOOOOOOOOO,
  FOOOOOOOOOOOOOOOOOOOOOOOOOO,
  FOOOOOOOOOOOOOOOOOOOOOOOOOO
> // comments
  extends Foo {}
