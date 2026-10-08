declare module 'foo' {
  function foo(namespace: string): void;
  function bar(namespace: string): void;
}

function pickCard(x: {suit: string; card: number; }[]): number;
function pickCard(x: number): {suit: string; card: number; };
