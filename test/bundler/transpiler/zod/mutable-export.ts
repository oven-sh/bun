// Helper for diff-fixture.ts: an exported let that gets reassigned after the
// importer builds its schemas, exercising the live-binding bail.
export let importedLimit = 1;
export function bumpImportedLimit() {
  importedLimit = 2;
}
