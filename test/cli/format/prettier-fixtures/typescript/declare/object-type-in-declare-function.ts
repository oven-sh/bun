declare function foo(this: { a: boolean, b: string, c: number }):
  Promise<Array<foo>>

declare function bazFlip({ a: boolean, b: string, c: number }):
  Promise<Array<foo>>

declare function bar(...{ a: boolean, b: string, c: number }):
  Promise<Array<foo>>

declare function bar(...x: { a: boolean, b: string, c: number }):
  Promise<Array<foo>>
