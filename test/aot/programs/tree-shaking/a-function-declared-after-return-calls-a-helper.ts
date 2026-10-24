// inner is declared below the `return` of outer, in code that never runs as statements, yet it is hoisted and called. helper is named only inside inner. The same below a throw, a break and a continue.
function helper(): string {
  return "helper";
}
function outer(): string {
  return inner();
  function inner(): string {
    return "inner, " + helper();
  }
}

function helperBelowThrow(): string {
  return "helper below throw";
}
function thrower(): string {
  try {
    throw inner();
    function inner(): string {
      return helperBelowThrow();
    }
  } catch (thrown) {
    return String(thrown);
  }
}

function helperBelowBreak(): string {
  return "helper below break";
}
function helperBelowContinue(): string {
  return "helper below continue";
}
function looper(): string {
  const parts: string[] = [];
  for (let i = 0; i < 1; i++) {
    parts.push(second());
    continue;
    function second(): string {
      return helperBelowContinue();
    }
  }
  while (true) {
    parts.push(first());
    break;
    function first(): string {
      return helperBelowBreak();
    }
  }
  return parts.join(", ");
}

console.log(outer());
console.log(thrower());
console.log(looper());
