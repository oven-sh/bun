function answers(isNumber: boolean, isObject: boolean, isString: boolean, isUndefined: boolean): string {
  return (isNumber ? "number " : "") + (isObject ? "object " : "") + (isString ? "string " : "") + (isUndefined ? "undefined " : "") + "|";
}

function byAnArrow(x: number): string {
  const test = (): string => answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined);
  return test();
}

function byADeclaration(x: number): string {
  function test(): string {
    return answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined);
  }
  return test();
}

function byAnExpression(x: number): string {
  const test = function (): string {
    return answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined);
  };
  return test();
}

function twoLevelsDeep(x: number): string {
  return (() => (() => answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined))())();
}

function byAMethodOfALiteral(x: number): string {
  const tester = {
    test(): string {
      return answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined);
    },
  };
  return tester.test();
}

function byAMethodOfAClass(x: number): string {
  class Tester {
    test(): string {
      return answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined);
    }
  }
  return new Tester().test();
}

function byAGetter(x: number): string {
  const tester = {
    get result(): string {
      return answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined);
    },
  };
  return tester.result;
}

function byAFieldInitializer(x: number): string {
  class Tester {
    result = answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined);
  }
  return new Tester().result;
}

function byADefaultValue(x: number, result: string = answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined)): string {
  return result;
}

function byAGenerator(x: number): string {
  function* test(): Generator<string> {
    yield answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined);
  }
  return [...test()].join();
}

async function byAnAsyncArrow(x: number): Promise<string> {
  const test = async (): Promise<string> => answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined);
  return await test();
}

async function afterAnAwait(x: number): Promise<string> {
  await null;
  return answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined);
}

function byACallbackOfABuiltIn(x: number): string {
  return [0].map(() => answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined)).join();
}

function keptForLater(x: number): () => string {
  return () => answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined);
}

function inPlace(x: number): string {
  return answers(typeof x === "number", typeof x === "object", typeof x === "string", x === undefined);
}

const list: number[] = [1, 0.5];
const wide: unknown[] = list;
wide.push({}, "text", undefined, null);
const labels = ["an integer", "a fraction", "an object", "a text", "undefined", "null", "past the end"];

for (let i = 0; i < labels.length; i++) {
  const x = list[i];
  console.log(labels[i]);
  console.log("  in place " + inPlace(x));
  console.log("  an arrow " + byAnArrow(x));
  console.log("  a declaration " + byADeclaration(x));
  console.log("  an expression " + byAnExpression(x));
  console.log("  two levels deep " + twoLevelsDeep(x));
  console.log("  a method of a literal " + byAMethodOfALiteral(x));
  console.log("  a method of a class " + byAMethodOfAClass(x));
  console.log("  a getter " + byAGetter(x));
  console.log("  a field initializer " + byAFieldInitializer(x));
  console.log("  a default value " + byADefaultValue(x));
  console.log("  a generator " + byAGenerator(x));
  console.log("  an async arrow " + (await byAnAsyncArrow(x)));
  console.log("  after an await " + (await afterAnAwait(x)));
  console.log("  a callback of a built-in " + byACallbackOfABuiltIn(x));
  console.log("  kept for later " + keptForLater(x)());
}

export {};
