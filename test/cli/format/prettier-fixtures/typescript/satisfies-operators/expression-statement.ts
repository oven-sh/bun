
let type: 'foo' | 'bar' = 'foo';

// demonstrating how "satisfies" expression can be practically used as expression statement.
const _ = () => {
switch (type) {
  case 'foo':
    return 1;
  case 'bar':
    return 2;
  default:
    // exhaustiveness check idiom
    (type) satisfies never;
    throw new Error('unreachable');
}
}

function needParens() {
(let) satisfies unknown;
(interface) satisfies unknown;
(module) satisfies unknown;
(using) satisfies unknown;
(yield) satisfies unknown;
(await) satisfies unknown;
}

function noNeedParens() {
async satisfies unknown;
satisfies satisfies unknown;
as satisfies unknown;

abc satisfies unknown; // not a keyword
}

function satisfiesChain() {
satisfies satisfies satisfies satisfies satisfies;
(type) satisfies never satisfies unknown;
}
