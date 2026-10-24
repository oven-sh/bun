import "./declarations.ts";

export function limitPlusOne(): number {
  return sharedLimit + 1;
}

export function titleLength(): number {
  return sharedTitle.length;
}

export function pointSum(): number {
  return sharedPoint.x + sharedPoint.y;
}

export function twiceOf(n: number): number {
  return sharedTwice(n);
}
