export const WrittenByImporter = { a: 1, b: 2 };
export const DefinedByImporter = { a: 1, b: 2 };
export const DefinedInHelper = { a: 1, b: 2 };
export const ListedByImporter = { a: 1, b: 2 };
export const IndexedByImporter = { a: 1, b: 2 };
export function readAll() {
  return [WrittenByImporter.a, DefinedByImporter.a, DefinedInHelper.a, ListedByImporter.a, IndexedByImporter.a].join();
}
