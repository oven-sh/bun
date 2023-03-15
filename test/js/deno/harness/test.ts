import { test as bunTest } from "bun:test";

type Fn = () => void | Promise<unknown>;
type Options = {
  permissions?:
    | "none"
    | {
        net?: boolean;
        read?: boolean;
      };
  ignore?: boolean;
};

export function test(arg0: Fn | Options, arg1?: Fn): void {
  if (typeof arg0 === "function") {
    bunTest(arg0.name, arg0);
  } else if (typeof arg1 === "function") {
    if (
      arg0?.ignore === true ||
      arg0?.permissions === "none" ||
      arg0?.permissions?.net === false ||
      arg0?.permissions?.read === false
    ) {
      bunTest.skip(arg1.name, arg1);
    } else {
      bunTest(arg1.name, arg1);
    }
  } else {
    throw new Error("Unimplemented");
  }
}

test.ignore = (arg0: Fn | Options, arg1?: Fn) => {
  if (typeof arg0 === "function") {
    bunTest.skip(arg0.name, arg0);
  } else if (typeof arg1 === "function") {
    bunTest.skip(arg1.name, arg1);
  } else {
    throw new Error("Unimplemented");
  }
};
