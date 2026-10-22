export function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

export function kinds(numbers: number[]): string {
  return Array.from(numbers, n => typeof n).join();
}

export function missing(numbers: number[]): number {
  return numbers.findIndex(n => n === undefined);
}

export function isMissing(n: number): boolean {
  return n === undefined;
}

export function widths(strings: string[]): number {
  let total = 0;
  for (let i = 0; i < strings.length; i++) total += strings[i].length;
  return total;
}

export function use(entry: [number, string]): string {
  const [count, name] = entry;
  return typeof count + " " + typeof name + " " + String(count + 1) + " " + name + "!";
}

export function shout(entry: [number, string]): string {
  return entry[1].toUpperCase();
}
