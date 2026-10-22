namespace Steps {
  export enum Mode {
    First,
  }
  export function lateMode(): number {
    return Mode.Second;
  }
  export const atStart: number = lateMode();
}

console.log("the first block saw " + Steps.atStart);
console.log("between the blocks " + Steps.Mode.Second);

namespace Steps {
  export enum Mode {
    Second = 5,
  }
}

console.log("after both " + Steps.lateMode());
