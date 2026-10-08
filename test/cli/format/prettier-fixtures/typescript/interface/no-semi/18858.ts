export interface MyInterface {
  someMethod: (a: number) => Promise<number>
  (a: string): Promise<string>
}

export type MyType = {
  someMethod: (a: number) => Promise<number>
  (a: string): Promise<string>
}

interface I1 {
  prop: string;
  ():string
}
type T1 ={
  prop: string;
  ():string
}

interface I2 {
  prop;
  ():string
}
type T2 ={
  prop;
  ():string
}

interface I3 {
  prop: Foo;
  <T>():string
}
type T3 ={
  prop: Foo;
  <T>():string
}
