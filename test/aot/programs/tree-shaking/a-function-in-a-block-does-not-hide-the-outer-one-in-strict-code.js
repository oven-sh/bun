// In a module a function declared in a block belongs to the block. The calls outside the blocks mean the functions of the module, which nothing else names.
function first() {
  return "first of the module";
}
function second() {
  return "second of the module";
}
function third() {
  return "third of the module";
}

function caller() {
  const before = first();
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
  return second();
}

function inSwitch(n) {
  switch (n) {
    case 1:
      function third() {
        return "third of the switch";
      }
  }
  return third();
}

console.log(caller());
console.log(inArms(true));
console.log(inSwitch(1));
