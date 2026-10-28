// young-objects-between-old-ones.ts with every pass verified: the storage of an array is tested in front of a loop, and each turn calls a constructor between that test and the store. The call becomes an allocation and a call of a version of the constructor that the program does not hold yet. The output is that of plain Bun.
import "./young-objects-between-old-ones.ts";
