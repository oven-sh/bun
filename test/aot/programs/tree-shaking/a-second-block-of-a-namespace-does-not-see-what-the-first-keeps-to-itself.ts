// Two blocks of one namespace share what they export and nothing else. `hidden()` in the second block is the function of the module; `shared()` is the one the first block exports.
function hidden() {
  return "hidden of the module";
}
function shared() {
  return "shared of the module";
}

namespace Parts {
  function hidden() {
    return "hidden of the first block";
  }
  export function shared() {
    return "shared of the first block, " + hidden();
  }
}
namespace Parts {
  export const fromSecondBlock = hidden() + " / " + shared();
}

console.log(Parts.fromSecondBlock);
console.log(shared());
