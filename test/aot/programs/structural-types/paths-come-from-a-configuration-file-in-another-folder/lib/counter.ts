console.log("counter ran");

export let count = 0;

export function bump(): number {
  return ++count;
}

export class Token {
  id = bump();
}
