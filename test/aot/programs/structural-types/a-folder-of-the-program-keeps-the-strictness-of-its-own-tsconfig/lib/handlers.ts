export interface Animal {
  name: string;
}
export interface Dog extends Animal {
  bark: number;
}
export type Handler = (animal: Animal) => number;
export const handler: Handler = (dog: Dog) => dog.bark;
export function handle(animal: Animal): number {
  return handler(animal);
}
