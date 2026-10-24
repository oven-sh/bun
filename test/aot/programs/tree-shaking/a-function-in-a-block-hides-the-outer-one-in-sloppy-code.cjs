// The same text in a CommonJS file: there the function in the block is also a variable of the function around it, undefined until the block has run. The functions of the module are not what these calls mean. Plain Bun keeps the function inside its block here too, so the output is stored.
function first() {
  return "first of the module";
}
function second() {
  return "second of the module";
}

function caller() {
  let before;
  try {
    before = first();
  } catch (error) {
    before = error.constructor.name;
  }
  {
    function first() {
      return "first of the block";
    }
  }
  return before + " / " + first();
}

function inArms(flag) {
  if (flag) {
    function second() {
      return "second of the arm";
    }
  }
  return typeof second === "function" ? second() : typeof second;
}

console.log(caller());
console.log(inArms(true), inArms(false));
console.log(first(), second());
