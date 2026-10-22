namespace Tools {
  export function hammer() { return "hammer"; }
  export namespace Inner {
    export function saw() { return "saw, " + teeth(); }
    export function drill() { return "drill"; }
  }
}
function teeth() { return "teeth"; }

export import hammer = Tools.hammer;
export import Nested = Tools.Inner;
