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

const a: A = new B();
console.log(a.who());
console.log(a.n);
console.log(a instanceof A);
console.log(a instanceof B);
console.log(a.constructor === B);
console.log(a.constructor.name);

export {};
