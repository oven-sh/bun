// Type literal with no quotes needed
type A = {
  a: string;
  b: number;
};

// Type literal with quotes preserved
type B = {
  'b': string;
};

// Type literal with mixed - consistent should quote all
type C = {
  c1: string;
  'c2': number;
};

// Type literal with required quotes - consistent should quote all
type D = {
  d1: string;
  'd-2': number;
};

// Inline type literal in function parameter
function foo(param: { x: string; 'y-z': number }): void {}

// Type literal with method signature
type E = {
  method(): void;
  'method-2'(): string;
};
