import { early } from "./paint.ts";

export enum Color {
  Red,
  Green = 5,
  Blue,
}
export enum Word {
  Yes = "yes",
  No = "no",
}
export const sawEarly: string = early;
