const assertString = (x: any): asserts x => {
  console.assert(typeof x === 'string');
}

function assertsString(x: any): asserts x {
  console.assert(typeof x === 'string');
}

const assertStringWithGuard = (x: any): asserts x is string => {
  console.assert(typeof x === 'string');
}

function assertsStringWithGuard(x: any): asserts x is string {
  console.assert(typeof x === 'string');
}

interface AssertFoo {
  isString(node: any): asserts node;
}

class AssertsFoo {
  isBar(): asserts this {
    return;
  }
  isBaz = (): asserts this => {
    return;
  }
}