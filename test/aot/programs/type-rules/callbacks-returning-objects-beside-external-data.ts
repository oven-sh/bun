// A callback that gets untrusted elements and returns an object literal still makes the object of the type that is expected where the callback stands; only primitive results are left unasserted.
type Source = "built-in" | "plugin" | "file";
type Row = { readonly name: string; readonly source: Source };
const parsed = JSON.parse('{"names":["a","b"],"sources":["file","plugin"]}') as { names: string[]; sources: Source[] };
function report(rows: ReadonlyArray<Row>): string { let text = ""; for (const { name, source } of rows) text += name + ":" + source + " "; return text; }
function rowsOfNames(): Row[] { const names = ["x", ...parsed.names]; return names.map(name => ({ name, source: "file" })); }
function rowsOfSources(): Row[] { const sources = ["built-in" as Source, ...parsed.sources]; return sources.map(source => ({ name: "n", source })); }
function atOnce(): Row { const name = parsed.names[0]; const row: Row = (() => ({ name, source: "plugin" }))(); return row; }
console.log(report(rowsOfNames()), report(rowsOfSources()), report([atOnce()]));
