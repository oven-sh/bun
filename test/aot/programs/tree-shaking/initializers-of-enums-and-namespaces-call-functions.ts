// An enum member's initializer and the statements of a namespace run when the module does. They hold the only references to these functions.
function width() { return 4; }
function height() { return 3; }
function label() { return "label".length; }
function setUp() { return "set up"; }
function logged(text: string) { console.log("namespace body: " + text); return text; }

enum Size {
  Width = width(),
  Height = height(),
  Area = Width * Height,
  Text = label(),
}

namespace State {
  export const value = setUp();
  logged(value);
  export namespace Deep {
    export const inner = logged("deep");
  }
}

console.log(Size.Width, Size.Height, Size.Area, Size.Text, Size[4]);
console.log(State.value, State.Deep.inner);
