class A {
  n = 1;
  who(): string {
    return "A";
  }
}

class B {
  n = 2;
  who(): string {
    return "B";
  }
}

function who(a: A): string {
  return a.who() + a.n + (a instanceof A);
}

console.log(who(new A()));
console.log(who(new B()));
console.log(who(new A()));

export {};
