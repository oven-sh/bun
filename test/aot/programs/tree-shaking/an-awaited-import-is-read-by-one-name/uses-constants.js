const table = { key: "a constant of the file" };
const unused = { key: "unused" };
export function read() { return table.key; }
export const notRead = "not read";
