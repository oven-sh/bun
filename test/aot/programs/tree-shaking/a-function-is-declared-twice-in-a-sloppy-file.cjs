// In a CommonJS file a function may be declared twice, and the last declaration is the one that counts. Each names a helper of its own.
function helperOfFirst() {
  return "helper of the first";
}
function helperOfLast() {
  return "helper of the last";
}

console.log(twice());

function twice() {
  return helperOfFirst();
}

function twice() {
  return helperOfLast();
}

console.log(twice());

function nested() {
  return inner();
  function inner() {
    return "first inner";
  }
  function inner() {
    return "last inner";
  }
}
console.log(nested());
