// Interface with no quotes needed
interface A {
  a: string;
  b: number;
}

// Interface with quotes preserved
interface B {
  'b': string;
}

// Interface with mixed - consistent should quote all
interface C {
  c1: string;
  'c2': number;
}

// Interface with required quotes - consistent should quote all
interface D {
  d1: string;
  'd-2': number;
}

// Interface extending another
interface E extends D {
  e1: string;
  'e-2': boolean;
}
