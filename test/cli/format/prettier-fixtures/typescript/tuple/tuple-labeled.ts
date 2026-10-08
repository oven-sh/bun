// https://github.com/babel/babel/pull/11754

type T = [x: A, y?: B, ...z: C];

type T = [A, y: B];

let x: [A: string, ...B: number[]]

type T = [foo: string, bar?: number];

type T = [x?: A, y?: B];

type T = [x: A, ...B];

type T = [...B, x: A];
