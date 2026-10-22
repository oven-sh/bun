// A character read from a string and compared with one-character literals in an if chain.
declare const console: any;

const texts: string[] = ["", "a", "abcdefgh", "hgfedcba", "a\0b", "\xe9a", "Āa￿b", "😀c", "  \t\n,;"];

function byIndex(text: string, i: number): number {
    const c = text[i];
    if (c === "a") return 1;
    if (c === "b") return 2;
    if (c === "c") return 3;
    if (c === "d") return 4;
    if (c === "\0") return 5;
    if (c === "\xe9") return 6;
    if (c === "Ā") return 7;
    if (c === "￿") return 8;
    return 0;
}

function byCharAt(text: string, i: number): number {
    const c = text.charAt(i);
    if (c === "a") return 1;
    else if (c === "b") return 2;
    else if (c === "c") return 3;
    else if (c === "") return 4;
    else if (c === "ab") return 5;
    return 0;
}

function byAt(text: string, i: number): number {
    const c = text.at(i);
    if (c === "a") return 1;
    if (c === "h") return 2;
    if (c === ";") return 3;
    if (c === undefined) return 4;
    return 0;
}

function repeatedCase(text: string, i: number): number {
    const c = text[i];
    if (c === "a") return 1;
    if (c === "b") return 2;
    if (c === "a") return 3;
    if (c === "c") return 4;
    return 0;
}

function keepsTheCharacter(text: string, i: number): string | undefined | number {
    const c = text[i];
    if (c === "a") return 1;
    if (c === "b") return 2;
    if (c === "c") return 3;
    return c;
}

function countOfSeparators(text: string): number {
    let count = 0;
    for (let i = 0; i <= text.length; i++) {
        const c = text[i];
        if (c === " ") count += 1;
        else if (c === "\t") count += 10;
        else if (c === "\n") count += 100;
        else if (c === ",") count += 1000;
        else if (c === ";") count += 10000;
        else count += 100000;
    }
    return count;
}

for (const text of texts) {
    for (let i = -2; i <= text.length + 1; i++)
        console.log(JSON.stringify(text), i, byIndex(text, i), byCharAt(text, i), byAt(text, i), repeatedCase(text, i), keepsTheCharacter(text, i));
    console.log(JSON.stringify(text), countOfSeparators(text));
}
console.log(byIndex("abc", 1.5), byIndex("abc", NaN), byIndex("abc", -0), byCharAt("abc", 1.5), byCharAt("abc", NaN), byCharAt("abc", Infinity), byAt("abc", -1.5), byAt("abc", NaN));
export {};
