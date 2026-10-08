type TupleWithRest = [number, ...(1 extends 2 ? string[] : number[])];
