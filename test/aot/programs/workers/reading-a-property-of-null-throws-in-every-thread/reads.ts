export class Link {
  value: number;
  next: Link | null;
  constructor(value: number, next: Link | null) {
    this.value = value;
    this.next = next;
  }
}

function sum(depth: number): number {
  return depth === 0 ? 0 : depth + sum(depth - 1);
}

function readInLeaf(link: Link): number {
  return link.value;
}

function readFieldInLeaf(link: Link): number {
  return link.next!.value;
}

function storeInLeaf(link: Link, value: number): number {
  link.value = value;
  return value;
}

function readWithFrame(link: Link): number {
  const before = sum(3);
  const value = link.value;
  return before + value + sum(4);
}

function readInLoop(link: Link): number {
  let total = 0;
  for (let i = 0; i < 3; i++) total += readInLeaf(link) + link.value;
  return total;
}

function catchOwnRead(link: Link, a: number): string {
  let total = a * 3;
  try {
    total += sum(a);
    total += link.value;
    total += sum(a);
  } catch (error) {
    return (error as Error).name + " " + total;
  }
  return "no error " + total;
}

function nameOf(error: unknown): string {
  return (error as Error).name;
}

function readEveryWay(link: Link): string {
  const results: string[] = [];
  try {
    results.push(String(readInLeaf(link)));
  } catch (error) {
    results.push(nameOf(error));
  }
  try {
    results.push(String(readFieldInLeaf(link)));
  } catch (error) {
    results.push(nameOf(error));
  }
  try {
    results.push(String(storeInLeaf(link, 4)));
  } catch (error) {
    results.push(nameOf(error));
  }
  try {
    results.push(String(readWithFrame(link)));
  } catch (error) {
    results.push(nameOf(error));
  }
  try {
    results.push(String(readInLoop(link)));
  } catch (error) {
    results.push(nameOf(error));
  }
  results.push(catchOwnRead(link, 2));
  return results.join(", ");
}

export function readThroughNothing(): string {
  const results = [readEveryWay(new Link(1, new Link(2, null))), readEveryWay(new Link(3, null))];
  for (const nothing of [null, undefined]) results.push(readEveryWay(nothing as unknown as Link));
  return results.join("; ");
}
