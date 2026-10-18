export function probe(seen) {
  return Object.keys(seen).join() + "|" + ("z" in seen) + "|" + typeof seen.viaImport;
}
