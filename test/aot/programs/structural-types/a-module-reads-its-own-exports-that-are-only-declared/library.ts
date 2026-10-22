export declare const limit: number;
export declare let title: string;
export declare function twice(n: number): number;
export declare class Box {
  value: number;
}

export function kinds(): string[] {
  return [typeof limit, typeof title, typeof twice, typeof Box];
}

export function limitPlusOne(): number {
  return limit + 1;
}

export function titleLength(): number {
  return title.length;
}

export function twiceOf(n: number): number {
  return twice(n);
}

export function makeBox(): Box {
  return new Box();
}

export function setTitle(text: string): void {
  title = text;
}
