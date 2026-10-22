// parseInt of a piece of a string, with a radix.
declare const console: any;

const texts: string[] = ["", "0", "12345", "ff00ff", "0x1f", "  42  ", "-17", "+8", "zz", "undefined", "１２", "1e3", "9007199254740993", "101010", "7\0", "Ā12"];
const radixes: number[] = [0, 2, 8, 10, 16, 36, 37, 1, -1, 4294967306, -4294967286];

function decimal(text: string, from: number, to: number): number { return parseInt(text.slice(from, to), 10); }
function hexadecimal(text: string, from: number, to: number): number { return parseInt(text.substring(from, to), 16); }
function anyInteger(text: string, from: number, radix: number): number { return parseInt(text.slice(from), radix | 0); }
function anyNumber(text: string, from: number, radix: number): number { return parseInt(text.slice(from), radix); }
function anyValue(text: string, from: number, radix: any): number { return parseInt(text.slice(from), radix); }
function digit(text: string, i: number): number { return parseInt(text[i], 10); }
function digitOfBase36(text: string, i: number): number { return parseInt(text[i], 36); }
function digitOfBase31(text: string, i: number): number { return parseInt(text[i], 31); }
function digitOfBase30(text: string, i: number): number { return parseInt(text[i], 30); }
function digitOfAnyBase(text: string, i: number, radix: number): number { return parseInt(text[i], radix | 0); }
function character(text: string, i: number): number { return parseInt(text.charAt(i), 16); }
function last(text: string): number { return parseInt(text.at(-1) as string, 36); }

for (const text of texts) {
    for (let from = -1; from <= text.length + 1; from++) {
        console.log(JSON.stringify(text), from, decimal(text, from, from + 3), hexadecimal(text, from, from + 2), digit(text, from), digitOfBase36(text, from), digitOfBase31(text, from), digitOfBase30(text, from), character(text, from));
        for (const radix of radixes)
            console.log(radix, anyInteger(text, from, radix), anyNumber(text, from, radix), anyValue(text, from, radix), digitOfAnyBase(text, from, radix));
    }
    console.log(last(text), anyNumber(text, 0, 16.9), anyNumber(text, 0, NaN), anyValue(text, 0, "16"), anyValue(text, 0, undefined), anyValue(text, 0, null), anyValue(text, 0, { valueOf() { return 8; } }));
}
export {};
