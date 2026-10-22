// A quoted `"constructor"` names the constructor too. TypeScript accepts an accessor of that name, plain Bun rejects it while parsing, so the build stops.
class A { get "constructor"() { return 1; } }
console.log(new A().constructor);
