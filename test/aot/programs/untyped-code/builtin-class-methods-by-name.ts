
function show(v: any): string {
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "function") return "function";
    if (typeof v !== "object") return String(v);
    if (Array.isArray(v)) return "[" + Array.prototype.map.call(v, show).join(",") + "]" + (Object.getPrototypeOf(v) === Array.prototype ? "" : "^");
    if (v instanceof Map) return "Map(" + Map.prototype.entries.call(v).toArray().map(show).join(",") + ")";
    if (v instanceof Set) return "Set(" + Set.prototype.values.call(v).toArray().map(show).join(",") + ")";
    if (typeof v.next === "function") return "iterator(" + [...v].map(show).join(",") + ")";
    return Object.prototype.toString.call(v);
}
function thrown(e: any): string { return "throws " + (e instanceof Error ? e.constructor.name : show(e)); }
class ArrayHeir extends Array<any> { }
const key = { };
let notes = 0;
function noted(v: any): any { notes++; return v; }
const lines: string[] = [];
function withOwn(x: any, name: string): any { if (typeof x === "object") x[name] = function (this: any, ...all: any[]) { return "its own " + name + " of " + all.length; }; return x; }
function withOtherPrototype(x: any, name: string): any { if (typeof x !== "object") return x; const p = Object.create(Object.getPrototypeOf(x)); p[name] = () => "of another prototype"; Object.setPrototypeOf(x, p); return x; }
function withGetter(x: any, name: string): any { if (typeof x === "object") Object.defineProperty(x, name, { get() { notes += 10; return () => "from a getter"; } }); return x; }
function stranger(name: string): any { return { [name](...all: any[]) { return "a stranger's " + name + " of " + all.length; } }; }
function attempt(label: string, f: (x: any) => any, x: any): void { try { lines.push(label + ": " + show(f(x))); } catch (e) { lines.push(label + ": " + thrown(e)); } }

function callString_padStart(x: any): any { const r = x.padStart(5, "*"); return r; }
function callString_padStartWatched(x: any): any { try { const r = x.padStart(5, "*"); return [r]; } catch (e) { return thrown(e); } }
function callString_padEnd(x: any): any { const r = x.padEnd(5, "*"); return r; }
function callString_padEndWatched(x: any): any { try { const r = x.padEnd(5, "*"); return [r]; } catch (e) { return thrown(e); } }
function callString_repeat(x: any): any { const r = x.repeat(2); return r; }
function callString_repeatWatched(x: any): any { try { const r = x.repeat(2); return [r]; } catch (e) { return thrown(e); } }
function callString_localeCompare(x: any): any { const r = x.localeCompare("b"); return r; }
function callString_localeCompareWatched(x: any): any { try { const r = x.localeCompare("b"); return [r]; } catch (e) { return thrown(e); } }
function callString_normalize(x: any): any { const r = x.normalize(); return r; }
function callString_normalizeWatched(x: any): any { try { const r = x.normalize(); return [r]; } catch (e) { return thrown(e); } }
function callString_at(x: any): any { const r = x.at(-1); return r; }
function callString_atWatched(x: any): any { try { const r = x.at(-1); return [r]; } catch (e) { return thrown(e); } }
function callString_codePointAt(x: any): any { const r = x.codePointAt(0); return r; }
function callString_codePointAtWatched(x: any): any { try { const r = x.codePointAt(0); return [r]; } catch (e) { return thrown(e); } }
function callString_charAt(x: any): any { const r = x.charAt(1); return r; }
function callString_charAtWatched(x: any): any { try { const r = x.charAt(1); return [r]; } catch (e) { return thrown(e); } }
function callString_charCodeAt(x: any): any { const r = x.charCodeAt(1); return r; }
function callString_charCodeAtWatched(x: any): any { try { const r = x.charCodeAt(1); return [r]; } catch (e) { return thrown(e); } }
function callString_concat(x: any): any { const r = x.concat("z"); return r; }
function callString_concatWatched(x: any): any { try { const r = x.concat("z"); return [r]; } catch (e) { return thrown(e); } }
function callString_endsWith(x: any): any { const r = x.endsWith("c"); return r; }
function callString_endsWithWatched(x: any): any { try { const r = x.endsWith("c"); return [r]; } catch (e) { return thrown(e); } }
function callString_startsWith(x: any): any { const r = x.startsWith("a"); return r; }
function callString_startsWithWatched(x: any): any { try { const r = x.startsWith("a"); return [r]; } catch (e) { return thrown(e); } }
function callString_includes(x: any): any { const r = x.includes("b"); return r; }
function callString_includesWatched(x: any): any { try { const r = x.includes("b"); return [r]; } catch (e) { return thrown(e); } }
function callString_indexOf(x: any): any { const r = x.indexOf("b"); return r; }
function callString_indexOfWatched(x: any): any { try { const r = x.indexOf("b"); return [r]; } catch (e) { return thrown(e); } }
function callString_lastIndexOf(x: any): any { const r = x.lastIndexOf("b"); return r; }
function callString_lastIndexOfWatched(x: any): any { try { const r = x.lastIndexOf("b"); return [r]; } catch (e) { return thrown(e); } }
function callString_match(x: any): any { const r = x.match(/b/); return r; }
function callString_matchWatched(x: any): any { try { const r = x.match(/b/); return [r]; } catch (e) { return thrown(e); } }
function callString_search(x: any): any { const r = x.search(/b/); return r; }
function callString_searchWatched(x: any): any { try { const r = x.search(/b/); return [r]; } catch (e) { return thrown(e); } }
function callString_replace(x: any): any { const r = x.replace("b", "x"); return r; }
function callString_replaceWatched(x: any): any { try { const r = x.replace("b", "x"); return [r]; } catch (e) { return thrown(e); } }
function callString_replaceAll(x: any): any { const r = x.replaceAll("b", "x"); return r; }
function callString_replaceAllWatched(x: any): any { try { const r = x.replaceAll("b", "x"); return [r]; } catch (e) { return thrown(e); } }
function callString_slice(x: any): any { const r = x.slice(1); return r; }
function callString_sliceWatched(x: any): any { try { const r = x.slice(1); return [r]; } catch (e) { return thrown(e); } }
function callString_split(x: any): any { const r = x.split("b"); return r; }
function callString_splitWatched(x: any): any { try { const r = x.split("b"); return [r]; } catch (e) { return thrown(e); } }
function callString_substring(x: any): any { const r = x.substring(1); return r; }
function callString_substringWatched(x: any): any { try { const r = x.substring(1); return [r]; } catch (e) { return thrown(e); } }
function callString_toLowerCase(x: any): any { const r = x.toLowerCase(); return r; }
function callString_toLowerCaseWatched(x: any): any { try { const r = x.toLowerCase(); return [r]; } catch (e) { return thrown(e); } }
function callString_toUpperCase(x: any): any { const r = x.toUpperCase(); return r; }
function callString_toUpperCaseWatched(x: any): any { try { const r = x.toUpperCase(); return [r]; } catch (e) { return thrown(e); } }
function callString_trim(x: any): any { const r = x.trim(); return r; }
function callString_trimWatched(x: any): any { try { const r = x.trim(); return [r]; } catch (e) { return thrown(e); } }
function callString_trimStart(x: any): any { const r = x.trimStart(); return r; }
function callString_trimStartWatched(x: any): any { try { const r = x.trimStart(); return [r]; } catch (e) { return thrown(e); } }
function callString_trimEnd(x: any): any { const r = x.trimEnd(); return r; }
function callString_trimEndWatched(x: any): any { try { const r = x.trimEnd(); return [r]; } catch (e) { return thrown(e); } }
function callString_toString(x: any): any { const r = x.toString(); return r; }
function callString_toStringWatched(x: any): any { try { const r = x.toString(); return [r]; } catch (e) { return thrown(e); } }
function callString_valueOf(x: any): any { const r = x.valueOf(); return r; }
function callString_valueOfWatched(x: any): any { try { const r = x.valueOf(); return [r]; } catch (e) { return thrown(e); } }
function callString_isWellFormed(x: any): any { const r = x.isWellFormed(); return r; }
function callString_isWellFormedWatched(x: any): any { try { const r = x.isWellFormed(); return [r]; } catch (e) { return thrown(e); } }
function callString_toLocaleUpperCase(x: any): any { const r = x.toLocaleUpperCase(); return r; }
function callString_toLocaleUpperCaseWatched(x: any): any { try { const r = x.toLocaleUpperCase(); return [r]; } catch (e) { return thrown(e); } }
function callArray_keys(x: any): any { const r = x.keys(); return r; }
function callArray_keysWatched(x: any): any { try { const r = x.keys(); return [r]; } catch (e) { return thrown(e); } }
function callArray_values(x: any): any { const r = x.values(); return r; }
function callArray_valuesWatched(x: any): any { try { const r = x.values(); return [r]; } catch (e) { return thrown(e); } }
function callArray_entries(x: any): any { const r = x.entries(); return r; }
function callArray_entriesWatched(x: any): any { try { const r = x.entries(); return [r]; } catch (e) { return thrown(e); } }
function callArray_copyWithin(x: any): any { const r = x.copyWithin(0, 1); return r; }
function callArray_copyWithinWatched(x: any): any { try { const r = x.copyWithin(0, 1); return [r]; } catch (e) { return thrown(e); } }
function callArray_flat(x: any): any { const r = x.flat(); return r; }
function callArray_flatWatched(x: any): any { try { const r = x.flat(); return [r]; } catch (e) { return thrown(e); } }
function callArray_lastIndexOf(x: any): any { const r = x.lastIndexOf(2); return r; }
function callArray_lastIndexOfWatched(x: any): any { try { const r = x.lastIndexOf(2); return [r]; } catch (e) { return thrown(e); } }
function callArray_toSpliced(x: any): any { const r = x.toSpliced(0, 1); return r; }
function callArray_toSplicedWatched(x: any): any { try { const r = x.toSpliced(0, 1); return [r]; } catch (e) { return thrown(e); } }
function callArray_with(x: any): any { const r = x.with(0, 9); return r; }
function callArray_withWatched(x: any): any { try { const r = x.with(0, 9); return [r]; } catch (e) { return thrown(e); } }
function callArray_toReversed(x: any): any { const r = x.toReversed(); return r; }
function callArray_toReversedWatched(x: any): any { try { const r = x.toReversed(); return [r]; } catch (e) { return thrown(e); } }
function callArray_toSorted(x: any): any { const r = x.toSorted(); return r; }
function callArray_toSortedWatched(x: any): any { try { const r = x.toSorted(); return [r]; } catch (e) { return thrown(e); } }
function callArray_fill(x: any): any { const r = x.fill(7, 1); return r; }
function callArray_fillWatched(x: any): any { try { const r = x.fill(7, 1); return [r]; } catch (e) { return thrown(e); } }
function callArray_reverse(x: any): any { const r = x.reverse(); return r; }
function callArray_reverseWatched(x: any): any { try { const r = x.reverse(); return [r]; } catch (e) { return thrown(e); } }
function callArray_shift(x: any): any { const r = x.shift(); return r; }
function callArray_shiftWatched(x: any): any { try { const r = x.shift(); return [r]; } catch (e) { return thrown(e); } }
function callArray_unshift(x: any): any { const r = x.unshift(5); return r; }
function callArray_unshiftWatched(x: any): any { try { const r = x.unshift(5); return [r]; } catch (e) { return thrown(e); } }
function callArray_splice(x: any): any { const r = x.splice(0, 1); return r; }
function callArray_spliceWatched(x: any): any { try { const r = x.splice(0, 1); return [r]; } catch (e) { return thrown(e); } }
function callArray_concat(x: any): any { const r = x.concat([4]); return r; }
function callArray_concatWatched(x: any): any { try { const r = x.concat([4]); return [r]; } catch (e) { return thrown(e); } }
function callArray_join(x: any): any { const r = x.join("-"); return r; }
function callArray_joinWatched(x: any): any { try { const r = x.join("-"); return [r]; } catch (e) { return thrown(e); } }
function callArray_slice(x: any): any { const r = x.slice(1); return r; }
function callArray_sliceWatched(x: any): any { try { const r = x.slice(1); return [r]; } catch (e) { return thrown(e); } }
function callArray_indexOf(x: any): any { const r = x.indexOf(2); return r; }
function callArray_indexOfWatched(x: any): any { try { const r = x.indexOf(2); return [r]; } catch (e) { return thrown(e); } }
function callArray_includes(x: any): any { const r = x.includes(2); return r; }
function callArray_includesWatched(x: any): any { try { const r = x.includes(2); return [r]; } catch (e) { return thrown(e); } }
function callArray_at(x: any): any { const r = x.at(-1); return r; }
function callArray_atWatched(x: any): any { try { const r = x.at(-1); return [r]; } catch (e) { return thrown(e); } }
function callArray_pop(x: any): any { const r = x.pop(); return r; }
function callArray_popWatched(x: any): any { try { const r = x.pop(); return [r]; } catch (e) { return thrown(e); } }
function callArray_push(x: any): any { const r = x.push(6); return r; }
function callArray_pushWatched(x: any): any { try { const r = x.push(6); return [r]; } catch (e) { return thrown(e); } }
function callArray_toString(x: any): any { const r = x.toString(); return r; }
function callArray_toStringWatched(x: any): any { try { const r = x.toString(); return [r]; } catch (e) { return thrown(e); } }
function callArray_toLocaleString(x: any): any { const r = x.toLocaleString(); return r; }
function callArray_toLocaleStringWatched(x: any): any { try { const r = x.toLocaleString(); return [r]; } catch (e) { return thrown(e); } }
function callMap_get(x: any): any { const r = x.get("a"); return r; }
function callMap_getWatched(x: any): any { try { const r = x.get("a"); return [r]; } catch (e) { return thrown(e); } }
function callMap_has(x: any): any { const r = x.has("a"); return r; }
function callMap_hasWatched(x: any): any { try { const r = x.has("a"); return [r]; } catch (e) { return thrown(e); } }
function callMap_set(x: any): any { const r = x.set("c", 3); return r; }
function callMap_setWatched(x: any): any { try { const r = x.set("c", 3); return [r]; } catch (e) { return thrown(e); } }
function callMap_delete(x: any): any { const r = x.delete("a"); return r; }
function callMap_deleteWatched(x: any): any { try { const r = x.delete("a"); return [r]; } catch (e) { return thrown(e); } }
function callMap_keys(x: any): any { const r = x.keys(); return r; }
function callMap_keysWatched(x: any): any { try { const r = x.keys(); return [r]; } catch (e) { return thrown(e); } }
function callMap_values(x: any): any { const r = x.values(); return r; }
function callMap_valuesWatched(x: any): any { try { const r = x.values(); return [r]; } catch (e) { return thrown(e); } }
function callMap_entries(x: any): any { const r = x.entries(); return r; }
function callMap_entriesWatched(x: any): any { try { const r = x.entries(); return [r]; } catch (e) { return thrown(e); } }
function callMap_clear(x: any): any { const r = x.clear(); return r; }
function callMap_clearWatched(x: any): any { try { const r = x.clear(); return [r]; } catch (e) { return thrown(e); } }
function callSet_has(x: any): any { const r = x.has("a"); return r; }
function callSet_hasWatched(x: any): any { try { const r = x.has("a"); return [r]; } catch (e) { return thrown(e); } }
function callSet_add(x: any): any { const r = x.add("c"); return r; }
function callSet_addWatched(x: any): any { try { const r = x.add("c"); return [r]; } catch (e) { return thrown(e); } }
function callSet_delete(x: any): any { const r = x.delete("a"); return r; }
function callSet_deleteWatched(x: any): any { try { const r = x.delete("a"); return [r]; } catch (e) { return thrown(e); } }
function callSet_keys(x: any): any { const r = x.keys(); return r; }
function callSet_keysWatched(x: any): any { try { const r = x.keys(); return [r]; } catch (e) { return thrown(e); } }
function callSet_values(x: any): any { const r = x.values(); return r; }
function callSet_valuesWatched(x: any): any { try { const r = x.values(); return [r]; } catch (e) { return thrown(e); } }
function callSet_entries(x: any): any { const r = x.entries(); return r; }
function callSet_entriesWatched(x: any): any { try { const r = x.entries(); return [r]; } catch (e) { return thrown(e); } }
function callSet_clear(x: any): any { const r = x.clear(); return r; }
function callSet_clearWatched(x: any): any { try { const r = x.clear(); return [r]; } catch (e) { return thrown(e); } }
function callSet_union(x: any): any { const r = x.union(new Set(["z"])); return r; }
function callSet_unionWatched(x: any): any { try { const r = x.union(new Set(["z"])); return [r]; } catch (e) { return thrown(e); } }
function callSet_isSubsetOf(x: any): any { const r = x.isSubsetOf(new Set(["a", "b"])); return r; }
function callSet_isSubsetOfWatched(x: any): any { try { const r = x.isSubsetOf(new Set(["a", "b"])); return [r]; } catch (e) { return thrown(e); } }
function callDate_getTime(x: any): any { const r = x.getTime(); return r; }
function callDate_getTimeWatched(x: any): any { try { const r = x.getTime(); return [r]; } catch (e) { return thrown(e); } }
function callDate_getUTCFullYear(x: any): any { const r = x.getUTCFullYear(); return r; }
function callDate_getUTCFullYearWatched(x: any): any { try { const r = x.getUTCFullYear(); return [r]; } catch (e) { return thrown(e); } }
function callDate_toISOString(x: any): any { const r = x.toISOString(); return r; }
function callDate_toISOStringWatched(x: any): any { try { const r = x.toISOString(); return [r]; } catch (e) { return thrown(e); } }
function callDate_valueOf(x: any): any { const r = x.valueOf(); return r; }
function callDate_valueOfWatched(x: any): any { try { const r = x.valueOf(); return [r]; } catch (e) { return thrown(e); } }
function callDate_getUTCDay(x: any): any { const r = x.getUTCDay(); return r; }
function callDate_getUTCDayWatched(x: any): any { try { const r = x.getUTCDay(); return [r]; } catch (e) { return thrown(e); } }
function callDate_setUTCFullYear(x: any): any { const r = x.setUTCFullYear(2001); return r; }
function callDate_setUTCFullYearWatched(x: any): any { try { const r = x.setUTCFullYear(2001); return [r]; } catch (e) { return thrown(e); } }
function callDate_toJSON(x: any): any { const r = x.toJSON(); return r; }
function callDate_toJSONWatched(x: any): any { try { const r = x.toJSON(); return [r]; } catch (e) { return thrown(e); } }
function callPromise_then(x: any): any { const r = x.then(noted); return r; }
function callPromise_thenWatched(x: any): any { try { const r = x.then(noted); return [r]; } catch (e) { return thrown(e); } }
function callPromise_catch(x: any): any { const r = x.catch(noted); return r; }
function callPromise_catchWatched(x: any): any { try { const r = x.catch(noted); return [r]; } catch (e) { return thrown(e); } }
function callPromise_finally(x: any): any { const r = x.finally(noted); return r; }
function callPromise_finallyWatched(x: any): any { try { const r = x.finally(noted); return [r]; } catch (e) { return thrown(e); } }
function callWeakMap_get(x: any): any { const r = x.get(key); return r; }
function callWeakMap_getWatched(x: any): any { try { const r = x.get(key); return [r]; } catch (e) { return thrown(e); } }
function callWeakMap_has(x: any): any { const r = x.has(key); return r; }
function callWeakMap_hasWatched(x: any): any { try { const r = x.has(key); return [r]; } catch (e) { return thrown(e); } }
function callWeakMap_set(x: any): any { const r = x.set(key, 2); return r; }
function callWeakMap_setWatched(x: any): any { try { const r = x.set(key, 2); return [r]; } catch (e) { return thrown(e); } }
function callWeakMap_delete(x: any): any { const r = x.delete(key); return r; }
function callWeakMap_deleteWatched(x: any): any { try { const r = x.delete(key); return [r]; } catch (e) { return thrown(e); } }
function callRegExp_test(x: any): any { const r = x.test("abc"); return r; }
function callRegExp_testWatched(x: any): any { try { const r = x.test("abc"); return [r]; } catch (e) { return thrown(e); } }
function callRegExp_exec(x: any): any { const r = x.exec("abc"); return r; }
function callRegExp_execWatched(x: any): any { try { const r = x.exec("abc"); return [r]; } catch (e) { return thrown(e); } }
function callRegExp_toString(x: any): any { const r = x.toString(); return r; }
function callRegExp_toStringWatched(x: any): any { try { const r = x.toString(); return [r]; } catch (e) { return thrown(e); } }
attempt("String.padStart of the class", callString_padStart, "abc");
attempt("String.padStart an heir", callString_padStart, new (class extends String { })("abc"));
attempt("String.padStart with its own", callString_padStart, withOwn("abc", "padStart"));
attempt("String.padStart with another prototype", callString_padStart, withOtherPrototype("abc", "padStart"));
attempt("String.padStart with a getter", callString_padStart, withGetter("abc", "padStart"));
attempt("String.padStart a stranger", callString_padStart, stranger("padStart"));
attempt("String.padStart a plain object", callString_padStart, { });
attempt("String.padStart a number", callString_padStart, 5);
attempt("String.padStart a string", callString_padStart, "xyz");
attempt("String.padStart true", callString_padStart, true);
attempt("String.padStart undefined", callString_padStart, undefined);
attempt("String.padStart null", callString_padStart, null);
attempt("String.padStart an array", callString_padStart, [9, 8]);
attempt("String.padStart a frozen one", callString_padStart, Object.freeze("abc"));
attempt("String.padStart watched", callString_padStartWatched, "abc"); attempt("String.padStart watched, undefined", callString_padStartWatched, undefined); attempt("String.padStart watched, a stranger", callString_padStartWatched, stranger("padStart"));
attempt("String.padEnd of the class", callString_padEnd, "abc");
attempt("String.padEnd an heir", callString_padEnd, new (class extends String { })("abc"));
attempt("String.padEnd with its own", callString_padEnd, withOwn("abc", "padEnd"));
attempt("String.padEnd with another prototype", callString_padEnd, withOtherPrototype("abc", "padEnd"));
attempt("String.padEnd with a getter", callString_padEnd, withGetter("abc", "padEnd"));
attempt("String.padEnd a stranger", callString_padEnd, stranger("padEnd"));
attempt("String.padEnd a plain object", callString_padEnd, { });
attempt("String.padEnd a number", callString_padEnd, 5);
attempt("String.padEnd a string", callString_padEnd, "xyz");
attempt("String.padEnd true", callString_padEnd, true);
attempt("String.padEnd undefined", callString_padEnd, undefined);
attempt("String.padEnd null", callString_padEnd, null);
attempt("String.padEnd an array", callString_padEnd, [9, 8]);
attempt("String.padEnd a frozen one", callString_padEnd, Object.freeze("abc"));
attempt("String.padEnd watched", callString_padEndWatched, "abc"); attempt("String.padEnd watched, undefined", callString_padEndWatched, undefined); attempt("String.padEnd watched, a stranger", callString_padEndWatched, stranger("padEnd"));
attempt("String.repeat of the class", callString_repeat, "abc");
attempt("String.repeat an heir", callString_repeat, new (class extends String { })("abc"));
attempt("String.repeat with its own", callString_repeat, withOwn("abc", "repeat"));
attempt("String.repeat with another prototype", callString_repeat, withOtherPrototype("abc", "repeat"));
attempt("String.repeat with a getter", callString_repeat, withGetter("abc", "repeat"));
attempt("String.repeat a stranger", callString_repeat, stranger("repeat"));
attempt("String.repeat a plain object", callString_repeat, { });
attempt("String.repeat a number", callString_repeat, 5);
attempt("String.repeat a string", callString_repeat, "xyz");
attempt("String.repeat true", callString_repeat, true);
attempt("String.repeat undefined", callString_repeat, undefined);
attempt("String.repeat null", callString_repeat, null);
attempt("String.repeat an array", callString_repeat, [9, 8]);
attempt("String.repeat a frozen one", callString_repeat, Object.freeze("abc"));
attempt("String.repeat watched", callString_repeatWatched, "abc"); attempt("String.repeat watched, undefined", callString_repeatWatched, undefined); attempt("String.repeat watched, a stranger", callString_repeatWatched, stranger("repeat"));
attempt("String.localeCompare of the class", callString_localeCompare, "abc");
attempt("String.localeCompare an heir", callString_localeCompare, new (class extends String { })("abc"));
attempt("String.localeCompare with its own", callString_localeCompare, withOwn("abc", "localeCompare"));
attempt("String.localeCompare with another prototype", callString_localeCompare, withOtherPrototype("abc", "localeCompare"));
attempt("String.localeCompare with a getter", callString_localeCompare, withGetter("abc", "localeCompare"));
attempt("String.localeCompare a stranger", callString_localeCompare, stranger("localeCompare"));
attempt("String.localeCompare a plain object", callString_localeCompare, { });
attempt("String.localeCompare a number", callString_localeCompare, 5);
attempt("String.localeCompare a string", callString_localeCompare, "xyz");
attempt("String.localeCompare true", callString_localeCompare, true);
attempt("String.localeCompare undefined", callString_localeCompare, undefined);
attempt("String.localeCompare null", callString_localeCompare, null);
attempt("String.localeCompare an array", callString_localeCompare, [9, 8]);
attempt("String.localeCompare a frozen one", callString_localeCompare, Object.freeze("abc"));
attempt("String.localeCompare watched", callString_localeCompareWatched, "abc"); attempt("String.localeCompare watched, undefined", callString_localeCompareWatched, undefined); attempt("String.localeCompare watched, a stranger", callString_localeCompareWatched, stranger("localeCompare"));
attempt("String.normalize of the class", callString_normalize, "abc");
attempt("String.normalize an heir", callString_normalize, new (class extends String { })("abc"));
attempt("String.normalize with its own", callString_normalize, withOwn("abc", "normalize"));
attempt("String.normalize with another prototype", callString_normalize, withOtherPrototype("abc", "normalize"));
attempt("String.normalize with a getter", callString_normalize, withGetter("abc", "normalize"));
attempt("String.normalize a stranger", callString_normalize, stranger("normalize"));
attempt("String.normalize a plain object", callString_normalize, { });
attempt("String.normalize a number", callString_normalize, 5);
attempt("String.normalize a string", callString_normalize, "xyz");
attempt("String.normalize true", callString_normalize, true);
attempt("String.normalize undefined", callString_normalize, undefined);
attempt("String.normalize null", callString_normalize, null);
attempt("String.normalize an array", callString_normalize, [9, 8]);
attempt("String.normalize a frozen one", callString_normalize, Object.freeze("abc"));
attempt("String.normalize watched", callString_normalizeWatched, "abc"); attempt("String.normalize watched, undefined", callString_normalizeWatched, undefined); attempt("String.normalize watched, a stranger", callString_normalizeWatched, stranger("normalize"));
attempt("String.at of the class", callString_at, "abc");
attempt("String.at an heir", callString_at, new (class extends String { })("abc"));
attempt("String.at with its own", callString_at, withOwn("abc", "at"));
attempt("String.at with another prototype", callString_at, withOtherPrototype("abc", "at"));
attempt("String.at with a getter", callString_at, withGetter("abc", "at"));
attempt("String.at a stranger", callString_at, stranger("at"));
attempt("String.at a plain object", callString_at, { });
attempt("String.at a number", callString_at, 5);
attempt("String.at a string", callString_at, "xyz");
attempt("String.at true", callString_at, true);
attempt("String.at undefined", callString_at, undefined);
attempt("String.at null", callString_at, null);
attempt("String.at an array", callString_at, [9, 8]);
attempt("String.at a frozen one", callString_at, Object.freeze("abc"));
attempt("String.at watched", callString_atWatched, "abc"); attempt("String.at watched, undefined", callString_atWatched, undefined); attempt("String.at watched, a stranger", callString_atWatched, stranger("at"));
attempt("String.codePointAt of the class", callString_codePointAt, "abc");
attempt("String.codePointAt an heir", callString_codePointAt, new (class extends String { })("abc"));
attempt("String.codePointAt with its own", callString_codePointAt, withOwn("abc", "codePointAt"));
attempt("String.codePointAt with another prototype", callString_codePointAt, withOtherPrototype("abc", "codePointAt"));
attempt("String.codePointAt with a getter", callString_codePointAt, withGetter("abc", "codePointAt"));
attempt("String.codePointAt a stranger", callString_codePointAt, stranger("codePointAt"));
attempt("String.codePointAt a plain object", callString_codePointAt, { });
attempt("String.codePointAt a number", callString_codePointAt, 5);
attempt("String.codePointAt a string", callString_codePointAt, "xyz");
attempt("String.codePointAt true", callString_codePointAt, true);
attempt("String.codePointAt undefined", callString_codePointAt, undefined);
attempt("String.codePointAt null", callString_codePointAt, null);
attempt("String.codePointAt an array", callString_codePointAt, [9, 8]);
attempt("String.codePointAt a frozen one", callString_codePointAt, Object.freeze("abc"));
attempt("String.codePointAt watched", callString_codePointAtWatched, "abc"); attempt("String.codePointAt watched, undefined", callString_codePointAtWatched, undefined); attempt("String.codePointAt watched, a stranger", callString_codePointAtWatched, stranger("codePointAt"));
attempt("String.charAt of the class", callString_charAt, "abc");
attempt("String.charAt an heir", callString_charAt, new (class extends String { })("abc"));
attempt("String.charAt with its own", callString_charAt, withOwn("abc", "charAt"));
attempt("String.charAt with another prototype", callString_charAt, withOtherPrototype("abc", "charAt"));
attempt("String.charAt with a getter", callString_charAt, withGetter("abc", "charAt"));
attempt("String.charAt a stranger", callString_charAt, stranger("charAt"));
attempt("String.charAt a plain object", callString_charAt, { });
attempt("String.charAt a number", callString_charAt, 5);
attempt("String.charAt a string", callString_charAt, "xyz");
attempt("String.charAt true", callString_charAt, true);
attempt("String.charAt undefined", callString_charAt, undefined);
attempt("String.charAt null", callString_charAt, null);
attempt("String.charAt an array", callString_charAt, [9, 8]);
attempt("String.charAt a frozen one", callString_charAt, Object.freeze("abc"));
attempt("String.charAt watched", callString_charAtWatched, "abc"); attempt("String.charAt watched, undefined", callString_charAtWatched, undefined); attempt("String.charAt watched, a stranger", callString_charAtWatched, stranger("charAt"));
attempt("String.charCodeAt of the class", callString_charCodeAt, "abc");
attempt("String.charCodeAt an heir", callString_charCodeAt, new (class extends String { })("abc"));
attempt("String.charCodeAt with its own", callString_charCodeAt, withOwn("abc", "charCodeAt"));
attempt("String.charCodeAt with another prototype", callString_charCodeAt, withOtherPrototype("abc", "charCodeAt"));
attempt("String.charCodeAt with a getter", callString_charCodeAt, withGetter("abc", "charCodeAt"));
attempt("String.charCodeAt a stranger", callString_charCodeAt, stranger("charCodeAt"));
attempt("String.charCodeAt a plain object", callString_charCodeAt, { });
attempt("String.charCodeAt a number", callString_charCodeAt, 5);
attempt("String.charCodeAt a string", callString_charCodeAt, "xyz");
attempt("String.charCodeAt true", callString_charCodeAt, true);
attempt("String.charCodeAt undefined", callString_charCodeAt, undefined);
attempt("String.charCodeAt null", callString_charCodeAt, null);
attempt("String.charCodeAt an array", callString_charCodeAt, [9, 8]);
attempt("String.charCodeAt a frozen one", callString_charCodeAt, Object.freeze("abc"));
attempt("String.charCodeAt watched", callString_charCodeAtWatched, "abc"); attempt("String.charCodeAt watched, undefined", callString_charCodeAtWatched, undefined); attempt("String.charCodeAt watched, a stranger", callString_charCodeAtWatched, stranger("charCodeAt"));
attempt("String.concat of the class", callString_concat, "abc");
attempt("String.concat an heir", callString_concat, new (class extends String { })("abc"));
attempt("String.concat with its own", callString_concat, withOwn("abc", "concat"));
attempt("String.concat with another prototype", callString_concat, withOtherPrototype("abc", "concat"));
attempt("String.concat with a getter", callString_concat, withGetter("abc", "concat"));
attempt("String.concat a stranger", callString_concat, stranger("concat"));
attempt("String.concat a plain object", callString_concat, { });
attempt("String.concat a number", callString_concat, 5);
attempt("String.concat a string", callString_concat, "xyz");
attempt("String.concat true", callString_concat, true);
attempt("String.concat undefined", callString_concat, undefined);
attempt("String.concat null", callString_concat, null);
attempt("String.concat an array", callString_concat, [9, 8]);
attempt("String.concat a frozen one", callString_concat, Object.freeze("abc"));
attempt("String.concat watched", callString_concatWatched, "abc"); attempt("String.concat watched, undefined", callString_concatWatched, undefined); attempt("String.concat watched, a stranger", callString_concatWatched, stranger("concat"));
attempt("String.endsWith of the class", callString_endsWith, "abc");
attempt("String.endsWith an heir", callString_endsWith, new (class extends String { })("abc"));
attempt("String.endsWith with its own", callString_endsWith, withOwn("abc", "endsWith"));
attempt("String.endsWith with another prototype", callString_endsWith, withOtherPrototype("abc", "endsWith"));
attempt("String.endsWith with a getter", callString_endsWith, withGetter("abc", "endsWith"));
attempt("String.endsWith a stranger", callString_endsWith, stranger("endsWith"));
attempt("String.endsWith a plain object", callString_endsWith, { });
attempt("String.endsWith a number", callString_endsWith, 5);
attempt("String.endsWith a string", callString_endsWith, "xyz");
attempt("String.endsWith true", callString_endsWith, true);
attempt("String.endsWith undefined", callString_endsWith, undefined);
attempt("String.endsWith null", callString_endsWith, null);
attempt("String.endsWith an array", callString_endsWith, [9, 8]);
attempt("String.endsWith a frozen one", callString_endsWith, Object.freeze("abc"));
attempt("String.endsWith watched", callString_endsWithWatched, "abc"); attempt("String.endsWith watched, undefined", callString_endsWithWatched, undefined); attempt("String.endsWith watched, a stranger", callString_endsWithWatched, stranger("endsWith"));
attempt("String.startsWith of the class", callString_startsWith, "abc");
attempt("String.startsWith an heir", callString_startsWith, new (class extends String { })("abc"));
attempt("String.startsWith with its own", callString_startsWith, withOwn("abc", "startsWith"));
attempt("String.startsWith with another prototype", callString_startsWith, withOtherPrototype("abc", "startsWith"));
attempt("String.startsWith with a getter", callString_startsWith, withGetter("abc", "startsWith"));
attempt("String.startsWith a stranger", callString_startsWith, stranger("startsWith"));
attempt("String.startsWith a plain object", callString_startsWith, { });
attempt("String.startsWith a number", callString_startsWith, 5);
attempt("String.startsWith a string", callString_startsWith, "xyz");
attempt("String.startsWith true", callString_startsWith, true);
attempt("String.startsWith undefined", callString_startsWith, undefined);
attempt("String.startsWith null", callString_startsWith, null);
attempt("String.startsWith an array", callString_startsWith, [9, 8]);
attempt("String.startsWith a frozen one", callString_startsWith, Object.freeze("abc"));
attempt("String.startsWith watched", callString_startsWithWatched, "abc"); attempt("String.startsWith watched, undefined", callString_startsWithWatched, undefined); attempt("String.startsWith watched, a stranger", callString_startsWithWatched, stranger("startsWith"));
attempt("String.includes of the class", callString_includes, "abc");
attempt("String.includes an heir", callString_includes, new (class extends String { })("abc"));
attempt("String.includes with its own", callString_includes, withOwn("abc", "includes"));
attempt("String.includes with another prototype", callString_includes, withOtherPrototype("abc", "includes"));
attempt("String.includes with a getter", callString_includes, withGetter("abc", "includes"));
attempt("String.includes a stranger", callString_includes, stranger("includes"));
attempt("String.includes a plain object", callString_includes, { });
attempt("String.includes a number", callString_includes, 5);
attempt("String.includes a string", callString_includes, "xyz");
attempt("String.includes true", callString_includes, true);
attempt("String.includes undefined", callString_includes, undefined);
attempt("String.includes null", callString_includes, null);
attempt("String.includes an array", callString_includes, [9, 8]);
attempt("String.includes a frozen one", callString_includes, Object.freeze("abc"));
attempt("String.includes watched", callString_includesWatched, "abc"); attempt("String.includes watched, undefined", callString_includesWatched, undefined); attempt("String.includes watched, a stranger", callString_includesWatched, stranger("includes"));
attempt("String.indexOf of the class", callString_indexOf, "abc");
attempt("String.indexOf an heir", callString_indexOf, new (class extends String { })("abc"));
attempt("String.indexOf with its own", callString_indexOf, withOwn("abc", "indexOf"));
attempt("String.indexOf with another prototype", callString_indexOf, withOtherPrototype("abc", "indexOf"));
attempt("String.indexOf with a getter", callString_indexOf, withGetter("abc", "indexOf"));
attempt("String.indexOf a stranger", callString_indexOf, stranger("indexOf"));
attempt("String.indexOf a plain object", callString_indexOf, { });
attempt("String.indexOf a number", callString_indexOf, 5);
attempt("String.indexOf a string", callString_indexOf, "xyz");
attempt("String.indexOf true", callString_indexOf, true);
attempt("String.indexOf undefined", callString_indexOf, undefined);
attempt("String.indexOf null", callString_indexOf, null);
attempt("String.indexOf an array", callString_indexOf, [9, 8]);
attempt("String.indexOf a frozen one", callString_indexOf, Object.freeze("abc"));
attempt("String.indexOf watched", callString_indexOfWatched, "abc"); attempt("String.indexOf watched, undefined", callString_indexOfWatched, undefined); attempt("String.indexOf watched, a stranger", callString_indexOfWatched, stranger("indexOf"));
attempt("String.lastIndexOf of the class", callString_lastIndexOf, "abc");
attempt("String.lastIndexOf an heir", callString_lastIndexOf, new (class extends String { })("abc"));
attempt("String.lastIndexOf with its own", callString_lastIndexOf, withOwn("abc", "lastIndexOf"));
attempt("String.lastIndexOf with another prototype", callString_lastIndexOf, withOtherPrototype("abc", "lastIndexOf"));
attempt("String.lastIndexOf with a getter", callString_lastIndexOf, withGetter("abc", "lastIndexOf"));
attempt("String.lastIndexOf a stranger", callString_lastIndexOf, stranger("lastIndexOf"));
attempt("String.lastIndexOf a plain object", callString_lastIndexOf, { });
attempt("String.lastIndexOf a number", callString_lastIndexOf, 5);
attempt("String.lastIndexOf a string", callString_lastIndexOf, "xyz");
attempt("String.lastIndexOf true", callString_lastIndexOf, true);
attempt("String.lastIndexOf undefined", callString_lastIndexOf, undefined);
attempt("String.lastIndexOf null", callString_lastIndexOf, null);
attempt("String.lastIndexOf an array", callString_lastIndexOf, [9, 8]);
attempt("String.lastIndexOf a frozen one", callString_lastIndexOf, Object.freeze("abc"));
attempt("String.lastIndexOf watched", callString_lastIndexOfWatched, "abc"); attempt("String.lastIndexOf watched, undefined", callString_lastIndexOfWatched, undefined); attempt("String.lastIndexOf watched, a stranger", callString_lastIndexOfWatched, stranger("lastIndexOf"));
attempt("String.match of the class", callString_match, "abc");
attempt("String.match an heir", callString_match, new (class extends String { })("abc"));
attempt("String.match with its own", callString_match, withOwn("abc", "match"));
attempt("String.match with another prototype", callString_match, withOtherPrototype("abc", "match"));
attempt("String.match with a getter", callString_match, withGetter("abc", "match"));
attempt("String.match a stranger", callString_match, stranger("match"));
attempt("String.match a plain object", callString_match, { });
attempt("String.match a number", callString_match, 5);
attempt("String.match a string", callString_match, "xyz");
attempt("String.match true", callString_match, true);
attempt("String.match undefined", callString_match, undefined);
attempt("String.match null", callString_match, null);
attempt("String.match an array", callString_match, [9, 8]);
attempt("String.match a frozen one", callString_match, Object.freeze("abc"));
attempt("String.match watched", callString_matchWatched, "abc"); attempt("String.match watched, undefined", callString_matchWatched, undefined); attempt("String.match watched, a stranger", callString_matchWatched, stranger("match"));
attempt("String.search of the class", callString_search, "abc");
attempt("String.search an heir", callString_search, new (class extends String { })("abc"));
attempt("String.search with its own", callString_search, withOwn("abc", "search"));
attempt("String.search with another prototype", callString_search, withOtherPrototype("abc", "search"));
attempt("String.search with a getter", callString_search, withGetter("abc", "search"));
attempt("String.search a stranger", callString_search, stranger("search"));
attempt("String.search a plain object", callString_search, { });
attempt("String.search a number", callString_search, 5);
attempt("String.search a string", callString_search, "xyz");
attempt("String.search true", callString_search, true);
attempt("String.search undefined", callString_search, undefined);
attempt("String.search null", callString_search, null);
attempt("String.search an array", callString_search, [9, 8]);
attempt("String.search a frozen one", callString_search, Object.freeze("abc"));
attempt("String.search watched", callString_searchWatched, "abc"); attempt("String.search watched, undefined", callString_searchWatched, undefined); attempt("String.search watched, a stranger", callString_searchWatched, stranger("search"));
attempt("String.replace of the class", callString_replace, "abc");
attempt("String.replace an heir", callString_replace, new (class extends String { })("abc"));
attempt("String.replace with its own", callString_replace, withOwn("abc", "replace"));
attempt("String.replace with another prototype", callString_replace, withOtherPrototype("abc", "replace"));
attempt("String.replace with a getter", callString_replace, withGetter("abc", "replace"));
attempt("String.replace a stranger", callString_replace, stranger("replace"));
attempt("String.replace a plain object", callString_replace, { });
attempt("String.replace a number", callString_replace, 5);
attempt("String.replace a string", callString_replace, "xyz");
attempt("String.replace true", callString_replace, true);
attempt("String.replace undefined", callString_replace, undefined);
attempt("String.replace null", callString_replace, null);
attempt("String.replace an array", callString_replace, [9, 8]);
attempt("String.replace a frozen one", callString_replace, Object.freeze("abc"));
attempt("String.replace watched", callString_replaceWatched, "abc"); attempt("String.replace watched, undefined", callString_replaceWatched, undefined); attempt("String.replace watched, a stranger", callString_replaceWatched, stranger("replace"));
attempt("String.replaceAll of the class", callString_replaceAll, "abc");
attempt("String.replaceAll an heir", callString_replaceAll, new (class extends String { })("abc"));
attempt("String.replaceAll with its own", callString_replaceAll, withOwn("abc", "replaceAll"));
attempt("String.replaceAll with another prototype", callString_replaceAll, withOtherPrototype("abc", "replaceAll"));
attempt("String.replaceAll with a getter", callString_replaceAll, withGetter("abc", "replaceAll"));
attempt("String.replaceAll a stranger", callString_replaceAll, stranger("replaceAll"));
attempt("String.replaceAll a plain object", callString_replaceAll, { });
attempt("String.replaceAll a number", callString_replaceAll, 5);
attempt("String.replaceAll a string", callString_replaceAll, "xyz");
attempt("String.replaceAll true", callString_replaceAll, true);
attempt("String.replaceAll undefined", callString_replaceAll, undefined);
attempt("String.replaceAll null", callString_replaceAll, null);
attempt("String.replaceAll an array", callString_replaceAll, [9, 8]);
attempt("String.replaceAll a frozen one", callString_replaceAll, Object.freeze("abc"));
attempt("String.replaceAll watched", callString_replaceAllWatched, "abc"); attempt("String.replaceAll watched, undefined", callString_replaceAllWatched, undefined); attempt("String.replaceAll watched, a stranger", callString_replaceAllWatched, stranger("replaceAll"));
attempt("String.slice of the class", callString_slice, "abc");
attempt("String.slice an heir", callString_slice, new (class extends String { })("abc"));
attempt("String.slice with its own", callString_slice, withOwn("abc", "slice"));
attempt("String.slice with another prototype", callString_slice, withOtherPrototype("abc", "slice"));
attempt("String.slice with a getter", callString_slice, withGetter("abc", "slice"));
attempt("String.slice a stranger", callString_slice, stranger("slice"));
attempt("String.slice a plain object", callString_slice, { });
attempt("String.slice a number", callString_slice, 5);
attempt("String.slice a string", callString_slice, "xyz");
attempt("String.slice true", callString_slice, true);
attempt("String.slice undefined", callString_slice, undefined);
attempt("String.slice null", callString_slice, null);
attempt("String.slice an array", callString_slice, [9, 8]);
attempt("String.slice a frozen one", callString_slice, Object.freeze("abc"));
attempt("String.slice watched", callString_sliceWatched, "abc"); attempt("String.slice watched, undefined", callString_sliceWatched, undefined); attempt("String.slice watched, a stranger", callString_sliceWatched, stranger("slice"));
attempt("String.split of the class", callString_split, "abc");
attempt("String.split an heir", callString_split, new (class extends String { })("abc"));
attempt("String.split with its own", callString_split, withOwn("abc", "split"));
attempt("String.split with another prototype", callString_split, withOtherPrototype("abc", "split"));
attempt("String.split with a getter", callString_split, withGetter("abc", "split"));
attempt("String.split a stranger", callString_split, stranger("split"));
attempt("String.split a plain object", callString_split, { });
attempt("String.split a number", callString_split, 5);
attempt("String.split a string", callString_split, "xyz");
attempt("String.split true", callString_split, true);
attempt("String.split undefined", callString_split, undefined);
attempt("String.split null", callString_split, null);
attempt("String.split an array", callString_split, [9, 8]);
attempt("String.split a frozen one", callString_split, Object.freeze("abc"));
attempt("String.split watched", callString_splitWatched, "abc"); attempt("String.split watched, undefined", callString_splitWatched, undefined); attempt("String.split watched, a stranger", callString_splitWatched, stranger("split"));
attempt("String.substring of the class", callString_substring, "abc");
attempt("String.substring an heir", callString_substring, new (class extends String { })("abc"));
attempt("String.substring with its own", callString_substring, withOwn("abc", "substring"));
attempt("String.substring with another prototype", callString_substring, withOtherPrototype("abc", "substring"));
attempt("String.substring with a getter", callString_substring, withGetter("abc", "substring"));
attempt("String.substring a stranger", callString_substring, stranger("substring"));
attempt("String.substring a plain object", callString_substring, { });
attempt("String.substring a number", callString_substring, 5);
attempt("String.substring a string", callString_substring, "xyz");
attempt("String.substring true", callString_substring, true);
attempt("String.substring undefined", callString_substring, undefined);
attempt("String.substring null", callString_substring, null);
attempt("String.substring an array", callString_substring, [9, 8]);
attempt("String.substring a frozen one", callString_substring, Object.freeze("abc"));
attempt("String.substring watched", callString_substringWatched, "abc"); attempt("String.substring watched, undefined", callString_substringWatched, undefined); attempt("String.substring watched, a stranger", callString_substringWatched, stranger("substring"));
attempt("String.toLowerCase of the class", callString_toLowerCase, "abc");
attempt("String.toLowerCase an heir", callString_toLowerCase, new (class extends String { })("abc"));
attempt("String.toLowerCase with its own", callString_toLowerCase, withOwn("abc", "toLowerCase"));
attempt("String.toLowerCase with another prototype", callString_toLowerCase, withOtherPrototype("abc", "toLowerCase"));
attempt("String.toLowerCase with a getter", callString_toLowerCase, withGetter("abc", "toLowerCase"));
attempt("String.toLowerCase a stranger", callString_toLowerCase, stranger("toLowerCase"));
attempt("String.toLowerCase a plain object", callString_toLowerCase, { });
attempt("String.toLowerCase a number", callString_toLowerCase, 5);
attempt("String.toLowerCase a string", callString_toLowerCase, "xyz");
attempt("String.toLowerCase true", callString_toLowerCase, true);
attempt("String.toLowerCase undefined", callString_toLowerCase, undefined);
attempt("String.toLowerCase null", callString_toLowerCase, null);
attempt("String.toLowerCase an array", callString_toLowerCase, [9, 8]);
attempt("String.toLowerCase a frozen one", callString_toLowerCase, Object.freeze("abc"));
attempt("String.toLowerCase watched", callString_toLowerCaseWatched, "abc"); attempt("String.toLowerCase watched, undefined", callString_toLowerCaseWatched, undefined); attempt("String.toLowerCase watched, a stranger", callString_toLowerCaseWatched, stranger("toLowerCase"));
attempt("String.toUpperCase of the class", callString_toUpperCase, "abc");
attempt("String.toUpperCase an heir", callString_toUpperCase, new (class extends String { })("abc"));
attempt("String.toUpperCase with its own", callString_toUpperCase, withOwn("abc", "toUpperCase"));
attempt("String.toUpperCase with another prototype", callString_toUpperCase, withOtherPrototype("abc", "toUpperCase"));
attempt("String.toUpperCase with a getter", callString_toUpperCase, withGetter("abc", "toUpperCase"));
attempt("String.toUpperCase a stranger", callString_toUpperCase, stranger("toUpperCase"));
attempt("String.toUpperCase a plain object", callString_toUpperCase, { });
attempt("String.toUpperCase a number", callString_toUpperCase, 5);
attempt("String.toUpperCase a string", callString_toUpperCase, "xyz");
attempt("String.toUpperCase true", callString_toUpperCase, true);
attempt("String.toUpperCase undefined", callString_toUpperCase, undefined);
attempt("String.toUpperCase null", callString_toUpperCase, null);
attempt("String.toUpperCase an array", callString_toUpperCase, [9, 8]);
attempt("String.toUpperCase a frozen one", callString_toUpperCase, Object.freeze("abc"));
attempt("String.toUpperCase watched", callString_toUpperCaseWatched, "abc"); attempt("String.toUpperCase watched, undefined", callString_toUpperCaseWatched, undefined); attempt("String.toUpperCase watched, a stranger", callString_toUpperCaseWatched, stranger("toUpperCase"));
attempt("String.trim of the class", callString_trim, "abc");
attempt("String.trim an heir", callString_trim, new (class extends String { })("abc"));
attempt("String.trim with its own", callString_trim, withOwn("abc", "trim"));
attempt("String.trim with another prototype", callString_trim, withOtherPrototype("abc", "trim"));
attempt("String.trim with a getter", callString_trim, withGetter("abc", "trim"));
attempt("String.trim a stranger", callString_trim, stranger("trim"));
attempt("String.trim a plain object", callString_trim, { });
attempt("String.trim a number", callString_trim, 5);
attempt("String.trim a string", callString_trim, "xyz");
attempt("String.trim true", callString_trim, true);
attempt("String.trim undefined", callString_trim, undefined);
attempt("String.trim null", callString_trim, null);
attempt("String.trim an array", callString_trim, [9, 8]);
attempt("String.trim a frozen one", callString_trim, Object.freeze("abc"));
attempt("String.trim watched", callString_trimWatched, "abc"); attempt("String.trim watched, undefined", callString_trimWatched, undefined); attempt("String.trim watched, a stranger", callString_trimWatched, stranger("trim"));
attempt("String.trimStart of the class", callString_trimStart, "abc");
attempt("String.trimStart an heir", callString_trimStart, new (class extends String { })("abc"));
attempt("String.trimStart with its own", callString_trimStart, withOwn("abc", "trimStart"));
attempt("String.trimStart with another prototype", callString_trimStart, withOtherPrototype("abc", "trimStart"));
attempt("String.trimStart with a getter", callString_trimStart, withGetter("abc", "trimStart"));
attempt("String.trimStart a stranger", callString_trimStart, stranger("trimStart"));
attempt("String.trimStart a plain object", callString_trimStart, { });
attempt("String.trimStart a number", callString_trimStart, 5);
attempt("String.trimStart a string", callString_trimStart, "xyz");
attempt("String.trimStart true", callString_trimStart, true);
attempt("String.trimStart undefined", callString_trimStart, undefined);
attempt("String.trimStart null", callString_trimStart, null);
attempt("String.trimStart an array", callString_trimStart, [9, 8]);
attempt("String.trimStart a frozen one", callString_trimStart, Object.freeze("abc"));
attempt("String.trimStart watched", callString_trimStartWatched, "abc"); attempt("String.trimStart watched, undefined", callString_trimStartWatched, undefined); attempt("String.trimStart watched, a stranger", callString_trimStartWatched, stranger("trimStart"));
attempt("String.trimEnd of the class", callString_trimEnd, "abc");
attempt("String.trimEnd an heir", callString_trimEnd, new (class extends String { })("abc"));
attempt("String.trimEnd with its own", callString_trimEnd, withOwn("abc", "trimEnd"));
attempt("String.trimEnd with another prototype", callString_trimEnd, withOtherPrototype("abc", "trimEnd"));
attempt("String.trimEnd with a getter", callString_trimEnd, withGetter("abc", "trimEnd"));
attempt("String.trimEnd a stranger", callString_trimEnd, stranger("trimEnd"));
attempt("String.trimEnd a plain object", callString_trimEnd, { });
attempt("String.trimEnd a number", callString_trimEnd, 5);
attempt("String.trimEnd a string", callString_trimEnd, "xyz");
attempt("String.trimEnd true", callString_trimEnd, true);
attempt("String.trimEnd undefined", callString_trimEnd, undefined);
attempt("String.trimEnd null", callString_trimEnd, null);
attempt("String.trimEnd an array", callString_trimEnd, [9, 8]);
attempt("String.trimEnd a frozen one", callString_trimEnd, Object.freeze("abc"));
attempt("String.trimEnd watched", callString_trimEndWatched, "abc"); attempt("String.trimEnd watched, undefined", callString_trimEndWatched, undefined); attempt("String.trimEnd watched, a stranger", callString_trimEndWatched, stranger("trimEnd"));
attempt("String.toString of the class", callString_toString, "abc");
attempt("String.toString an heir", callString_toString, new (class extends String { })("abc"));
attempt("String.toString with its own", callString_toString, withOwn("abc", "toString"));
attempt("String.toString with another prototype", callString_toString, withOtherPrototype("abc", "toString"));
attempt("String.toString with a getter", callString_toString, withGetter("abc", "toString"));
attempt("String.toString a stranger", callString_toString, stranger("toString"));
attempt("String.toString a plain object", callString_toString, { });
attempt("String.toString a number", callString_toString, 5);
attempt("String.toString a string", callString_toString, "xyz");
attempt("String.toString true", callString_toString, true);
attempt("String.toString undefined", callString_toString, undefined);
attempt("String.toString null", callString_toString, null);
attempt("String.toString an array", callString_toString, [9, 8]);
attempt("String.toString a frozen one", callString_toString, Object.freeze("abc"));
attempt("String.toString watched", callString_toStringWatched, "abc"); attempt("String.toString watched, undefined", callString_toStringWatched, undefined); attempt("String.toString watched, a stranger", callString_toStringWatched, stranger("toString"));
attempt("String.valueOf of the class", callString_valueOf, "abc");
attempt("String.valueOf an heir", callString_valueOf, new (class extends String { })("abc"));
attempt("String.valueOf with its own", callString_valueOf, withOwn("abc", "valueOf"));
attempt("String.valueOf with another prototype", callString_valueOf, withOtherPrototype("abc", "valueOf"));
attempt("String.valueOf with a getter", callString_valueOf, withGetter("abc", "valueOf"));
attempt("String.valueOf a stranger", callString_valueOf, stranger("valueOf"));
attempt("String.valueOf a plain object", callString_valueOf, { });
attempt("String.valueOf a number", callString_valueOf, 5);
attempt("String.valueOf a string", callString_valueOf, "xyz");
attempt("String.valueOf true", callString_valueOf, true);
attempt("String.valueOf undefined", callString_valueOf, undefined);
attempt("String.valueOf null", callString_valueOf, null);
attempt("String.valueOf an array", callString_valueOf, [9, 8]);
attempt("String.valueOf a frozen one", callString_valueOf, Object.freeze("abc"));
attempt("String.valueOf watched", callString_valueOfWatched, "abc"); attempt("String.valueOf watched, undefined", callString_valueOfWatched, undefined); attempt("String.valueOf watched, a stranger", callString_valueOfWatched, stranger("valueOf"));
attempt("String.isWellFormed of the class", callString_isWellFormed, "abc");
attempt("String.isWellFormed an heir", callString_isWellFormed, new (class extends String { })("abc"));
attempt("String.isWellFormed with its own", callString_isWellFormed, withOwn("abc", "isWellFormed"));
attempt("String.isWellFormed with another prototype", callString_isWellFormed, withOtherPrototype("abc", "isWellFormed"));
attempt("String.isWellFormed with a getter", callString_isWellFormed, withGetter("abc", "isWellFormed"));
attempt("String.isWellFormed a stranger", callString_isWellFormed, stranger("isWellFormed"));
attempt("String.isWellFormed a plain object", callString_isWellFormed, { });
attempt("String.isWellFormed a number", callString_isWellFormed, 5);
attempt("String.isWellFormed a string", callString_isWellFormed, "xyz");
attempt("String.isWellFormed true", callString_isWellFormed, true);
attempt("String.isWellFormed undefined", callString_isWellFormed, undefined);
attempt("String.isWellFormed null", callString_isWellFormed, null);
attempt("String.isWellFormed an array", callString_isWellFormed, [9, 8]);
attempt("String.isWellFormed a frozen one", callString_isWellFormed, Object.freeze("abc"));
attempt("String.isWellFormed watched", callString_isWellFormedWatched, "abc"); attempt("String.isWellFormed watched, undefined", callString_isWellFormedWatched, undefined); attempt("String.isWellFormed watched, a stranger", callString_isWellFormedWatched, stranger("isWellFormed"));
attempt("String.toLocaleUpperCase of the class", callString_toLocaleUpperCase, "abc");
attempt("String.toLocaleUpperCase an heir", callString_toLocaleUpperCase, new (class extends String { })("abc"));
attempt("String.toLocaleUpperCase with its own", callString_toLocaleUpperCase, withOwn("abc", "toLocaleUpperCase"));
attempt("String.toLocaleUpperCase with another prototype", callString_toLocaleUpperCase, withOtherPrototype("abc", "toLocaleUpperCase"));
attempt("String.toLocaleUpperCase with a getter", callString_toLocaleUpperCase, withGetter("abc", "toLocaleUpperCase"));
attempt("String.toLocaleUpperCase a stranger", callString_toLocaleUpperCase, stranger("toLocaleUpperCase"));
attempt("String.toLocaleUpperCase a plain object", callString_toLocaleUpperCase, { });
attempt("String.toLocaleUpperCase a number", callString_toLocaleUpperCase, 5);
attempt("String.toLocaleUpperCase a string", callString_toLocaleUpperCase, "xyz");
attempt("String.toLocaleUpperCase true", callString_toLocaleUpperCase, true);
attempt("String.toLocaleUpperCase undefined", callString_toLocaleUpperCase, undefined);
attempt("String.toLocaleUpperCase null", callString_toLocaleUpperCase, null);
attempt("String.toLocaleUpperCase an array", callString_toLocaleUpperCase, [9, 8]);
attempt("String.toLocaleUpperCase a frozen one", callString_toLocaleUpperCase, Object.freeze("abc"));
attempt("String.toLocaleUpperCase watched", callString_toLocaleUpperCaseWatched, "abc"); attempt("String.toLocaleUpperCase watched, undefined", callString_toLocaleUpperCaseWatched, undefined); attempt("String.toLocaleUpperCase watched, a stranger", callString_toLocaleUpperCaseWatched, stranger("toLocaleUpperCase"));
attempt("Array.keys of the class", callArray_keys, [1, 2, 3]);
attempt("Array.keys an heir", callArray_keys, ArrayHeir.from([1, 2, 3]));
attempt("Array.keys with its own", callArray_keys, withOwn([1, 2, 3], "keys"));
attempt("Array.keys with another prototype", callArray_keys, withOtherPrototype([1, 2, 3], "keys"));
attempt("Array.keys with a getter", callArray_keys, withGetter([1, 2, 3], "keys"));
attempt("Array.keys a stranger", callArray_keys, stranger("keys"));
attempt("Array.keys a plain object", callArray_keys, { });
attempt("Array.keys a number", callArray_keys, 5);
attempt("Array.keys a string", callArray_keys, "xyz");
attempt("Array.keys true", callArray_keys, true);
attempt("Array.keys undefined", callArray_keys, undefined);
attempt("Array.keys null", callArray_keys, null);
attempt("Array.keys an array", callArray_keys, [9, 8]);
attempt("Array.keys a frozen one", callArray_keys, Object.freeze([1, 2, 3]));
attempt("Array.keys watched", callArray_keysWatched, [1, 2, 3]); attempt("Array.keys watched, undefined", callArray_keysWatched, undefined); attempt("Array.keys watched, a stranger", callArray_keysWatched, stranger("keys"));
attempt("Array.values of the class", callArray_values, [1, 2, 3]);
attempt("Array.values an heir", callArray_values, ArrayHeir.from([1, 2, 3]));
attempt("Array.values with its own", callArray_values, withOwn([1, 2, 3], "values"));
attempt("Array.values with another prototype", callArray_values, withOtherPrototype([1, 2, 3], "values"));
attempt("Array.values with a getter", callArray_values, withGetter([1, 2, 3], "values"));
attempt("Array.values a stranger", callArray_values, stranger("values"));
attempt("Array.values a plain object", callArray_values, { });
attempt("Array.values a number", callArray_values, 5);
attempt("Array.values a string", callArray_values, "xyz");
attempt("Array.values true", callArray_values, true);
attempt("Array.values undefined", callArray_values, undefined);
attempt("Array.values null", callArray_values, null);
attempt("Array.values an array", callArray_values, [9, 8]);
attempt("Array.values a frozen one", callArray_values, Object.freeze([1, 2, 3]));
attempt("Array.values watched", callArray_valuesWatched, [1, 2, 3]); attempt("Array.values watched, undefined", callArray_valuesWatched, undefined); attempt("Array.values watched, a stranger", callArray_valuesWatched, stranger("values"));
attempt("Array.entries of the class", callArray_entries, [1, 2, 3]);
attempt("Array.entries an heir", callArray_entries, ArrayHeir.from([1, 2, 3]));
attempt("Array.entries with its own", callArray_entries, withOwn([1, 2, 3], "entries"));
attempt("Array.entries with another prototype", callArray_entries, withOtherPrototype([1, 2, 3], "entries"));
attempt("Array.entries with a getter", callArray_entries, withGetter([1, 2, 3], "entries"));
attempt("Array.entries a stranger", callArray_entries, stranger("entries"));
attempt("Array.entries a plain object", callArray_entries, { });
attempt("Array.entries a number", callArray_entries, 5);
attempt("Array.entries a string", callArray_entries, "xyz");
attempt("Array.entries true", callArray_entries, true);
attempt("Array.entries undefined", callArray_entries, undefined);
attempt("Array.entries null", callArray_entries, null);
attempt("Array.entries an array", callArray_entries, [9, 8]);
attempt("Array.entries a frozen one", callArray_entries, Object.freeze([1, 2, 3]));
attempt("Array.entries watched", callArray_entriesWatched, [1, 2, 3]); attempt("Array.entries watched, undefined", callArray_entriesWatched, undefined); attempt("Array.entries watched, a stranger", callArray_entriesWatched, stranger("entries"));
attempt("Array.copyWithin of the class", callArray_copyWithin, [1, 2, 3]);
attempt("Array.copyWithin an heir", callArray_copyWithin, ArrayHeir.from([1, 2, 3]));
attempt("Array.copyWithin with its own", callArray_copyWithin, withOwn([1, 2, 3], "copyWithin"));
attempt("Array.copyWithin with another prototype", callArray_copyWithin, withOtherPrototype([1, 2, 3], "copyWithin"));
attempt("Array.copyWithin with a getter", callArray_copyWithin, withGetter([1, 2, 3], "copyWithin"));
attempt("Array.copyWithin a stranger", callArray_copyWithin, stranger("copyWithin"));
attempt("Array.copyWithin a plain object", callArray_copyWithin, { });
attempt("Array.copyWithin a number", callArray_copyWithin, 5);
attempt("Array.copyWithin a string", callArray_copyWithin, "xyz");
attempt("Array.copyWithin true", callArray_copyWithin, true);
attempt("Array.copyWithin undefined", callArray_copyWithin, undefined);
attempt("Array.copyWithin null", callArray_copyWithin, null);
attempt("Array.copyWithin an array", callArray_copyWithin, [9, 8]);
attempt("Array.copyWithin a frozen one", callArray_copyWithin, Object.freeze([1, 2, 3]));
attempt("Array.copyWithin watched", callArray_copyWithinWatched, [1, 2, 3]); attempt("Array.copyWithin watched, undefined", callArray_copyWithinWatched, undefined); attempt("Array.copyWithin watched, a stranger", callArray_copyWithinWatched, stranger("copyWithin"));
attempt("Array.flat of the class", callArray_flat, [1, 2, 3]);
attempt("Array.flat an heir", callArray_flat, ArrayHeir.from([1, 2, 3]));
attempt("Array.flat with its own", callArray_flat, withOwn([1, 2, 3], "flat"));
attempt("Array.flat with another prototype", callArray_flat, withOtherPrototype([1, 2, 3], "flat"));
attempt("Array.flat with a getter", callArray_flat, withGetter([1, 2, 3], "flat"));
attempt("Array.flat a stranger", callArray_flat, stranger("flat"));
attempt("Array.flat a plain object", callArray_flat, { });
attempt("Array.flat a number", callArray_flat, 5);
attempt("Array.flat a string", callArray_flat, "xyz");
attempt("Array.flat true", callArray_flat, true);
attempt("Array.flat undefined", callArray_flat, undefined);
attempt("Array.flat null", callArray_flat, null);
attempt("Array.flat an array", callArray_flat, [9, 8]);
attempt("Array.flat a frozen one", callArray_flat, Object.freeze([1, 2, 3]));
attempt("Array.flat watched", callArray_flatWatched, [1, 2, 3]); attempt("Array.flat watched, undefined", callArray_flatWatched, undefined); attempt("Array.flat watched, a stranger", callArray_flatWatched, stranger("flat"));
attempt("Array.lastIndexOf of the class", callArray_lastIndexOf, [1, 2, 3]);
attempt("Array.lastIndexOf an heir", callArray_lastIndexOf, ArrayHeir.from([1, 2, 3]));
attempt("Array.lastIndexOf with its own", callArray_lastIndexOf, withOwn([1, 2, 3], "lastIndexOf"));
attempt("Array.lastIndexOf with another prototype", callArray_lastIndexOf, withOtherPrototype([1, 2, 3], "lastIndexOf"));
attempt("Array.lastIndexOf with a getter", callArray_lastIndexOf, withGetter([1, 2, 3], "lastIndexOf"));
attempt("Array.lastIndexOf a stranger", callArray_lastIndexOf, stranger("lastIndexOf"));
attempt("Array.lastIndexOf a plain object", callArray_lastIndexOf, { });
attempt("Array.lastIndexOf a number", callArray_lastIndexOf, 5);
attempt("Array.lastIndexOf a string", callArray_lastIndexOf, "xyz");
attempt("Array.lastIndexOf true", callArray_lastIndexOf, true);
attempt("Array.lastIndexOf undefined", callArray_lastIndexOf, undefined);
attempt("Array.lastIndexOf null", callArray_lastIndexOf, null);
attempt("Array.lastIndexOf an array", callArray_lastIndexOf, [9, 8]);
attempt("Array.lastIndexOf a frozen one", callArray_lastIndexOf, Object.freeze([1, 2, 3]));
attempt("Array.lastIndexOf watched", callArray_lastIndexOfWatched, [1, 2, 3]); attempt("Array.lastIndexOf watched, undefined", callArray_lastIndexOfWatched, undefined); attempt("Array.lastIndexOf watched, a stranger", callArray_lastIndexOfWatched, stranger("lastIndexOf"));
attempt("Array.toSpliced of the class", callArray_toSpliced, [1, 2, 3]);
attempt("Array.toSpliced an heir", callArray_toSpliced, ArrayHeir.from([1, 2, 3]));
attempt("Array.toSpliced with its own", callArray_toSpliced, withOwn([1, 2, 3], "toSpliced"));
attempt("Array.toSpliced with another prototype", callArray_toSpliced, withOtherPrototype([1, 2, 3], "toSpliced"));
attempt("Array.toSpliced with a getter", callArray_toSpliced, withGetter([1, 2, 3], "toSpliced"));
attempt("Array.toSpliced a stranger", callArray_toSpliced, stranger("toSpliced"));
attempt("Array.toSpliced a plain object", callArray_toSpliced, { });
attempt("Array.toSpliced a number", callArray_toSpliced, 5);
attempt("Array.toSpliced a string", callArray_toSpliced, "xyz");
attempt("Array.toSpliced true", callArray_toSpliced, true);
attempt("Array.toSpliced undefined", callArray_toSpliced, undefined);
attempt("Array.toSpliced null", callArray_toSpliced, null);
attempt("Array.toSpliced an array", callArray_toSpliced, [9, 8]);
attempt("Array.toSpliced a frozen one", callArray_toSpliced, Object.freeze([1, 2, 3]));
attempt("Array.toSpliced watched", callArray_toSplicedWatched, [1, 2, 3]); attempt("Array.toSpliced watched, undefined", callArray_toSplicedWatched, undefined); attempt("Array.toSpliced watched, a stranger", callArray_toSplicedWatched, stranger("toSpliced"));
attempt("Array.with of the class", callArray_with, [1, 2, 3]);
attempt("Array.with an heir", callArray_with, ArrayHeir.from([1, 2, 3]));
attempt("Array.with with its own", callArray_with, withOwn([1, 2, 3], "with"));
attempt("Array.with with another prototype", callArray_with, withOtherPrototype([1, 2, 3], "with"));
attempt("Array.with with a getter", callArray_with, withGetter([1, 2, 3], "with"));
attempt("Array.with a stranger", callArray_with, stranger("with"));
attempt("Array.with a plain object", callArray_with, { });
attempt("Array.with a number", callArray_with, 5);
attempt("Array.with a string", callArray_with, "xyz");
attempt("Array.with true", callArray_with, true);
attempt("Array.with undefined", callArray_with, undefined);
attempt("Array.with null", callArray_with, null);
attempt("Array.with an array", callArray_with, [9, 8]);
attempt("Array.with a frozen one", callArray_with, Object.freeze([1, 2, 3]));
attempt("Array.with watched", callArray_withWatched, [1, 2, 3]); attempt("Array.with watched, undefined", callArray_withWatched, undefined); attempt("Array.with watched, a stranger", callArray_withWatched, stranger("with"));
attempt("Array.toReversed of the class", callArray_toReversed, [1, 2, 3]);
attempt("Array.toReversed an heir", callArray_toReversed, ArrayHeir.from([1, 2, 3]));
attempt("Array.toReversed with its own", callArray_toReversed, withOwn([1, 2, 3], "toReversed"));
attempt("Array.toReversed with another prototype", callArray_toReversed, withOtherPrototype([1, 2, 3], "toReversed"));
attempt("Array.toReversed with a getter", callArray_toReversed, withGetter([1, 2, 3], "toReversed"));
attempt("Array.toReversed a stranger", callArray_toReversed, stranger("toReversed"));
attempt("Array.toReversed a plain object", callArray_toReversed, { });
attempt("Array.toReversed a number", callArray_toReversed, 5);
attempt("Array.toReversed a string", callArray_toReversed, "xyz");
attempt("Array.toReversed true", callArray_toReversed, true);
attempt("Array.toReversed undefined", callArray_toReversed, undefined);
attempt("Array.toReversed null", callArray_toReversed, null);
attempt("Array.toReversed an array", callArray_toReversed, [9, 8]);
attempt("Array.toReversed a frozen one", callArray_toReversed, Object.freeze([1, 2, 3]));
attempt("Array.toReversed watched", callArray_toReversedWatched, [1, 2, 3]); attempt("Array.toReversed watched, undefined", callArray_toReversedWatched, undefined); attempt("Array.toReversed watched, a stranger", callArray_toReversedWatched, stranger("toReversed"));
attempt("Array.toSorted of the class", callArray_toSorted, [1, 2, 3]);
attempt("Array.toSorted an heir", callArray_toSorted, ArrayHeir.from([1, 2, 3]));
attempt("Array.toSorted with its own", callArray_toSorted, withOwn([1, 2, 3], "toSorted"));
attempt("Array.toSorted with another prototype", callArray_toSorted, withOtherPrototype([1, 2, 3], "toSorted"));
attempt("Array.toSorted with a getter", callArray_toSorted, withGetter([1, 2, 3], "toSorted"));
attempt("Array.toSorted a stranger", callArray_toSorted, stranger("toSorted"));
attempt("Array.toSorted a plain object", callArray_toSorted, { });
attempt("Array.toSorted a number", callArray_toSorted, 5);
attempt("Array.toSorted a string", callArray_toSorted, "xyz");
attempt("Array.toSorted true", callArray_toSorted, true);
attempt("Array.toSorted undefined", callArray_toSorted, undefined);
attempt("Array.toSorted null", callArray_toSorted, null);
attempt("Array.toSorted an array", callArray_toSorted, [9, 8]);
attempt("Array.toSorted a frozen one", callArray_toSorted, Object.freeze([1, 2, 3]));
attempt("Array.toSorted watched", callArray_toSortedWatched, [1, 2, 3]); attempt("Array.toSorted watched, undefined", callArray_toSortedWatched, undefined); attempt("Array.toSorted watched, a stranger", callArray_toSortedWatched, stranger("toSorted"));
attempt("Array.fill of the class", callArray_fill, [1, 2, 3]);
attempt("Array.fill an heir", callArray_fill, ArrayHeir.from([1, 2, 3]));
attempt("Array.fill with its own", callArray_fill, withOwn([1, 2, 3], "fill"));
attempt("Array.fill with another prototype", callArray_fill, withOtherPrototype([1, 2, 3], "fill"));
attempt("Array.fill with a getter", callArray_fill, withGetter([1, 2, 3], "fill"));
attempt("Array.fill a stranger", callArray_fill, stranger("fill"));
attempt("Array.fill a plain object", callArray_fill, { });
attempt("Array.fill a number", callArray_fill, 5);
attempt("Array.fill a string", callArray_fill, "xyz");
attempt("Array.fill true", callArray_fill, true);
attempt("Array.fill undefined", callArray_fill, undefined);
attempt("Array.fill null", callArray_fill, null);
attempt("Array.fill an array", callArray_fill, [9, 8]);
attempt("Array.fill a frozen one", callArray_fill, Object.freeze([1, 2, 3]));
attempt("Array.fill watched", callArray_fillWatched, [1, 2, 3]); attempt("Array.fill watched, undefined", callArray_fillWatched, undefined); attempt("Array.fill watched, a stranger", callArray_fillWatched, stranger("fill"));
attempt("Array.reverse of the class", callArray_reverse, [1, 2, 3]);
attempt("Array.reverse an heir", callArray_reverse, ArrayHeir.from([1, 2, 3]));
attempt("Array.reverse with its own", callArray_reverse, withOwn([1, 2, 3], "reverse"));
attempt("Array.reverse with another prototype", callArray_reverse, withOtherPrototype([1, 2, 3], "reverse"));
attempt("Array.reverse with a getter", callArray_reverse, withGetter([1, 2, 3], "reverse"));
attempt("Array.reverse a stranger", callArray_reverse, stranger("reverse"));
attempt("Array.reverse a plain object", callArray_reverse, { });
attempt("Array.reverse a number", callArray_reverse, 5);
attempt("Array.reverse a string", callArray_reverse, "xyz");
attempt("Array.reverse true", callArray_reverse, true);
attempt("Array.reverse undefined", callArray_reverse, undefined);
attempt("Array.reverse null", callArray_reverse, null);
attempt("Array.reverse an array", callArray_reverse, [9, 8]);
attempt("Array.reverse a frozen one", callArray_reverse, Object.freeze([1, 2, 3]));
attempt("Array.reverse watched", callArray_reverseWatched, [1, 2, 3]); attempt("Array.reverse watched, undefined", callArray_reverseWatched, undefined); attempt("Array.reverse watched, a stranger", callArray_reverseWatched, stranger("reverse"));
attempt("Array.shift of the class", callArray_shift, [1, 2, 3]);
attempt("Array.shift an heir", callArray_shift, ArrayHeir.from([1, 2, 3]));
attempt("Array.shift with its own", callArray_shift, withOwn([1, 2, 3], "shift"));
attempt("Array.shift with another prototype", callArray_shift, withOtherPrototype([1, 2, 3], "shift"));
attempt("Array.shift with a getter", callArray_shift, withGetter([1, 2, 3], "shift"));
attempt("Array.shift a stranger", callArray_shift, stranger("shift"));
attempt("Array.shift a plain object", callArray_shift, { });
attempt("Array.shift a number", callArray_shift, 5);
attempt("Array.shift a string", callArray_shift, "xyz");
attempt("Array.shift true", callArray_shift, true);
attempt("Array.shift undefined", callArray_shift, undefined);
attempt("Array.shift null", callArray_shift, null);
attempt("Array.shift an array", callArray_shift, [9, 8]);
attempt("Array.shift a frozen one", callArray_shift, Object.freeze([1, 2, 3]));
attempt("Array.shift watched", callArray_shiftWatched, [1, 2, 3]); attempt("Array.shift watched, undefined", callArray_shiftWatched, undefined); attempt("Array.shift watched, a stranger", callArray_shiftWatched, stranger("shift"));
attempt("Array.unshift of the class", callArray_unshift, [1, 2, 3]);
attempt("Array.unshift an heir", callArray_unshift, ArrayHeir.from([1, 2, 3]));
attempt("Array.unshift with its own", callArray_unshift, withOwn([1, 2, 3], "unshift"));
attempt("Array.unshift with another prototype", callArray_unshift, withOtherPrototype([1, 2, 3], "unshift"));
attempt("Array.unshift with a getter", callArray_unshift, withGetter([1, 2, 3], "unshift"));
attempt("Array.unshift a stranger", callArray_unshift, stranger("unshift"));
attempt("Array.unshift a plain object", callArray_unshift, { });
attempt("Array.unshift a number", callArray_unshift, 5);
attempt("Array.unshift a string", callArray_unshift, "xyz");
attempt("Array.unshift true", callArray_unshift, true);
attempt("Array.unshift undefined", callArray_unshift, undefined);
attempt("Array.unshift null", callArray_unshift, null);
attempt("Array.unshift an array", callArray_unshift, [9, 8]);
attempt("Array.unshift a frozen one", callArray_unshift, Object.freeze([1, 2, 3]));
attempt("Array.unshift watched", callArray_unshiftWatched, [1, 2, 3]); attempt("Array.unshift watched, undefined", callArray_unshiftWatched, undefined); attempt("Array.unshift watched, a stranger", callArray_unshiftWatched, stranger("unshift"));
attempt("Array.splice of the class", callArray_splice, [1, 2, 3]);
attempt("Array.splice an heir", callArray_splice, ArrayHeir.from([1, 2, 3]));
attempt("Array.splice with its own", callArray_splice, withOwn([1, 2, 3], "splice"));
attempt("Array.splice with another prototype", callArray_splice, withOtherPrototype([1, 2, 3], "splice"));
attempt("Array.splice with a getter", callArray_splice, withGetter([1, 2, 3], "splice"));
attempt("Array.splice a stranger", callArray_splice, stranger("splice"));
attempt("Array.splice a plain object", callArray_splice, { });
attempt("Array.splice a number", callArray_splice, 5);
attempt("Array.splice a string", callArray_splice, "xyz");
attempt("Array.splice true", callArray_splice, true);
attempt("Array.splice undefined", callArray_splice, undefined);
attempt("Array.splice null", callArray_splice, null);
attempt("Array.splice an array", callArray_splice, [9, 8]);
attempt("Array.splice a frozen one", callArray_splice, Object.freeze([1, 2, 3]));
attempt("Array.splice watched", callArray_spliceWatched, [1, 2, 3]); attempt("Array.splice watched, undefined", callArray_spliceWatched, undefined); attempt("Array.splice watched, a stranger", callArray_spliceWatched, stranger("splice"));
attempt("Array.concat of the class", callArray_concat, [1, 2, 3]);
attempt("Array.concat an heir", callArray_concat, ArrayHeir.from([1, 2, 3]));
attempt("Array.concat with its own", callArray_concat, withOwn([1, 2, 3], "concat"));
attempt("Array.concat with another prototype", callArray_concat, withOtherPrototype([1, 2, 3], "concat"));
attempt("Array.concat with a getter", callArray_concat, withGetter([1, 2, 3], "concat"));
attempt("Array.concat a stranger", callArray_concat, stranger("concat"));
attempt("Array.concat a plain object", callArray_concat, { });
attempt("Array.concat a number", callArray_concat, 5);
attempt("Array.concat a string", callArray_concat, "xyz");
attempt("Array.concat true", callArray_concat, true);
attempt("Array.concat undefined", callArray_concat, undefined);
attempt("Array.concat null", callArray_concat, null);
attempt("Array.concat an array", callArray_concat, [9, 8]);
attempt("Array.concat a frozen one", callArray_concat, Object.freeze([1, 2, 3]));
attempt("Array.concat watched", callArray_concatWatched, [1, 2, 3]); attempt("Array.concat watched, undefined", callArray_concatWatched, undefined); attempt("Array.concat watched, a stranger", callArray_concatWatched, stranger("concat"));
attempt("Array.join of the class", callArray_join, [1, 2, 3]);
attempt("Array.join an heir", callArray_join, ArrayHeir.from([1, 2, 3]));
attempt("Array.join with its own", callArray_join, withOwn([1, 2, 3], "join"));
attempt("Array.join with another prototype", callArray_join, withOtherPrototype([1, 2, 3], "join"));
attempt("Array.join with a getter", callArray_join, withGetter([1, 2, 3], "join"));
attempt("Array.join a stranger", callArray_join, stranger("join"));
attempt("Array.join a plain object", callArray_join, { });
attempt("Array.join a number", callArray_join, 5);
attempt("Array.join a string", callArray_join, "xyz");
attempt("Array.join true", callArray_join, true);
attempt("Array.join undefined", callArray_join, undefined);
attempt("Array.join null", callArray_join, null);
attempt("Array.join an array", callArray_join, [9, 8]);
attempt("Array.join a frozen one", callArray_join, Object.freeze([1, 2, 3]));
attempt("Array.join watched", callArray_joinWatched, [1, 2, 3]); attempt("Array.join watched, undefined", callArray_joinWatched, undefined); attempt("Array.join watched, a stranger", callArray_joinWatched, stranger("join"));
attempt("Array.slice of the class", callArray_slice, [1, 2, 3]);
attempt("Array.slice an heir", callArray_slice, ArrayHeir.from([1, 2, 3]));
attempt("Array.slice with its own", callArray_slice, withOwn([1, 2, 3], "slice"));
attempt("Array.slice with another prototype", callArray_slice, withOtherPrototype([1, 2, 3], "slice"));
attempt("Array.slice with a getter", callArray_slice, withGetter([1, 2, 3], "slice"));
attempt("Array.slice a stranger", callArray_slice, stranger("slice"));
attempt("Array.slice a plain object", callArray_slice, { });
attempt("Array.slice a number", callArray_slice, 5);
attempt("Array.slice a string", callArray_slice, "xyz");
attempt("Array.slice true", callArray_slice, true);
attempt("Array.slice undefined", callArray_slice, undefined);
attempt("Array.slice null", callArray_slice, null);
attempt("Array.slice an array", callArray_slice, [9, 8]);
attempt("Array.slice a frozen one", callArray_slice, Object.freeze([1, 2, 3]));
attempt("Array.slice watched", callArray_sliceWatched, [1, 2, 3]); attempt("Array.slice watched, undefined", callArray_sliceWatched, undefined); attempt("Array.slice watched, a stranger", callArray_sliceWatched, stranger("slice"));
attempt("Array.indexOf of the class", callArray_indexOf, [1, 2, 3]);
attempt("Array.indexOf an heir", callArray_indexOf, ArrayHeir.from([1, 2, 3]));
attempt("Array.indexOf with its own", callArray_indexOf, withOwn([1, 2, 3], "indexOf"));
attempt("Array.indexOf with another prototype", callArray_indexOf, withOtherPrototype([1, 2, 3], "indexOf"));
attempt("Array.indexOf with a getter", callArray_indexOf, withGetter([1, 2, 3], "indexOf"));
attempt("Array.indexOf a stranger", callArray_indexOf, stranger("indexOf"));
attempt("Array.indexOf a plain object", callArray_indexOf, { });
attempt("Array.indexOf a number", callArray_indexOf, 5);
attempt("Array.indexOf a string", callArray_indexOf, "xyz");
attempt("Array.indexOf true", callArray_indexOf, true);
attempt("Array.indexOf undefined", callArray_indexOf, undefined);
attempt("Array.indexOf null", callArray_indexOf, null);
attempt("Array.indexOf an array", callArray_indexOf, [9, 8]);
attempt("Array.indexOf a frozen one", callArray_indexOf, Object.freeze([1, 2, 3]));
attempt("Array.indexOf watched", callArray_indexOfWatched, [1, 2, 3]); attempt("Array.indexOf watched, undefined", callArray_indexOfWatched, undefined); attempt("Array.indexOf watched, a stranger", callArray_indexOfWatched, stranger("indexOf"));
attempt("Array.includes of the class", callArray_includes, [1, 2, 3]);
attempt("Array.includes an heir", callArray_includes, ArrayHeir.from([1, 2, 3]));
attempt("Array.includes with its own", callArray_includes, withOwn([1, 2, 3], "includes"));
attempt("Array.includes with another prototype", callArray_includes, withOtherPrototype([1, 2, 3], "includes"));
attempt("Array.includes with a getter", callArray_includes, withGetter([1, 2, 3], "includes"));
attempt("Array.includes a stranger", callArray_includes, stranger("includes"));
attempt("Array.includes a plain object", callArray_includes, { });
attempt("Array.includes a number", callArray_includes, 5);
attempt("Array.includes a string", callArray_includes, "xyz");
attempt("Array.includes true", callArray_includes, true);
attempt("Array.includes undefined", callArray_includes, undefined);
attempt("Array.includes null", callArray_includes, null);
attempt("Array.includes an array", callArray_includes, [9, 8]);
attempt("Array.includes a frozen one", callArray_includes, Object.freeze([1, 2, 3]));
attempt("Array.includes watched", callArray_includesWatched, [1, 2, 3]); attempt("Array.includes watched, undefined", callArray_includesWatched, undefined); attempt("Array.includes watched, a stranger", callArray_includesWatched, stranger("includes"));
attempt("Array.at of the class", callArray_at, [1, 2, 3]);
attempt("Array.at an heir", callArray_at, ArrayHeir.from([1, 2, 3]));
attempt("Array.at with its own", callArray_at, withOwn([1, 2, 3], "at"));
attempt("Array.at with another prototype", callArray_at, withOtherPrototype([1, 2, 3], "at"));
attempt("Array.at with a getter", callArray_at, withGetter([1, 2, 3], "at"));
attempt("Array.at a stranger", callArray_at, stranger("at"));
attempt("Array.at a plain object", callArray_at, { });
attempt("Array.at a number", callArray_at, 5);
attempt("Array.at a string", callArray_at, "xyz");
attempt("Array.at true", callArray_at, true);
attempt("Array.at undefined", callArray_at, undefined);
attempt("Array.at null", callArray_at, null);
attempt("Array.at an array", callArray_at, [9, 8]);
attempt("Array.at a frozen one", callArray_at, Object.freeze([1, 2, 3]));
attempt("Array.at watched", callArray_atWatched, [1, 2, 3]); attempt("Array.at watched, undefined", callArray_atWatched, undefined); attempt("Array.at watched, a stranger", callArray_atWatched, stranger("at"));
attempt("Array.pop of the class", callArray_pop, [1, 2, 3]);
attempt("Array.pop an heir", callArray_pop, ArrayHeir.from([1, 2, 3]));
attempt("Array.pop with its own", callArray_pop, withOwn([1, 2, 3], "pop"));
attempt("Array.pop with another prototype", callArray_pop, withOtherPrototype([1, 2, 3], "pop"));
attempt("Array.pop with a getter", callArray_pop, withGetter([1, 2, 3], "pop"));
attempt("Array.pop a stranger", callArray_pop, stranger("pop"));
attempt("Array.pop a plain object", callArray_pop, { });
attempt("Array.pop a number", callArray_pop, 5);
attempt("Array.pop a string", callArray_pop, "xyz");
attempt("Array.pop true", callArray_pop, true);
attempt("Array.pop undefined", callArray_pop, undefined);
attempt("Array.pop null", callArray_pop, null);
attempt("Array.pop an array", callArray_pop, [9, 8]);
attempt("Array.pop a frozen one", callArray_pop, Object.freeze([1, 2, 3]));
attempt("Array.pop watched", callArray_popWatched, [1, 2, 3]); attempt("Array.pop watched, undefined", callArray_popWatched, undefined); attempt("Array.pop watched, a stranger", callArray_popWatched, stranger("pop"));
attempt("Array.push of the class", callArray_push, [1, 2, 3]);
attempt("Array.push an heir", callArray_push, ArrayHeir.from([1, 2, 3]));
attempt("Array.push with its own", callArray_push, withOwn([1, 2, 3], "push"));
attempt("Array.push with another prototype", callArray_push, withOtherPrototype([1, 2, 3], "push"));
attempt("Array.push with a getter", callArray_push, withGetter([1, 2, 3], "push"));
attempt("Array.push a stranger", callArray_push, stranger("push"));
attempt("Array.push a plain object", callArray_push, { });
attempt("Array.push a number", callArray_push, 5);
attempt("Array.push a string", callArray_push, "xyz");
attempt("Array.push true", callArray_push, true);
attempt("Array.push undefined", callArray_push, undefined);
attempt("Array.push null", callArray_push, null);
attempt("Array.push an array", callArray_push, [9, 8]);
attempt("Array.push a frozen one", callArray_push, Object.freeze([1, 2, 3]));
attempt("Array.push watched", callArray_pushWatched, [1, 2, 3]); attempt("Array.push watched, undefined", callArray_pushWatched, undefined); attempt("Array.push watched, a stranger", callArray_pushWatched, stranger("push"));
attempt("Array.toString of the class", callArray_toString, [1, 2, 3]);
attempt("Array.toString an heir", callArray_toString, ArrayHeir.from([1, 2, 3]));
attempt("Array.toString with its own", callArray_toString, withOwn([1, 2, 3], "toString"));
attempt("Array.toString with another prototype", callArray_toString, withOtherPrototype([1, 2, 3], "toString"));
attempt("Array.toString with a getter", callArray_toString, withGetter([1, 2, 3], "toString"));
attempt("Array.toString a stranger", callArray_toString, stranger("toString"));
attempt("Array.toString a plain object", callArray_toString, { });
attempt("Array.toString a number", callArray_toString, 5);
attempt("Array.toString a string", callArray_toString, "xyz");
attempt("Array.toString true", callArray_toString, true);
attempt("Array.toString undefined", callArray_toString, undefined);
attempt("Array.toString null", callArray_toString, null);
attempt("Array.toString an array", callArray_toString, [9, 8]);
attempt("Array.toString a frozen one", callArray_toString, Object.freeze([1, 2, 3]));
attempt("Array.toString watched", callArray_toStringWatched, [1, 2, 3]); attempt("Array.toString watched, undefined", callArray_toStringWatched, undefined); attempt("Array.toString watched, a stranger", callArray_toStringWatched, stranger("toString"));
attempt("Array.toLocaleString of the class", callArray_toLocaleString, [1, 2, 3]);
attempt("Array.toLocaleString an heir", callArray_toLocaleString, ArrayHeir.from([1, 2, 3]));
attempt("Array.toLocaleString with its own", callArray_toLocaleString, withOwn([1, 2, 3], "toLocaleString"));
attempt("Array.toLocaleString with another prototype", callArray_toLocaleString, withOtherPrototype([1, 2, 3], "toLocaleString"));
attempt("Array.toLocaleString with a getter", callArray_toLocaleString, withGetter([1, 2, 3], "toLocaleString"));
attempt("Array.toLocaleString a stranger", callArray_toLocaleString, stranger("toLocaleString"));
attempt("Array.toLocaleString a plain object", callArray_toLocaleString, { });
attempt("Array.toLocaleString a number", callArray_toLocaleString, 5);
attempt("Array.toLocaleString a string", callArray_toLocaleString, "xyz");
attempt("Array.toLocaleString true", callArray_toLocaleString, true);
attempt("Array.toLocaleString undefined", callArray_toLocaleString, undefined);
attempt("Array.toLocaleString null", callArray_toLocaleString, null);
attempt("Array.toLocaleString an array", callArray_toLocaleString, [9, 8]);
attempt("Array.toLocaleString a frozen one", callArray_toLocaleString, Object.freeze([1, 2, 3]));
attempt("Array.toLocaleString watched", callArray_toLocaleStringWatched, [1, 2, 3]); attempt("Array.toLocaleString watched, undefined", callArray_toLocaleStringWatched, undefined); attempt("Array.toLocaleString watched, a stranger", callArray_toLocaleStringWatched, stranger("toLocaleString"));
attempt("Map.get of the class", callMap_get, new Map([["a", 1], ["b", 2]]));
attempt("Map.get an heir", callMap_get, new (class extends Map<any, any> { })([["a", 1]]));
attempt("Map.get with its own", callMap_get, withOwn(new Map([["a", 1], ["b", 2]]), "get"));
attempt("Map.get with another prototype", callMap_get, withOtherPrototype(new Map([["a", 1], ["b", 2]]), "get"));
attempt("Map.get with a getter", callMap_get, withGetter(new Map([["a", 1], ["b", 2]]), "get"));
attempt("Map.get a stranger", callMap_get, stranger("get"));
attempt("Map.get a plain object", callMap_get, { });
attempt("Map.get a number", callMap_get, 5);
attempt("Map.get a string", callMap_get, "xyz");
attempt("Map.get true", callMap_get, true);
attempt("Map.get undefined", callMap_get, undefined);
attempt("Map.get null", callMap_get, null);
attempt("Map.get an array", callMap_get, [9, 8]);
attempt("Map.get a frozen one", callMap_get, Object.freeze(new Map([["a", 1], ["b", 2]])));
attempt("Map.get watched", callMap_getWatched, new Map([["a", 1], ["b", 2]])); attempt("Map.get watched, undefined", callMap_getWatched, undefined); attempt("Map.get watched, a stranger", callMap_getWatched, stranger("get"));
attempt("Map.has of the class", callMap_has, new Map([["a", 1], ["b", 2]]));
attempt("Map.has an heir", callMap_has, new (class extends Map<any, any> { })([["a", 1]]));
attempt("Map.has with its own", callMap_has, withOwn(new Map([["a", 1], ["b", 2]]), "has"));
attempt("Map.has with another prototype", callMap_has, withOtherPrototype(new Map([["a", 1], ["b", 2]]), "has"));
attempt("Map.has with a getter", callMap_has, withGetter(new Map([["a", 1], ["b", 2]]), "has"));
attempt("Map.has a stranger", callMap_has, stranger("has"));
attempt("Map.has a plain object", callMap_has, { });
attempt("Map.has a number", callMap_has, 5);
attempt("Map.has a string", callMap_has, "xyz");
attempt("Map.has true", callMap_has, true);
attempt("Map.has undefined", callMap_has, undefined);
attempt("Map.has null", callMap_has, null);
attempt("Map.has an array", callMap_has, [9, 8]);
attempt("Map.has a frozen one", callMap_has, Object.freeze(new Map([["a", 1], ["b", 2]])));
attempt("Map.has watched", callMap_hasWatched, new Map([["a", 1], ["b", 2]])); attempt("Map.has watched, undefined", callMap_hasWatched, undefined); attempt("Map.has watched, a stranger", callMap_hasWatched, stranger("has"));
attempt("Map.set of the class", callMap_set, new Map([["a", 1], ["b", 2]]));
attempt("Map.set an heir", callMap_set, new (class extends Map<any, any> { })([["a", 1]]));
attempt("Map.set with its own", callMap_set, withOwn(new Map([["a", 1], ["b", 2]]), "set"));
attempt("Map.set with another prototype", callMap_set, withOtherPrototype(new Map([["a", 1], ["b", 2]]), "set"));
attempt("Map.set with a getter", callMap_set, withGetter(new Map([["a", 1], ["b", 2]]), "set"));
attempt("Map.set a stranger", callMap_set, stranger("set"));
attempt("Map.set a plain object", callMap_set, { });
attempt("Map.set a number", callMap_set, 5);
attempt("Map.set a string", callMap_set, "xyz");
attempt("Map.set true", callMap_set, true);
attempt("Map.set undefined", callMap_set, undefined);
attempt("Map.set null", callMap_set, null);
attempt("Map.set an array", callMap_set, [9, 8]);
attempt("Map.set a frozen one", callMap_set, Object.freeze(new Map([["a", 1], ["b", 2]])));
attempt("Map.set watched", callMap_setWatched, new Map([["a", 1], ["b", 2]])); attempt("Map.set watched, undefined", callMap_setWatched, undefined); attempt("Map.set watched, a stranger", callMap_setWatched, stranger("set"));
attempt("Map.delete of the class", callMap_delete, new Map([["a", 1], ["b", 2]]));
attempt("Map.delete an heir", callMap_delete, new (class extends Map<any, any> { })([["a", 1]]));
attempt("Map.delete with its own", callMap_delete, withOwn(new Map([["a", 1], ["b", 2]]), "delete"));
attempt("Map.delete with another prototype", callMap_delete, withOtherPrototype(new Map([["a", 1], ["b", 2]]), "delete"));
attempt("Map.delete with a getter", callMap_delete, withGetter(new Map([["a", 1], ["b", 2]]), "delete"));
attempt("Map.delete a stranger", callMap_delete, stranger("delete"));
attempt("Map.delete a plain object", callMap_delete, { });
attempt("Map.delete a number", callMap_delete, 5);
attempt("Map.delete a string", callMap_delete, "xyz");
attempt("Map.delete true", callMap_delete, true);
attempt("Map.delete undefined", callMap_delete, undefined);
attempt("Map.delete null", callMap_delete, null);
attempt("Map.delete an array", callMap_delete, [9, 8]);
attempt("Map.delete a frozen one", callMap_delete, Object.freeze(new Map([["a", 1], ["b", 2]])));
attempt("Map.delete watched", callMap_deleteWatched, new Map([["a", 1], ["b", 2]])); attempt("Map.delete watched, undefined", callMap_deleteWatched, undefined); attempt("Map.delete watched, a stranger", callMap_deleteWatched, stranger("delete"));
attempt("Map.keys of the class", callMap_keys, new Map([["a", 1], ["b", 2]]));
attempt("Map.keys an heir", callMap_keys, new (class extends Map<any, any> { })([["a", 1]]));
attempt("Map.keys with its own", callMap_keys, withOwn(new Map([["a", 1], ["b", 2]]), "keys"));
attempt("Map.keys with another prototype", callMap_keys, withOtherPrototype(new Map([["a", 1], ["b", 2]]), "keys"));
attempt("Map.keys with a getter", callMap_keys, withGetter(new Map([["a", 1], ["b", 2]]), "keys"));
attempt("Map.keys a stranger", callMap_keys, stranger("keys"));
attempt("Map.keys a plain object", callMap_keys, { });
attempt("Map.keys a number", callMap_keys, 5);
attempt("Map.keys a string", callMap_keys, "xyz");
attempt("Map.keys true", callMap_keys, true);
attempt("Map.keys undefined", callMap_keys, undefined);
attempt("Map.keys null", callMap_keys, null);
attempt("Map.keys an array", callMap_keys, [9, 8]);
attempt("Map.keys a frozen one", callMap_keys, Object.freeze(new Map([["a", 1], ["b", 2]])));
attempt("Map.keys watched", callMap_keysWatched, new Map([["a", 1], ["b", 2]])); attempt("Map.keys watched, undefined", callMap_keysWatched, undefined); attempt("Map.keys watched, a stranger", callMap_keysWatched, stranger("keys"));
attempt("Map.values of the class", callMap_values, new Map([["a", 1], ["b", 2]]));
attempt("Map.values an heir", callMap_values, new (class extends Map<any, any> { })([["a", 1]]));
attempt("Map.values with its own", callMap_values, withOwn(new Map([["a", 1], ["b", 2]]), "values"));
attempt("Map.values with another prototype", callMap_values, withOtherPrototype(new Map([["a", 1], ["b", 2]]), "values"));
attempt("Map.values with a getter", callMap_values, withGetter(new Map([["a", 1], ["b", 2]]), "values"));
attempt("Map.values a stranger", callMap_values, stranger("values"));
attempt("Map.values a plain object", callMap_values, { });
attempt("Map.values a number", callMap_values, 5);
attempt("Map.values a string", callMap_values, "xyz");
attempt("Map.values true", callMap_values, true);
attempt("Map.values undefined", callMap_values, undefined);
attempt("Map.values null", callMap_values, null);
attempt("Map.values an array", callMap_values, [9, 8]);
attempt("Map.values a frozen one", callMap_values, Object.freeze(new Map([["a", 1], ["b", 2]])));
attempt("Map.values watched", callMap_valuesWatched, new Map([["a", 1], ["b", 2]])); attempt("Map.values watched, undefined", callMap_valuesWatched, undefined); attempt("Map.values watched, a stranger", callMap_valuesWatched, stranger("values"));
attempt("Map.entries of the class", callMap_entries, new Map([["a", 1], ["b", 2]]));
attempt("Map.entries an heir", callMap_entries, new (class extends Map<any, any> { })([["a", 1]]));
attempt("Map.entries with its own", callMap_entries, withOwn(new Map([["a", 1], ["b", 2]]), "entries"));
attempt("Map.entries with another prototype", callMap_entries, withOtherPrototype(new Map([["a", 1], ["b", 2]]), "entries"));
attempt("Map.entries with a getter", callMap_entries, withGetter(new Map([["a", 1], ["b", 2]]), "entries"));
attempt("Map.entries a stranger", callMap_entries, stranger("entries"));
attempt("Map.entries a plain object", callMap_entries, { });
attempt("Map.entries a number", callMap_entries, 5);
attempt("Map.entries a string", callMap_entries, "xyz");
attempt("Map.entries true", callMap_entries, true);
attempt("Map.entries undefined", callMap_entries, undefined);
attempt("Map.entries null", callMap_entries, null);
attempt("Map.entries an array", callMap_entries, [9, 8]);
attempt("Map.entries a frozen one", callMap_entries, Object.freeze(new Map([["a", 1], ["b", 2]])));
attempt("Map.entries watched", callMap_entriesWatched, new Map([["a", 1], ["b", 2]])); attempt("Map.entries watched, undefined", callMap_entriesWatched, undefined); attempt("Map.entries watched, a stranger", callMap_entriesWatched, stranger("entries"));
attempt("Map.clear of the class", callMap_clear, new Map([["a", 1], ["b", 2]]));
attempt("Map.clear an heir", callMap_clear, new (class extends Map<any, any> { })([["a", 1]]));
attempt("Map.clear with its own", callMap_clear, withOwn(new Map([["a", 1], ["b", 2]]), "clear"));
attempt("Map.clear with another prototype", callMap_clear, withOtherPrototype(new Map([["a", 1], ["b", 2]]), "clear"));
attempt("Map.clear with a getter", callMap_clear, withGetter(new Map([["a", 1], ["b", 2]]), "clear"));
attempt("Map.clear a stranger", callMap_clear, stranger("clear"));
attempt("Map.clear a plain object", callMap_clear, { });
attempt("Map.clear a number", callMap_clear, 5);
attempt("Map.clear a string", callMap_clear, "xyz");
attempt("Map.clear true", callMap_clear, true);
attempt("Map.clear undefined", callMap_clear, undefined);
attempt("Map.clear null", callMap_clear, null);
attempt("Map.clear an array", callMap_clear, [9, 8]);
attempt("Map.clear a frozen one", callMap_clear, Object.freeze(new Map([["a", 1], ["b", 2]])));
attempt("Map.clear watched", callMap_clearWatched, new Map([["a", 1], ["b", 2]])); attempt("Map.clear watched, undefined", callMap_clearWatched, undefined); attempt("Map.clear watched, a stranger", callMap_clearWatched, stranger("clear"));
attempt("Set.has of the class", callSet_has, new Set(["a", "b"]));
attempt("Set.has an heir", callSet_has, new (class extends Set<any> { })(["a"]));
attempt("Set.has with its own", callSet_has, withOwn(new Set(["a", "b"]), "has"));
attempt("Set.has with another prototype", callSet_has, withOtherPrototype(new Set(["a", "b"]), "has"));
attempt("Set.has with a getter", callSet_has, withGetter(new Set(["a", "b"]), "has"));
attempt("Set.has a stranger", callSet_has, stranger("has"));
attempt("Set.has a plain object", callSet_has, { });
attempt("Set.has a number", callSet_has, 5);
attempt("Set.has a string", callSet_has, "xyz");
attempt("Set.has true", callSet_has, true);
attempt("Set.has undefined", callSet_has, undefined);
attempt("Set.has null", callSet_has, null);
attempt("Set.has an array", callSet_has, [9, 8]);
attempt("Set.has a frozen one", callSet_has, Object.freeze(new Set(["a", "b"])));
attempt("Set.has watched", callSet_hasWatched, new Set(["a", "b"])); attempt("Set.has watched, undefined", callSet_hasWatched, undefined); attempt("Set.has watched, a stranger", callSet_hasWatched, stranger("has"));
attempt("Set.add of the class", callSet_add, new Set(["a", "b"]));
attempt("Set.add an heir", callSet_add, new (class extends Set<any> { })(["a"]));
attempt("Set.add with its own", callSet_add, withOwn(new Set(["a", "b"]), "add"));
attempt("Set.add with another prototype", callSet_add, withOtherPrototype(new Set(["a", "b"]), "add"));
attempt("Set.add with a getter", callSet_add, withGetter(new Set(["a", "b"]), "add"));
attempt("Set.add a stranger", callSet_add, stranger("add"));
attempt("Set.add a plain object", callSet_add, { });
attempt("Set.add a number", callSet_add, 5);
attempt("Set.add a string", callSet_add, "xyz");
attempt("Set.add true", callSet_add, true);
attempt("Set.add undefined", callSet_add, undefined);
attempt("Set.add null", callSet_add, null);
attempt("Set.add an array", callSet_add, [9, 8]);
attempt("Set.add a frozen one", callSet_add, Object.freeze(new Set(["a", "b"])));
attempt("Set.add watched", callSet_addWatched, new Set(["a", "b"])); attempt("Set.add watched, undefined", callSet_addWatched, undefined); attempt("Set.add watched, a stranger", callSet_addWatched, stranger("add"));
attempt("Set.delete of the class", callSet_delete, new Set(["a", "b"]));
attempt("Set.delete an heir", callSet_delete, new (class extends Set<any> { })(["a"]));
attempt("Set.delete with its own", callSet_delete, withOwn(new Set(["a", "b"]), "delete"));
attempt("Set.delete with another prototype", callSet_delete, withOtherPrototype(new Set(["a", "b"]), "delete"));
attempt("Set.delete with a getter", callSet_delete, withGetter(new Set(["a", "b"]), "delete"));
attempt("Set.delete a stranger", callSet_delete, stranger("delete"));
attempt("Set.delete a plain object", callSet_delete, { });
attempt("Set.delete a number", callSet_delete, 5);
attempt("Set.delete a string", callSet_delete, "xyz");
attempt("Set.delete true", callSet_delete, true);
attempt("Set.delete undefined", callSet_delete, undefined);
attempt("Set.delete null", callSet_delete, null);
attempt("Set.delete an array", callSet_delete, [9, 8]);
attempt("Set.delete a frozen one", callSet_delete, Object.freeze(new Set(["a", "b"])));
attempt("Set.delete watched", callSet_deleteWatched, new Set(["a", "b"])); attempt("Set.delete watched, undefined", callSet_deleteWatched, undefined); attempt("Set.delete watched, a stranger", callSet_deleteWatched, stranger("delete"));
attempt("Set.keys of the class", callSet_keys, new Set(["a", "b"]));
attempt("Set.keys an heir", callSet_keys, new (class extends Set<any> { })(["a"]));
attempt("Set.keys with its own", callSet_keys, withOwn(new Set(["a", "b"]), "keys"));
attempt("Set.keys with another prototype", callSet_keys, withOtherPrototype(new Set(["a", "b"]), "keys"));
attempt("Set.keys with a getter", callSet_keys, withGetter(new Set(["a", "b"]), "keys"));
attempt("Set.keys a stranger", callSet_keys, stranger("keys"));
attempt("Set.keys a plain object", callSet_keys, { });
attempt("Set.keys a number", callSet_keys, 5);
attempt("Set.keys a string", callSet_keys, "xyz");
attempt("Set.keys true", callSet_keys, true);
attempt("Set.keys undefined", callSet_keys, undefined);
attempt("Set.keys null", callSet_keys, null);
attempt("Set.keys an array", callSet_keys, [9, 8]);
attempt("Set.keys a frozen one", callSet_keys, Object.freeze(new Set(["a", "b"])));
attempt("Set.keys watched", callSet_keysWatched, new Set(["a", "b"])); attempt("Set.keys watched, undefined", callSet_keysWatched, undefined); attempt("Set.keys watched, a stranger", callSet_keysWatched, stranger("keys"));
attempt("Set.values of the class", callSet_values, new Set(["a", "b"]));
attempt("Set.values an heir", callSet_values, new (class extends Set<any> { })(["a"]));
attempt("Set.values with its own", callSet_values, withOwn(new Set(["a", "b"]), "values"));
attempt("Set.values with another prototype", callSet_values, withOtherPrototype(new Set(["a", "b"]), "values"));
attempt("Set.values with a getter", callSet_values, withGetter(new Set(["a", "b"]), "values"));
attempt("Set.values a stranger", callSet_values, stranger("values"));
attempt("Set.values a plain object", callSet_values, { });
attempt("Set.values a number", callSet_values, 5);
attempt("Set.values a string", callSet_values, "xyz");
attempt("Set.values true", callSet_values, true);
attempt("Set.values undefined", callSet_values, undefined);
attempt("Set.values null", callSet_values, null);
attempt("Set.values an array", callSet_values, [9, 8]);
attempt("Set.values a frozen one", callSet_values, Object.freeze(new Set(["a", "b"])));
attempt("Set.values watched", callSet_valuesWatched, new Set(["a", "b"])); attempt("Set.values watched, undefined", callSet_valuesWatched, undefined); attempt("Set.values watched, a stranger", callSet_valuesWatched, stranger("values"));
attempt("Set.entries of the class", callSet_entries, new Set(["a", "b"]));
attempt("Set.entries an heir", callSet_entries, new (class extends Set<any> { })(["a"]));
attempt("Set.entries with its own", callSet_entries, withOwn(new Set(["a", "b"]), "entries"));
attempt("Set.entries with another prototype", callSet_entries, withOtherPrototype(new Set(["a", "b"]), "entries"));
attempt("Set.entries with a getter", callSet_entries, withGetter(new Set(["a", "b"]), "entries"));
attempt("Set.entries a stranger", callSet_entries, stranger("entries"));
attempt("Set.entries a plain object", callSet_entries, { });
attempt("Set.entries a number", callSet_entries, 5);
attempt("Set.entries a string", callSet_entries, "xyz");
attempt("Set.entries true", callSet_entries, true);
attempt("Set.entries undefined", callSet_entries, undefined);
attempt("Set.entries null", callSet_entries, null);
attempt("Set.entries an array", callSet_entries, [9, 8]);
attempt("Set.entries a frozen one", callSet_entries, Object.freeze(new Set(["a", "b"])));
attempt("Set.entries watched", callSet_entriesWatched, new Set(["a", "b"])); attempt("Set.entries watched, undefined", callSet_entriesWatched, undefined); attempt("Set.entries watched, a stranger", callSet_entriesWatched, stranger("entries"));
attempt("Set.clear of the class", callSet_clear, new Set(["a", "b"]));
attempt("Set.clear an heir", callSet_clear, new (class extends Set<any> { })(["a"]));
attempt("Set.clear with its own", callSet_clear, withOwn(new Set(["a", "b"]), "clear"));
attempt("Set.clear with another prototype", callSet_clear, withOtherPrototype(new Set(["a", "b"]), "clear"));
attempt("Set.clear with a getter", callSet_clear, withGetter(new Set(["a", "b"]), "clear"));
attempt("Set.clear a stranger", callSet_clear, stranger("clear"));
attempt("Set.clear a plain object", callSet_clear, { });
attempt("Set.clear a number", callSet_clear, 5);
attempt("Set.clear a string", callSet_clear, "xyz");
attempt("Set.clear true", callSet_clear, true);
attempt("Set.clear undefined", callSet_clear, undefined);
attempt("Set.clear null", callSet_clear, null);
attempt("Set.clear an array", callSet_clear, [9, 8]);
attempt("Set.clear a frozen one", callSet_clear, Object.freeze(new Set(["a", "b"])));
attempt("Set.clear watched", callSet_clearWatched, new Set(["a", "b"])); attempt("Set.clear watched, undefined", callSet_clearWatched, undefined); attempt("Set.clear watched, a stranger", callSet_clearWatched, stranger("clear"));
attempt("Set.union of the class", callSet_union, new Set(["a", "b"]));
attempt("Set.union an heir", callSet_union, new (class extends Set<any> { })(["a"]));
attempt("Set.union with its own", callSet_union, withOwn(new Set(["a", "b"]), "union"));
attempt("Set.union with another prototype", callSet_union, withOtherPrototype(new Set(["a", "b"]), "union"));
attempt("Set.union with a getter", callSet_union, withGetter(new Set(["a", "b"]), "union"));
attempt("Set.union a stranger", callSet_union, stranger("union"));
attempt("Set.union a plain object", callSet_union, { });
attempt("Set.union a number", callSet_union, 5);
attempt("Set.union a string", callSet_union, "xyz");
attempt("Set.union true", callSet_union, true);
attempt("Set.union undefined", callSet_union, undefined);
attempt("Set.union null", callSet_union, null);
attempt("Set.union an array", callSet_union, [9, 8]);
attempt("Set.union a frozen one", callSet_union, Object.freeze(new Set(["a", "b"])));
attempt("Set.union watched", callSet_unionWatched, new Set(["a", "b"])); attempt("Set.union watched, undefined", callSet_unionWatched, undefined); attempt("Set.union watched, a stranger", callSet_unionWatched, stranger("union"));
attempt("Set.isSubsetOf of the class", callSet_isSubsetOf, new Set(["a", "b"]));
attempt("Set.isSubsetOf an heir", callSet_isSubsetOf, new (class extends Set<any> { })(["a"]));
attempt("Set.isSubsetOf with its own", callSet_isSubsetOf, withOwn(new Set(["a", "b"]), "isSubsetOf"));
attempt("Set.isSubsetOf with another prototype", callSet_isSubsetOf, withOtherPrototype(new Set(["a", "b"]), "isSubsetOf"));
attempt("Set.isSubsetOf with a getter", callSet_isSubsetOf, withGetter(new Set(["a", "b"]), "isSubsetOf"));
attempt("Set.isSubsetOf a stranger", callSet_isSubsetOf, stranger("isSubsetOf"));
attempt("Set.isSubsetOf a plain object", callSet_isSubsetOf, { });
attempt("Set.isSubsetOf a number", callSet_isSubsetOf, 5);
attempt("Set.isSubsetOf a string", callSet_isSubsetOf, "xyz");
attempt("Set.isSubsetOf true", callSet_isSubsetOf, true);
attempt("Set.isSubsetOf undefined", callSet_isSubsetOf, undefined);
attempt("Set.isSubsetOf null", callSet_isSubsetOf, null);
attempt("Set.isSubsetOf an array", callSet_isSubsetOf, [9, 8]);
attempt("Set.isSubsetOf a frozen one", callSet_isSubsetOf, Object.freeze(new Set(["a", "b"])));
attempt("Set.isSubsetOf watched", callSet_isSubsetOfWatched, new Set(["a", "b"])); attempt("Set.isSubsetOf watched, undefined", callSet_isSubsetOfWatched, undefined); attempt("Set.isSubsetOf watched, a stranger", callSet_isSubsetOfWatched, stranger("isSubsetOf"));
attempt("Date.getTime of the class", callDate_getTime, new Date(86400000));
attempt("Date.getTime an heir", callDate_getTime, new (class extends Date { })(86400000));
attempt("Date.getTime with its own", callDate_getTime, withOwn(new Date(86400000), "getTime"));
attempt("Date.getTime with another prototype", callDate_getTime, withOtherPrototype(new Date(86400000), "getTime"));
attempt("Date.getTime with a getter", callDate_getTime, withGetter(new Date(86400000), "getTime"));
attempt("Date.getTime a stranger", callDate_getTime, stranger("getTime"));
attempt("Date.getTime a plain object", callDate_getTime, { });
attempt("Date.getTime a number", callDate_getTime, 5);
attempt("Date.getTime a string", callDate_getTime, "xyz");
attempt("Date.getTime true", callDate_getTime, true);
attempt("Date.getTime undefined", callDate_getTime, undefined);
attempt("Date.getTime null", callDate_getTime, null);
attempt("Date.getTime an array", callDate_getTime, [9, 8]);
attempt("Date.getTime a frozen one", callDate_getTime, Object.freeze(new Date(86400000)));
attempt("Date.getTime watched", callDate_getTimeWatched, new Date(86400000)); attempt("Date.getTime watched, undefined", callDate_getTimeWatched, undefined); attempt("Date.getTime watched, a stranger", callDate_getTimeWatched, stranger("getTime"));
attempt("Date.getUTCFullYear of the class", callDate_getUTCFullYear, new Date(86400000));
attempt("Date.getUTCFullYear an heir", callDate_getUTCFullYear, new (class extends Date { })(86400000));
attempt("Date.getUTCFullYear with its own", callDate_getUTCFullYear, withOwn(new Date(86400000), "getUTCFullYear"));
attempt("Date.getUTCFullYear with another prototype", callDate_getUTCFullYear, withOtherPrototype(new Date(86400000), "getUTCFullYear"));
attempt("Date.getUTCFullYear with a getter", callDate_getUTCFullYear, withGetter(new Date(86400000), "getUTCFullYear"));
attempt("Date.getUTCFullYear a stranger", callDate_getUTCFullYear, stranger("getUTCFullYear"));
attempt("Date.getUTCFullYear a plain object", callDate_getUTCFullYear, { });
attempt("Date.getUTCFullYear a number", callDate_getUTCFullYear, 5);
attempt("Date.getUTCFullYear a string", callDate_getUTCFullYear, "xyz");
attempt("Date.getUTCFullYear true", callDate_getUTCFullYear, true);
attempt("Date.getUTCFullYear undefined", callDate_getUTCFullYear, undefined);
attempt("Date.getUTCFullYear null", callDate_getUTCFullYear, null);
attempt("Date.getUTCFullYear an array", callDate_getUTCFullYear, [9, 8]);
attempt("Date.getUTCFullYear a frozen one", callDate_getUTCFullYear, Object.freeze(new Date(86400000)));
attempt("Date.getUTCFullYear watched", callDate_getUTCFullYearWatched, new Date(86400000)); attempt("Date.getUTCFullYear watched, undefined", callDate_getUTCFullYearWatched, undefined); attempt("Date.getUTCFullYear watched, a stranger", callDate_getUTCFullYearWatched, stranger("getUTCFullYear"));
attempt("Date.toISOString of the class", callDate_toISOString, new Date(86400000));
attempt("Date.toISOString an heir", callDate_toISOString, new (class extends Date { })(86400000));
attempt("Date.toISOString with its own", callDate_toISOString, withOwn(new Date(86400000), "toISOString"));
attempt("Date.toISOString with another prototype", callDate_toISOString, withOtherPrototype(new Date(86400000), "toISOString"));
attempt("Date.toISOString with a getter", callDate_toISOString, withGetter(new Date(86400000), "toISOString"));
attempt("Date.toISOString a stranger", callDate_toISOString, stranger("toISOString"));
attempt("Date.toISOString a plain object", callDate_toISOString, { });
attempt("Date.toISOString a number", callDate_toISOString, 5);
attempt("Date.toISOString a string", callDate_toISOString, "xyz");
attempt("Date.toISOString true", callDate_toISOString, true);
attempt("Date.toISOString undefined", callDate_toISOString, undefined);
attempt("Date.toISOString null", callDate_toISOString, null);
attempt("Date.toISOString an array", callDate_toISOString, [9, 8]);
attempt("Date.toISOString a frozen one", callDate_toISOString, Object.freeze(new Date(86400000)));
attempt("Date.toISOString watched", callDate_toISOStringWatched, new Date(86400000)); attempt("Date.toISOString watched, undefined", callDate_toISOStringWatched, undefined); attempt("Date.toISOString watched, a stranger", callDate_toISOStringWatched, stranger("toISOString"));
attempt("Date.valueOf of the class", callDate_valueOf, new Date(86400000));
attempt("Date.valueOf an heir", callDate_valueOf, new (class extends Date { })(86400000));
attempt("Date.valueOf with its own", callDate_valueOf, withOwn(new Date(86400000), "valueOf"));
attempt("Date.valueOf with another prototype", callDate_valueOf, withOtherPrototype(new Date(86400000), "valueOf"));
attempt("Date.valueOf with a getter", callDate_valueOf, withGetter(new Date(86400000), "valueOf"));
attempt("Date.valueOf a stranger", callDate_valueOf, stranger("valueOf"));
attempt("Date.valueOf a plain object", callDate_valueOf, { });
attempt("Date.valueOf a number", callDate_valueOf, 5);
attempt("Date.valueOf a string", callDate_valueOf, "xyz");
attempt("Date.valueOf true", callDate_valueOf, true);
attempt("Date.valueOf undefined", callDate_valueOf, undefined);
attempt("Date.valueOf null", callDate_valueOf, null);
attempt("Date.valueOf an array", callDate_valueOf, [9, 8]);
attempt("Date.valueOf a frozen one", callDate_valueOf, Object.freeze(new Date(86400000)));
attempt("Date.valueOf watched", callDate_valueOfWatched, new Date(86400000)); attempt("Date.valueOf watched, undefined", callDate_valueOfWatched, undefined); attempt("Date.valueOf watched, a stranger", callDate_valueOfWatched, stranger("valueOf"));
attempt("Date.getUTCDay of the class", callDate_getUTCDay, new Date(86400000));
attempt("Date.getUTCDay an heir", callDate_getUTCDay, new (class extends Date { })(86400000));
attempt("Date.getUTCDay with its own", callDate_getUTCDay, withOwn(new Date(86400000), "getUTCDay"));
attempt("Date.getUTCDay with another prototype", callDate_getUTCDay, withOtherPrototype(new Date(86400000), "getUTCDay"));
attempt("Date.getUTCDay with a getter", callDate_getUTCDay, withGetter(new Date(86400000), "getUTCDay"));
attempt("Date.getUTCDay a stranger", callDate_getUTCDay, stranger("getUTCDay"));
attempt("Date.getUTCDay a plain object", callDate_getUTCDay, { });
attempt("Date.getUTCDay a number", callDate_getUTCDay, 5);
attempt("Date.getUTCDay a string", callDate_getUTCDay, "xyz");
attempt("Date.getUTCDay true", callDate_getUTCDay, true);
attempt("Date.getUTCDay undefined", callDate_getUTCDay, undefined);
attempt("Date.getUTCDay null", callDate_getUTCDay, null);
attempt("Date.getUTCDay an array", callDate_getUTCDay, [9, 8]);
attempt("Date.getUTCDay a frozen one", callDate_getUTCDay, Object.freeze(new Date(86400000)));
attempt("Date.getUTCDay watched", callDate_getUTCDayWatched, new Date(86400000)); attempt("Date.getUTCDay watched, undefined", callDate_getUTCDayWatched, undefined); attempt("Date.getUTCDay watched, a stranger", callDate_getUTCDayWatched, stranger("getUTCDay"));
attempt("Date.setUTCFullYear of the class", callDate_setUTCFullYear, new Date(86400000));
attempt("Date.setUTCFullYear an heir", callDate_setUTCFullYear, new (class extends Date { })(86400000));
attempt("Date.setUTCFullYear with its own", callDate_setUTCFullYear, withOwn(new Date(86400000), "setUTCFullYear"));
attempt("Date.setUTCFullYear with another prototype", callDate_setUTCFullYear, withOtherPrototype(new Date(86400000), "setUTCFullYear"));
attempt("Date.setUTCFullYear with a getter", callDate_setUTCFullYear, withGetter(new Date(86400000), "setUTCFullYear"));
attempt("Date.setUTCFullYear a stranger", callDate_setUTCFullYear, stranger("setUTCFullYear"));
attempt("Date.setUTCFullYear a plain object", callDate_setUTCFullYear, { });
attempt("Date.setUTCFullYear a number", callDate_setUTCFullYear, 5);
attempt("Date.setUTCFullYear a string", callDate_setUTCFullYear, "xyz");
attempt("Date.setUTCFullYear true", callDate_setUTCFullYear, true);
attempt("Date.setUTCFullYear undefined", callDate_setUTCFullYear, undefined);
attempt("Date.setUTCFullYear null", callDate_setUTCFullYear, null);
attempt("Date.setUTCFullYear an array", callDate_setUTCFullYear, [9, 8]);
attempt("Date.setUTCFullYear a frozen one", callDate_setUTCFullYear, Object.freeze(new Date(86400000)));
attempt("Date.setUTCFullYear watched", callDate_setUTCFullYearWatched, new Date(86400000)); attempt("Date.setUTCFullYear watched, undefined", callDate_setUTCFullYearWatched, undefined); attempt("Date.setUTCFullYear watched, a stranger", callDate_setUTCFullYearWatched, stranger("setUTCFullYear"));
attempt("Date.toJSON of the class", callDate_toJSON, new Date(86400000));
attempt("Date.toJSON an heir", callDate_toJSON, new (class extends Date { })(86400000));
attempt("Date.toJSON with its own", callDate_toJSON, withOwn(new Date(86400000), "toJSON"));
attempt("Date.toJSON with another prototype", callDate_toJSON, withOtherPrototype(new Date(86400000), "toJSON"));
attempt("Date.toJSON with a getter", callDate_toJSON, withGetter(new Date(86400000), "toJSON"));
attempt("Date.toJSON a stranger", callDate_toJSON, stranger("toJSON"));
attempt("Date.toJSON a plain object", callDate_toJSON, { });
attempt("Date.toJSON a number", callDate_toJSON, 5);
attempt("Date.toJSON a string", callDate_toJSON, "xyz");
attempt("Date.toJSON true", callDate_toJSON, true);
attempt("Date.toJSON undefined", callDate_toJSON, undefined);
attempt("Date.toJSON null", callDate_toJSON, null);
attempt("Date.toJSON an array", callDate_toJSON, [9, 8]);
attempt("Date.toJSON a frozen one", callDate_toJSON, Object.freeze(new Date(86400000)));
attempt("Date.toJSON watched", callDate_toJSONWatched, new Date(86400000)); attempt("Date.toJSON watched, undefined", callDate_toJSONWatched, undefined); attempt("Date.toJSON watched, a stranger", callDate_toJSONWatched, stranger("toJSON"));
attempt("Promise.then of the class", callPromise_then, Promise.resolve(1));
attempt("Promise.then an heir", callPromise_then, (class extends Promise<any> { }).resolve(1));
attempt("Promise.then with its own", callPromise_then, withOwn(Promise.resolve(1), "then"));
attempt("Promise.then with another prototype", callPromise_then, withOtherPrototype(Promise.resolve(1), "then"));
attempt("Promise.then with a getter", callPromise_then, withGetter(Promise.resolve(1), "then"));
attempt("Promise.then a stranger", callPromise_then, stranger("then"));
attempt("Promise.then a plain object", callPromise_then, { });
attempt("Promise.then a number", callPromise_then, 5);
attempt("Promise.then a string", callPromise_then, "xyz");
attempt("Promise.then true", callPromise_then, true);
attempt("Promise.then undefined", callPromise_then, undefined);
attempt("Promise.then null", callPromise_then, null);
attempt("Promise.then an array", callPromise_then, [9, 8]);
attempt("Promise.then a frozen one", callPromise_then, Object.freeze(Promise.resolve(1)));
attempt("Promise.then watched", callPromise_thenWatched, Promise.resolve(1)); attempt("Promise.then watched, undefined", callPromise_thenWatched, undefined); attempt("Promise.then watched, a stranger", callPromise_thenWatched, stranger("then"));
attempt("Promise.catch of the class", callPromise_catch, Promise.resolve(1));
attempt("Promise.catch an heir", callPromise_catch, (class extends Promise<any> { }).resolve(1));
attempt("Promise.catch with its own", callPromise_catch, withOwn(Promise.resolve(1), "catch"));
attempt("Promise.catch with another prototype", callPromise_catch, withOtherPrototype(Promise.resolve(1), "catch"));
attempt("Promise.catch with a getter", callPromise_catch, withGetter(Promise.resolve(1), "catch"));
attempt("Promise.catch a stranger", callPromise_catch, stranger("catch"));
attempt("Promise.catch a plain object", callPromise_catch, { });
attempt("Promise.catch a number", callPromise_catch, 5);
attempt("Promise.catch a string", callPromise_catch, "xyz");
attempt("Promise.catch true", callPromise_catch, true);
attempt("Promise.catch undefined", callPromise_catch, undefined);
attempt("Promise.catch null", callPromise_catch, null);
attempt("Promise.catch an array", callPromise_catch, [9, 8]);
attempt("Promise.catch a frozen one", callPromise_catch, Object.freeze(Promise.resolve(1)));
attempt("Promise.catch watched", callPromise_catchWatched, Promise.resolve(1)); attempt("Promise.catch watched, undefined", callPromise_catchWatched, undefined); attempt("Promise.catch watched, a stranger", callPromise_catchWatched, stranger("catch"));
attempt("Promise.finally of the class", callPromise_finally, Promise.resolve(1));
attempt("Promise.finally an heir", callPromise_finally, (class extends Promise<any> { }).resolve(1));
attempt("Promise.finally with its own", callPromise_finally, withOwn(Promise.resolve(1), "finally"));
attempt("Promise.finally with another prototype", callPromise_finally, withOtherPrototype(Promise.resolve(1), "finally"));
attempt("Promise.finally with a getter", callPromise_finally, withGetter(Promise.resolve(1), "finally"));
attempt("Promise.finally a stranger", callPromise_finally, stranger("finally"));
attempt("Promise.finally a plain object", callPromise_finally, { });
attempt("Promise.finally a number", callPromise_finally, 5);
attempt("Promise.finally a string", callPromise_finally, "xyz");
attempt("Promise.finally true", callPromise_finally, true);
attempt("Promise.finally undefined", callPromise_finally, undefined);
attempt("Promise.finally null", callPromise_finally, null);
attempt("Promise.finally an array", callPromise_finally, [9, 8]);
attempt("Promise.finally a frozen one", callPromise_finally, Object.freeze(Promise.resolve(1)));
attempt("Promise.finally watched", callPromise_finallyWatched, Promise.resolve(1)); attempt("Promise.finally watched, undefined", callPromise_finallyWatched, undefined); attempt("Promise.finally watched, a stranger", callPromise_finallyWatched, stranger("finally"));
attempt("WeakMap.get of the class", callWeakMap_get, new WeakMap([[key, 1]]));
attempt("WeakMap.get an heir", callWeakMap_get, new (class extends WeakMap<any, any> { })([[key, 1]]));
attempt("WeakMap.get with its own", callWeakMap_get, withOwn(new WeakMap([[key, 1]]), "get"));
attempt("WeakMap.get with another prototype", callWeakMap_get, withOtherPrototype(new WeakMap([[key, 1]]), "get"));
attempt("WeakMap.get with a getter", callWeakMap_get, withGetter(new WeakMap([[key, 1]]), "get"));
attempt("WeakMap.get a stranger", callWeakMap_get, stranger("get"));
attempt("WeakMap.get a plain object", callWeakMap_get, { });
attempt("WeakMap.get a number", callWeakMap_get, 5);
attempt("WeakMap.get a string", callWeakMap_get, "xyz");
attempt("WeakMap.get true", callWeakMap_get, true);
attempt("WeakMap.get undefined", callWeakMap_get, undefined);
attempt("WeakMap.get null", callWeakMap_get, null);
attempt("WeakMap.get an array", callWeakMap_get, [9, 8]);
attempt("WeakMap.get a frozen one", callWeakMap_get, Object.freeze(new WeakMap([[key, 1]])));
attempt("WeakMap.get watched", callWeakMap_getWatched, new WeakMap([[key, 1]])); attempt("WeakMap.get watched, undefined", callWeakMap_getWatched, undefined); attempt("WeakMap.get watched, a stranger", callWeakMap_getWatched, stranger("get"));
attempt("WeakMap.has of the class", callWeakMap_has, new WeakMap([[key, 1]]));
attempt("WeakMap.has an heir", callWeakMap_has, new (class extends WeakMap<any, any> { })([[key, 1]]));
attempt("WeakMap.has with its own", callWeakMap_has, withOwn(new WeakMap([[key, 1]]), "has"));
attempt("WeakMap.has with another prototype", callWeakMap_has, withOtherPrototype(new WeakMap([[key, 1]]), "has"));
attempt("WeakMap.has with a getter", callWeakMap_has, withGetter(new WeakMap([[key, 1]]), "has"));
attempt("WeakMap.has a stranger", callWeakMap_has, stranger("has"));
attempt("WeakMap.has a plain object", callWeakMap_has, { });
attempt("WeakMap.has a number", callWeakMap_has, 5);
attempt("WeakMap.has a string", callWeakMap_has, "xyz");
attempt("WeakMap.has true", callWeakMap_has, true);
attempt("WeakMap.has undefined", callWeakMap_has, undefined);
attempt("WeakMap.has null", callWeakMap_has, null);
attempt("WeakMap.has an array", callWeakMap_has, [9, 8]);
attempt("WeakMap.has a frozen one", callWeakMap_has, Object.freeze(new WeakMap([[key, 1]])));
attempt("WeakMap.has watched", callWeakMap_hasWatched, new WeakMap([[key, 1]])); attempt("WeakMap.has watched, undefined", callWeakMap_hasWatched, undefined); attempt("WeakMap.has watched, a stranger", callWeakMap_hasWatched, stranger("has"));
attempt("WeakMap.set of the class", callWeakMap_set, new WeakMap([[key, 1]]));
attempt("WeakMap.set an heir", callWeakMap_set, new (class extends WeakMap<any, any> { })([[key, 1]]));
attempt("WeakMap.set with its own", callWeakMap_set, withOwn(new WeakMap([[key, 1]]), "set"));
attempt("WeakMap.set with another prototype", callWeakMap_set, withOtherPrototype(new WeakMap([[key, 1]]), "set"));
attempt("WeakMap.set with a getter", callWeakMap_set, withGetter(new WeakMap([[key, 1]]), "set"));
attempt("WeakMap.set a stranger", callWeakMap_set, stranger("set"));
attempt("WeakMap.set a plain object", callWeakMap_set, { });
attempt("WeakMap.set a number", callWeakMap_set, 5);
attempt("WeakMap.set a string", callWeakMap_set, "xyz");
attempt("WeakMap.set true", callWeakMap_set, true);
attempt("WeakMap.set undefined", callWeakMap_set, undefined);
attempt("WeakMap.set null", callWeakMap_set, null);
attempt("WeakMap.set an array", callWeakMap_set, [9, 8]);
attempt("WeakMap.set a frozen one", callWeakMap_set, Object.freeze(new WeakMap([[key, 1]])));
attempt("WeakMap.set watched", callWeakMap_setWatched, new WeakMap([[key, 1]])); attempt("WeakMap.set watched, undefined", callWeakMap_setWatched, undefined); attempt("WeakMap.set watched, a stranger", callWeakMap_setWatched, stranger("set"));
attempt("WeakMap.delete of the class", callWeakMap_delete, new WeakMap([[key, 1]]));
attempt("WeakMap.delete an heir", callWeakMap_delete, new (class extends WeakMap<any, any> { })([[key, 1]]));
attempt("WeakMap.delete with its own", callWeakMap_delete, withOwn(new WeakMap([[key, 1]]), "delete"));
attempt("WeakMap.delete with another prototype", callWeakMap_delete, withOtherPrototype(new WeakMap([[key, 1]]), "delete"));
attempt("WeakMap.delete with a getter", callWeakMap_delete, withGetter(new WeakMap([[key, 1]]), "delete"));
attempt("WeakMap.delete a stranger", callWeakMap_delete, stranger("delete"));
attempt("WeakMap.delete a plain object", callWeakMap_delete, { });
attempt("WeakMap.delete a number", callWeakMap_delete, 5);
attempt("WeakMap.delete a string", callWeakMap_delete, "xyz");
attempt("WeakMap.delete true", callWeakMap_delete, true);
attempt("WeakMap.delete undefined", callWeakMap_delete, undefined);
attempt("WeakMap.delete null", callWeakMap_delete, null);
attempt("WeakMap.delete an array", callWeakMap_delete, [9, 8]);
attempt("WeakMap.delete a frozen one", callWeakMap_delete, Object.freeze(new WeakMap([[key, 1]])));
attempt("WeakMap.delete watched", callWeakMap_deleteWatched, new WeakMap([[key, 1]])); attempt("WeakMap.delete watched, undefined", callWeakMap_deleteWatched, undefined); attempt("WeakMap.delete watched, a stranger", callWeakMap_deleteWatched, stranger("delete"));
attempt("RegExp.test of the class", callRegExp_test, /b/);
attempt("RegExp.test an heir", callRegExp_test, new (class extends RegExp { })("b"));
attempt("RegExp.test with its own", callRegExp_test, withOwn(/b/, "test"));
attempt("RegExp.test with another prototype", callRegExp_test, withOtherPrototype(/b/, "test"));
attempt("RegExp.test with a getter", callRegExp_test, withGetter(/b/, "test"));
attempt("RegExp.test a stranger", callRegExp_test, stranger("test"));
attempt("RegExp.test a plain object", callRegExp_test, { });
attempt("RegExp.test a number", callRegExp_test, 5);
attempt("RegExp.test a string", callRegExp_test, "xyz");
attempt("RegExp.test true", callRegExp_test, true);
attempt("RegExp.test undefined", callRegExp_test, undefined);
attempt("RegExp.test null", callRegExp_test, null);
attempt("RegExp.test an array", callRegExp_test, [9, 8]);
attempt("RegExp.test a frozen one", callRegExp_test, Object.freeze(/b/));
attempt("RegExp.test watched", callRegExp_testWatched, /b/); attempt("RegExp.test watched, undefined", callRegExp_testWatched, undefined); attempt("RegExp.test watched, a stranger", callRegExp_testWatched, stranger("test"));
attempt("RegExp.exec of the class", callRegExp_exec, /b/);
attempt("RegExp.exec an heir", callRegExp_exec, new (class extends RegExp { })("b"));
attempt("RegExp.exec with its own", callRegExp_exec, withOwn(/b/, "exec"));
attempt("RegExp.exec with another prototype", callRegExp_exec, withOtherPrototype(/b/, "exec"));
attempt("RegExp.exec with a getter", callRegExp_exec, withGetter(/b/, "exec"));
attempt("RegExp.exec a stranger", callRegExp_exec, stranger("exec"));
attempt("RegExp.exec a plain object", callRegExp_exec, { });
attempt("RegExp.exec a number", callRegExp_exec, 5);
attempt("RegExp.exec a string", callRegExp_exec, "xyz");
attempt("RegExp.exec true", callRegExp_exec, true);
attempt("RegExp.exec undefined", callRegExp_exec, undefined);
attempt("RegExp.exec null", callRegExp_exec, null);
attempt("RegExp.exec an array", callRegExp_exec, [9, 8]);
attempt("RegExp.exec a frozen one", callRegExp_exec, Object.freeze(/b/));
attempt("RegExp.exec watched", callRegExp_execWatched, /b/); attempt("RegExp.exec watched, undefined", callRegExp_execWatched, undefined); attempt("RegExp.exec watched, a stranger", callRegExp_execWatched, stranger("exec"));
attempt("RegExp.toString of the class", callRegExp_toString, /b/);
attempt("RegExp.toString an heir", callRegExp_toString, new (class extends RegExp { })("b"));
attempt("RegExp.toString with its own", callRegExp_toString, withOwn(/b/, "toString"));
attempt("RegExp.toString with another prototype", callRegExp_toString, withOtherPrototype(/b/, "toString"));
attempt("RegExp.toString with a getter", callRegExp_toString, withGetter(/b/, "toString"));
attempt("RegExp.toString a stranger", callRegExp_toString, stranger("toString"));
attempt("RegExp.toString a plain object", callRegExp_toString, { });
attempt("RegExp.toString a number", callRegExp_toString, 5);
attempt("RegExp.toString a string", callRegExp_toString, "xyz");
attempt("RegExp.toString true", callRegExp_toString, true);
attempt("RegExp.toString undefined", callRegExp_toString, undefined);
attempt("RegExp.toString null", callRegExp_toString, null);
attempt("RegExp.toString an array", callRegExp_toString, [9, 8]);
attempt("RegExp.toString a frozen one", callRegExp_toString, Object.freeze(/b/));
attempt("RegExp.toString watched", callRegExp_toStringWatched, /b/); attempt("RegExp.toString watched, undefined", callRegExp_toStringWatched, undefined); attempt("RegExp.toString watched, a stranger", callRegExp_toStringWatched, stranger("toString"));
await Promise.resolve(); await Promise.resolve();
lines.push("notes " + notes);
console.log(lines.join("\n"));
