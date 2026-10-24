// The texts of a program's strings lie in one pool in the executable. Whatever stands between them there, each string is what the source says, also where one is the end or a part of another.
declare const console: { log(...args: unknown[]): void }
const parts = ["firstHalfOfAWord", "secondHalfOfAWord", "HalfOfAWord", "OfAWord", "Word", "d", "", "first", "firstHalf", "été", "étéHalf", "日本", "日本語"]
const record: Record<string, number> = { firstHalfOfAWord: 1, secondHalfOfAWord: 2, HalfOfAWord: 3, Word: 4 }
for (const part of parts) console.log(JSON.stringify(part), part.length, record[part] ?? "none", part === "Word", part.endsWith("Word"), part.startsWith("first"), part + "|")
console.log(parts.join(""), Object.keys(record).join(""))
