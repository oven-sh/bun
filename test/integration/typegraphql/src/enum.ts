import { registerEnumType } from "type-graphql";

export enum Enum1 {
  A = "A",
  B = "B",
}
registerEnumType(Enum1, { name: "Enum1" });
export enum Enum2 {
  C = "C",
  D = "D",
}
registerEnumType(Enum2, { name: "Enum2" });
