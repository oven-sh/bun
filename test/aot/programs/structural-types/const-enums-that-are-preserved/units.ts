export const enum Unit {
  Byte = 1,
  Kilo = 1024,
  Mega = Kilo * Kilo,
  Giga = Mega * Kilo,
  Tera = Giga * Kilo,
}

export const enum Name {
  Byte = "B",
  Kilo = "KB",
}

export enum Plain {
  One = Unit.Byte,
  Thousand = Unit.Kilo,
  Huge = Unit.Tera,
}
