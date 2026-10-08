export interface Environment1 extends GenericEnvironment<
  SomeType,
  AnotherType,
  YetAnotherType,
> {
  m(): void;
};
export class Environment1____ extends GenericEnvironment<
  SomeType,
  AnotherType,
  YetAnotherType,
> {
  m(): void;
};
export class Environment2 extends GenericEnvironment<
  SomeType,
  AnotherType,
  YetAnotherType,
  DifferentType1,
  DifferentType2,
  DifferentType3,
  DifferentType4,
> {
  m() {};
};

// Declare Interface Break
declare interface ExtendsOne extends ASingleInterface {
  x: string;
}

declare interface ExtendsLarge extends ASingleInterfaceWithAReallyReallyReallyReallyLongName {
  x: string;
}
declare class ExtendsLarge____ extends ASingleInterfaceWithAReallyReallyReallyReallyLongName {
  x: string;
}

declare interface ExtendsMany extends Interface1, Interface2, Interface3, Interface4, Interface5, Interface6, Interface7 {
  x: string;
}

// Interface declaration break
interface ExtendsOne extends ASingleInterface {
  x: string;
}

interface ExtendsLarge extends ASingleInterfaceWithAReallyReallyReallyReallyLongName {
  x: string;
}
class ExtendsLarge____ extends ASingleInterfaceWithAReallyReallyReallyReallyLongName {
  x: string;
}

interface ExtendsMany extends Interface1, Interface2, Interface3, Interface4, Interface5, Interface6, Interface7 {
  s: string;
}

// Generic Types
interface ExtendsOne extends ASingleInterface<string> {
  x: string;
}

interface ExtendsLarge extends ASingleInterfaceWithAReallyReallyReallyReallyLongName<string> {
  x: string;
}
class ExtendsLarge____ extends ASingleInterfaceWithAReallyReallyReallyReallyLongName<string> {
  x: string;
}

interface ExtendsMany
  extends ASingleGenericInterface<Interface1, Interface2, Interface3, Interface4, Interface5, Interface6, Interface7> {
  x: string;
}
class ExtendsMany____
  extends ASingleGenericInterface<Interface1, Interface2, Interface3, Interface4, Interface5, Interface6, Interface7> {
  x: string;
}

interface ExtendsManyWithGenerics
  extends InterfaceOne, InterfaceTwo, ASingleGenericInterface<Interface1, Interface2, Interface3, Interface4, Interface5, Interface6, Interface7>, InterfaceThree {

    x: string;
  }

export interface ExtendsLongOneWithGenerics extends Bar< SomeLongTypeSomeLongTypeSomeLongTypeSomeLongType,  ToBreakLineToBreakLineToBreakLine> {}
export class ExtendsLongOneWithGenerics____ extends Bar< SomeLongTypeSomeLongTypeSomeLongTypeSomeLongType,  ToBreakLineToBreakLineToBreakLine> {}
