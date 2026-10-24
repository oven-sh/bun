// A CommonJS module may return at its top level. The functions declared below the return are hoisted; one of them is called above it and names the others.
console.log(first());
return;

function first() {
  return "first, " + second();
}

function second() {
  return "second, " + third();
}

class Unreached {}

function third() {
  return "third";
}
