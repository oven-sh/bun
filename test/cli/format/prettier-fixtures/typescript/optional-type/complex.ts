type T = [("a" | "b")?];
type TupleWithOptional = [number, (1 extends 2 ? string[] : number[])?];
