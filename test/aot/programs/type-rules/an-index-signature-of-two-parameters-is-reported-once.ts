// Plain Bun rejects the file while parsing, in five places. TypeScript reports the mistake, and the build says no more of the file.
class Table {
  [key: string, other: string]: number;
}
console.log(typeof Table);
export {};
