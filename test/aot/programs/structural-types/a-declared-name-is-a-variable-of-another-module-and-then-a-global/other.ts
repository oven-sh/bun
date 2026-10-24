const hiddenCount = 5;
let hiddenTitle = "hidden";

function hiddenHelper(n: number): number {
  return n + hiddenCount;
}

class HiddenBox {
  value: number = hiddenCount;
}

export function report(): string {
  return hiddenCount + " " + hiddenTitle + " " + hiddenHelper(1) + " " + new HiddenBox().value;
}

export function rename(title: string): void {
  hiddenTitle = title;
}
