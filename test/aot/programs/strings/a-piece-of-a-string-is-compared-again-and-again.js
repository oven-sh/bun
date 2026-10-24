// A piece of a longer string (slice, substring, split, a match) compared with === and !== against equal and unequal strings of the same and of other lengths, again and again; and what the piece is worth afterwards as a key, a part of a longer string, a receiver.
const pad = process.argv.length > 99 ? " " : "";
const query = "status=open&limit=25&owner=café&sign=世界&empty=&status=done" + pad;
const pieceOf = (from, to) => query.slice(from, to);
const statuses = ["done", "open", "late", "open", "opened", "ope", "", "OPEN", "open" + pad];
function count(status) { let hits = 0; for (let round = 0; round < 50; round++) for (const other of statuses) if (other === status) hits++; return hits; }
function countUnequal(status) { let hits = 0; for (let round = 0; round < 50; round++) for (const other of statuses) if (other !== status) hits++; return hits; }
console.log(count(pieceOf(7, 11)), countUnequal(pieceOf(7, 11)), count(pieceOf(58, 62)), count(pieceOf(7, 10)), count(pieceOf(7, 7)), count(pieceOf(0, 6)));
const open = pieceOf(7, 11);
console.log(open === "open", "open" === open, open === "done", open !== "open", open == "open", Object.is(open, "open"), open === pieceOf(7, 11), pieceOf(7, 11) === pieceOf(7, 11), pieceOf(7, 11) === pieceOf(58, 62));
console.log(open.length, open.charCodeAt(1), open[3], open + "!", `<${open}>`, open.toUpperCase(), open.indexOf("e"), JSON.stringify({ [open]: open }), new Map([["open", 1]]).get(open), new Set(["open"]).has(open), { open: 2 }[open], open.localeCompare("open"), [..."open"].join() === [...open].join());
const accented = query.slice(27, 31), wide = query.slice(37, 39);
console.log(accented === "café", accented === "cafe", accented === "cafè", wide === "世界", wide === "世世", wide === "ab", accented.length, wide.length, accented + wide, wide.charCodeAt(1));
const narrowInWide = ("世open界" + pad).slice(1, 5);
console.log(narrowInWide === "open", "open" === narrowInWide, narrowInWide === "done", narrowInWide === open, narrowInWide + "|" + open, narrowInWide.length, new Map([["open", 1]]).get(narrowInWide));
const parts = query.split("&").map(part => part.split("="));
console.log(parts.filter(([name]) => name === "status").map(([, value]) => value).join(), parts.filter(([, value]) => value === "").length, parts.find(([name]) => name === "limit")[1] === "25");
const matched = /owner=([^&]*)/.exec(query)[1];
console.log(matched === "café", matched === accented, matched.length);
const rope = "op" + String(process.argv.length > 99 ? "x" : "en");
console.log(rope === open, open === rope, rope === "open", pieceOf(7, 11) === rope, (rope + "") === pieceOf(7, 11));
let kept = []; for (let i = 0; i < 2000; i++) { const piece = query.slice(7 + (i & 1) * 51, 11 + (i & 1) * 51); if (piece === "open" || piece === "done") kept.push(piece); if (kept.length > 64) kept = kept.slice(32); }
console.log(kept.length, kept[0], kept[1], kept.at(-1));
