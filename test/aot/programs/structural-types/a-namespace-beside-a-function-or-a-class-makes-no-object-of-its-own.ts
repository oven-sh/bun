// A namespace beside a function or a class of its name adds members to that function or class: the name goes on holding the function, and no other object is ever stored to it.
// IR= 0 loopMerged L\d+\|f\d+ = GetModuleVariable
// IR= 0 loopMerged = Call .*calleeName="Tool"

function Tool(n: number): number {
  return n + 1;
}
namespace Tool {
  export const version = 3;
  export function twice(n: number): number {
    return n * 2;
  }
}
namespace Tool {
  export const later = version + 1;
}

class Kit {
  static made = 0;
  constructor(public size: number) {
    Kit.made++;
  }
}
namespace Kit {
  export const version = 4;
  export function twice(n: number): number {
    return n * 2;
  }
}

// This one is stored to, so its name may hold anything when the block of the namespace runs.
function Cleared(): string {
  return "function";
}
(Cleared as any) = undefined;
namespace Cleared {
  export const kind = "object";
}

namespace Outer {
  export function inner(): number {
    return 5;
  }
  export namespace inner {
    export const extra = 6;
  }
  function hidden(): number {
    return 7;
  }
  namespace hidden {
    export const extra = 8;
  }
  export const sum = inner() + inner.extra + hidden() + hidden.extra;
}

function early(): string {
  return typeof Late + " " + String(Late.value);
}
const seenEarly = early();
function Late(): void {}
namespace Late {
  export const value = 9;
}

function loopMerged(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum = (sum + Tool(Tool.twice(i & 7) + Tool.version)) | 0;
  return sum;
}

function loopClass(rounds: number): number {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum = (sum + Kit.twice(i & 7) + Kit.version) | 0;
  return sum + new Kit(2).size;
}

console.log(loopMerged(100), loopClass(100));
console.log(typeof Tool, Tool.name, Tool.length, Object.keys(Tool).join(), Tool.later);
console.log(typeof Kit, Kit.name, Kit.made, Object.keys(Kit).join(), new Kit(1) instanceof Kit);
console.log(typeof Cleared, Object.keys(Cleared).join(), Cleared.kind);
console.log(Outer.sum, typeof Outer.inner, Object.keys(Outer.inner).join(), Object.keys(Outer).join());
console.log(seenEarly, "|", early());
