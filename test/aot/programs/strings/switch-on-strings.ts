// `switch` over 1 to 300 string cases takes the case plain Bun takes, for every text length, internal representation and static type of the subject.
const flat = (text: string): string => text.split("").join("");
function rope(text: string): string {
    const middle = text.length >> 1;
    return flat(text.slice(0, middle)) + flat(text.slice(middle));
}
function part(text: string): string {
    return flat("<<" + text + ">>").slice(2, 2 + text.length);
}
function widePart(text: string): string {
    return flat("Ā" + text).slice(1);
}
function wideFlat(text: string): string {
    return Buffer.from(text, "utf16le").toString("utf16le");
}
function wideRope(text: string): string {
    const middle = text.length >> 1;
    return widePart(text.slice(0, middle)) + flat(text.slice(middle));
}
const representations: ((text: string) => string)[] = [text => text, flat, rope, part, widePart, wideFlat, wideRope];

function nearMisses(text: string): string[] {
    const misses = [text + "~", "~" + text];
    if (!text.length)
        return misses;
    misses.push(text.slice(0, -1), text.slice(1));
    for (const at of [0, text.length >> 1, text.length - 1]) {
        const unit = text.charCodeAt(at);
        for (const other of [unit ^ 1, unit + 0x100])
            misses.push(text.slice(0, at) + String.fromCharCode(other) + text.slice(at + 1));
    }
    return misses;
}

let failures = 0;
function report(name: string, subject: unknown, chosen: number, expected: number): void {
    if (failures++ < 20)
        console.log("wrong:", name, typeof subject === "string" ? JSON.stringify(subject) : typeof subject, "chose", chosen, "expected", expected);
}

function subjectsFor(texts: readonly string[]): string[] {
    const subjects: string[] = [];
    for (const text of texts) {
        for (const represent of representations)
            subjects.push(represent(text));
        subjects.push(...nearMisses(text), ...nearMisses(text).map(flat));
    }
    return subjects;
}

// The chooser sees each subject before anything else reads it, so a rope is still a rope in the first round and flat in the second.
function check(name: string, choose: (subject: any) => number, texts: readonly string[]): void {
    const subjects = subjectsFor(texts);
    let sum = 0;
    for (let round = 0; round < 2; round++) {
        for (const subject of subjects) {
            const chosen = choose(subject);
            const expected = texts.indexOf(subject) + 1;
            if (chosen !== expected)
                report(name, subject, chosen, expected);
            sum = (sum * 31 + chosen) | 0;
        }
    }
    console.log(name, subjects.length, sum);
}

function checkInLoop(name: string, chooseEach: (subjects: readonly any[]) => number[], texts: readonly string[]): void {
    const subjects = subjectsFor(texts);
    let sum = 0;
    for (let round = 0; round < 2; round++) {
        const chosen = chooseEach(subjects);
        for (let i = 0; i < subjects.length; i++) {
            const expected = texts.indexOf(subjects[i]) + 1;
            if (chosen[i] !== expected)
                report(name, subjects[i], chosen[i], expected);
            sum = (sum * 31 + chosen[i]) | 0;
        }
    }
    console.log(name, subjects.length, sum);
}

function checkMembers(name: string, choose: (member: any) => number, members: readonly string[], expected: readonly number[]): void {
    let sum = 0;
    for (let round = 0; round < 2; round++) {
        for (let i = 0; i < members.length; i++) {
            for (const represent of representations) {
                const chosen = choose(represent(members[i]));
                if (chosen !== expected[i])
                    report(name, members[i], chosen, expected[i]);
                sum = (sum * 31 + chosen) | 0;
            }
        }
    }
    console.log(name, sum);
}

const notStrings: unknown[] = [undefined, null, 5, 0, -0, NaN, true, false, {}, [], ["a"], 5n, Symbol("a"), new String("a"), () => "a"];
function checkNotStrings(name: string, choose: (subject: unknown) => number): void {
    for (const subject of notStrings) {
        const chosen = choose(subject);
        if (chosen)
            report(name, subject, chosen, 0);
    }
    console.log(name, "takes the default for", notStrings.length, "values that are not strings");
}

function nothing(isNull: boolean): any {
    return isNull ? null : undefined;
}

const single = [
    "alpha",
] as const;
const sentence = [
    "the quick brown fox jumps over the lazy dog",
] as const;
const pair = [
    "left", "rise",
] as const;
const triple = [
    "get", "getOwn", "getOwnKeys",
] as const;
const tokens = [
    "+", "-", "*", "/", "%", "(", ")", "a", "Z", "0", " ", "\n", "\0",
    "if", "in", "do", "of", "as", "is", "no", "on", "for", "let", "var", "new", "try",
    "null", "true", "void", "this", "else", "case", "with", "enum",
] as const;
const mixed = [
    "", "é", "😀", "日本語", "e", "cafe", "café", "caf", "éé", "😀😀", "x", "naïve and longer than seven", "plain and longer than seven",
] as const;
const prefixes = [
    "a", "ab", "abc", "abcd",
    "abcde", "abcdef", "abcdefg", "abcdefgh",
    "abcdefghi", "abcdefghij", "abcdefghijk", "abcdefghijkl",
    "abcdefghijklm", "abcdefghijklmn", "abcdefghijklmno", "abcdefghijklmnop",
    "abcdefghijklmnopq", "abcdefghijklmnopqr", "abcdefghijklmnopqrs", "abcdefghijklmnopqrst",
    "abcdefghijklmnopqrstu", "abcdefghijklmnopqrstuv", "abcdefghijklmnopqrstuvw", "abcdefghijklmnopqrstuvwx",
    "abcdefghijklmnopqrstuvwxy", "abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnopqrstuvwxyz0", "abcdefghijklmnopqrstuvwxyz01",
    "abcdefghijklmnopqrstuvwxyz012", "abcdefghijklmnopqrstuvwxyz0123", "abcdefghijklmnopqrstuvwxyz01234", "abcdefghijklmnopqrstuvwxyz012345",
    "abcdefghijklmnopqrstuvwxyz0123456", "abcdefghijklmnopqrstuvwxyz01234567", "abcdefghijklmnopqrstuvwxyz012345678", "abcdefghijklmnopqrstuvwxyz0123456789",
    "abcdefghijklmnopqrstuvwxyz0123456789-", "abcdefghijklmnopqrstuvwxyz0123456789-_", "abcdefghijklmnopqrstuvwxyz0123456789-_.", "abcdefghijklmnopqrstuvwxyz0123456789-_.:",
] as const;
const grid = [
    "r0-shared-a!", "r0-shared-b!", "r0-shared-c!", "r0-shared-d!", "r0-shared-e!", "r1-shared-a!", "r1-shared-b!", "r1-shared-c!", "r1-shared-d!", "r1-shared-e!",
    "r2-shared-a!", "r2-shared-b!", "r2-shared-c!", "r2-shared-d!", "r2-shared-e!", "r3-shared-a!", "r3-shared-b!", "r3-shared-c!", "r3-shared-d!", "r3-shared-e!",
    "r4-shared-a!", "r4-shared-b!", "r4-shared-c!", "r4-shared-d!", "r4-shared-e!", "r5-shared-a!", "r5-shared-b!", "r5-shared-c!", "r5-shared-d!", "r5-shared-e!",
    "r6-shared-a!", "r6-shared-b!", "r6-shared-c!", "r6-shared-d!", "r6-shared-e!", "r7-shared-a!", "r7-shared-b!", "r7-shared-c!", "r7-shared-d!", "r7-shared-e!",
] as const;
const longKeys = [
    "configuration/section/subsection/key-one", "configuration/section/subsection/key-two", "configuration/section/subsection/key-six", "configuration/section/subsection/key-ten",
] as const;
const keys = [
    "k000z", "k001z", "k002z", "k003z", "k004z", "k005z", "k006z", "k007z", "k008z", "k009z",
    "k010z", "k011z", "k012z", "k013z", "k014z", "k015z", "k016z", "k017z", "k018z", "k019z",
    "k020z", "k021z", "k022z", "k023z", "k024z", "k025z", "k026z", "k027z", "k028z", "k029z",
    "k030z", "k031z", "k032z", "k033z", "k034z", "k035z", "k036z", "k037z", "k038z", "k039z",
    "k040z", "k041z", "k042z", "k043z", "k044z", "k045z", "k046z", "k047z", "k048z", "k049z",
    "k050z", "k051z", "k052z", "k053z", "k054z", "k055z", "k056z", "k057z", "k058z", "k059z",
    "k060z", "k061z", "k062z", "k063z", "k064z", "k065z", "k066z", "k067z", "k068z", "k069z",
    "k070z", "k071z", "k072z", "k073z", "k074z", "k075z", "k076z", "k077z", "k078z", "k079z",
    "k080z", "k081z", "k082z", "k083z", "k084z", "k085z", "k086z", "k087z", "k088z", "k089z",
    "k090z", "k091z", "k092z", "k093z", "k094z", "k095z", "k096z", "k097z", "k098z", "k099z",
    "prefix/100", "prefix/101", "prefix/102", "prefix/103", "prefix/104", "prefix/105", "prefix/106", "prefix/107", "prefix/108", "prefix/109",
    "prefix/110", "prefix/111", "prefix/112", "prefix/113", "prefix/114", "prefix/115", "prefix/116", "prefix/117", "prefix/118", "prefix/119",
    "prefix/120", "prefix/121", "prefix/122", "prefix/123", "prefix/124", "prefix/125", "prefix/126", "prefix/127", "prefix/128", "prefix/129",
    "prefix/130", "prefix/131", "prefix/132", "prefix/133", "prefix/134", "prefix/135", "prefix/136", "prefix/137", "prefix/138", "prefix/139",
    "prefix/140", "prefix/141", "prefix/142", "prefix/143", "prefix/144", "prefix/145", "prefix/146", "prefix/147", "prefix/148", "prefix/149",
    "prefix/150", "prefix/151", "prefix/152", "prefix/153", "prefix/154", "prefix/155", "prefix/156", "prefix/157", "prefix/158", "prefix/159",
    "prefix/160", "prefix/161", "prefix/162", "prefix/163", "prefix/164", "prefix/165", "prefix/166", "prefix/167", "prefix/168", "prefix/169",
    "prefix/170", "prefix/171", "prefix/172", "prefix/173", "prefix/174", "prefix/175", "prefix/176", "prefix/177", "prefix/178", "prefix/179",
    "prefix/180", "prefix/181", "prefix/182", "prefix/183", "prefix/184", "prefix/185", "prefix/186", "prefix/187", "prefix/188", "prefix/189",
    "prefix/190", "prefix/191", "prefix/192", "prefix/193", "prefix/194", "prefix/195", "prefix/196", "prefix/197", "prefix/198", "prefix/199",
    "200-abcdefghijklmnopqrs", "201-abcdefghijklmnopqrst", "202-abcdefghijklmnopqrstu", "203-abcdefghijklmnopqrstuv", "204-abcdefghijklmnopqrstuvw", "205-abcdefghijklmnopqrstuvwx", "206-abcdefghijklmnopqrstuvwxy", "207-abcdefghijklmnopqrstuvwxyz", "208-a", "209-ab",
    "210-abc", "211-abcd", "212-abcde", "213-abcdef", "214-abcdefg", "215-abcdefgh", "216-abcdefghi", "217-abcdefghij", "218-abcdefghijk", "219-abcdefghijkl",
    "220-abcdefghijklm", "221-abcdefghijklmn", "222-abcdefghijklmno", "223-abcdefghijklmnop", "224-abcdefghijklmnopq", "225-abcdefghijklmnopqr", "226-abcdefghijklmnopqrs", "227-abcdefghijklmnopqrst", "228-abcdefghijklmnopqrstu", "229-abcdefghijklmnopqrstuv",
    "230-abcdefghijklmnopqrstuvw", "231-abcdefghijklmnopqrstuvwx", "232-abcdefghijklmnopqrstuvwxy", "233-abcdefghijklmnopqrstuvwxyz", "234-a", "235-ab", "236-abc", "237-abcd", "238-abcde", "239-abcdef",
    "240-abcdefg", "241-abcdefgh", "242-abcdefghi", "243-abcdefghij", "244-abcdefghijk", "245-abcdefghijkl", "246-abcdefghijklm", "247-abcdefghijklmn", "248-abcdefghijklmno", "249-abcdefghijklmnop",
    "250-abcdefghijklmnopq", "251-abcdefghijklmnopqr", "252-abcdefghijklmnopqrs", "253-abcdefghijklmnopqrst", "254-abcdefghijklmnopqrstu", "255-abcdefghijklmnopqrstuv", "256-abcdefghijklmnopqrstuvw", "257-abcdefghijklmnopqrstuvwx", "258-abcdefghijklmnopqrstuvwxy", "259-abcdefghijklmnopqrstuvwxyz",
    "260-a", "261-ab", "262-abc", "263-abcd", "264-abcde", "265-abcdef", "266-abcdefg", "267-abcdefgh", "268-abcdefghi", "269-abcdefghij",
    "270-abcdefghijk", "271-abcdefghijkl", "272-abcdefghijklm", "273-abcdefghijklmn", "274-abcdefghijklmno", "275-abcdefghijklmnop", "276-abcdefghijklmnopq", "277-abcdefghijklmnopqr", "278-abcdefghijklmnopqrs", "279-abcdefghijklmnopqrst",
    "280-abcdefghijklmnopqrstu", "281-abcdefghijklmnopqrstuv", "282-abcdefghijklmnopqrstuvw", "283-abcdefghijklmnopqrstuvwx", "284-abcdefghijklmnopqrstuvwxy", "285-abcdefghijklmnopqrstuvwxyz", "286-a", "287-ab", "288-abc", "289-abcd",
    "290-abcde", "291-abcdef", "292-abcdefg", "293-abcdefgh", "294-abcdefghi", "295-abcdefghij", "296-abcdefghijk", "297-abcdefghijkl", "298-abcdefghijklm", "299-abcdefghijklmn",
] as const;

function chooseSingle(subject: string): number {
    switch (subject) {
        case "alpha": return 1;
        default: return 0;
    }
}
function chooseSentence(subject: string): number {
    switch (subject) {
        case "the quick brown fox jumps over the lazy dog": return 1;
        default: return 0;
    }
}
function choosePair(subject: string): number {
    switch (subject) {
        case "left": return 1; case "rise": return 2;
        default: return 0;
    }
}
function chooseTriple(subject: string): number {
    switch (subject) {
        case "get": return 1; case "getOwn": return 2; case "getOwnKeys": return 3;
        default: return 0;
    }
}
function chooseToken(subject: string): number {
    switch (subject) {
        case "+": return 1; case "-": return 2; case "*": return 3; case "/": return 4; case "%": return 5; case "(": return 6; case ")": return 7;
        case "a": return 8; case "Z": return 9; case "0": return 10; case " ": return 11; case "\n": return 12; case "\0": return 13; case "if": return 14;
        case "in": return 15; case "do": return 16; case "of": return 17; case "as": return 18; case "is": return 19; case "no": return 20; case "on": return 21;
        case "for": return 22; case "let": return 23; case "var": return 24; case "new": return 25; case "try": return 26; case "null": return 27; case "true": return 28;
        case "void": return 29; case "this": return 30; case "else": return 31; case "case": return 32; case "with": return 33; case "enum": return 34;
        default: return 0;
    }
}
function chooseMixed(subject: string): number {
    switch (subject) {
        case "": return 1; case "é": return 2; case "😀": return 3; case "日本語": return 4; case "e": return 5; case "cafe": return 6; case "café": return 7;
        case "caf": return 8; case "éé": return 9; case "😀😀": return 10; case "x": return 11; case "naïve and longer than seven": return 12; case "plain and longer than seven": return 13;
        default: return 0;
    }
}
function choosePrefix(subject: string): number {
    switch (subject) {
        case "a": return 1; case "ab": return 2; case "abc": return 3;
        case "abcd": return 4; case "abcde": return 5; case "abcdef": return 6;
        case "abcdefg": return 7; case "abcdefgh": return 8; case "abcdefghi": return 9;
        case "abcdefghij": return 10; case "abcdefghijk": return 11; case "abcdefghijkl": return 12;
        case "abcdefghijklm": return 13; case "abcdefghijklmn": return 14; case "abcdefghijklmno": return 15;
        case "abcdefghijklmnop": return 16; case "abcdefghijklmnopq": return 17; case "abcdefghijklmnopqr": return 18;
        case "abcdefghijklmnopqrs": return 19; case "abcdefghijklmnopqrst": return 20; case "abcdefghijklmnopqrstu": return 21;
        case "abcdefghijklmnopqrstuv": return 22; case "abcdefghijklmnopqrstuvw": return 23; case "abcdefghijklmnopqrstuvwx": return 24;
        case "abcdefghijklmnopqrstuvwxy": return 25; case "abcdefghijklmnopqrstuvwxyz": return 26; case "abcdefghijklmnopqrstuvwxyz0": return 27;
        case "abcdefghijklmnopqrstuvwxyz01": return 28; case "abcdefghijklmnopqrstuvwxyz012": return 29; case "abcdefghijklmnopqrstuvwxyz0123": return 30;
        case "abcdefghijklmnopqrstuvwxyz01234": return 31; case "abcdefghijklmnopqrstuvwxyz012345": return 32; case "abcdefghijklmnopqrstuvwxyz0123456": return 33;
        case "abcdefghijklmnopqrstuvwxyz01234567": return 34; case "abcdefghijklmnopqrstuvwxyz012345678": return 35; case "abcdefghijklmnopqrstuvwxyz0123456789": return 36;
        case "abcdefghijklmnopqrstuvwxyz0123456789-": return 37; case "abcdefghijklmnopqrstuvwxyz0123456789-_": return 38; case "abcdefghijklmnopqrstuvwxyz0123456789-_.": return 39;
        case "abcdefghijklmnopqrstuvwxyz0123456789-_.:": return 40;
        default: return 0;
    }
}
function chooseGridCell(subject: string): number {
    switch (subject) {
        case "r0-shared-a!": return 1; case "r0-shared-b!": return 2; case "r0-shared-c!": return 3; case "r0-shared-d!": return 4; case "r0-shared-e!": return 5;
        case "r1-shared-a!": return 6; case "r1-shared-b!": return 7; case "r1-shared-c!": return 8; case "r1-shared-d!": return 9; case "r1-shared-e!": return 10;
        case "r2-shared-a!": return 11; case "r2-shared-b!": return 12; case "r2-shared-c!": return 13; case "r2-shared-d!": return 14; case "r2-shared-e!": return 15;
        case "r3-shared-a!": return 16; case "r3-shared-b!": return 17; case "r3-shared-c!": return 18; case "r3-shared-d!": return 19; case "r3-shared-e!": return 20;
        case "r4-shared-a!": return 21; case "r4-shared-b!": return 22; case "r4-shared-c!": return 23; case "r4-shared-d!": return 24; case "r4-shared-e!": return 25;
        case "r5-shared-a!": return 26; case "r5-shared-b!": return 27; case "r5-shared-c!": return 28; case "r5-shared-d!": return 29; case "r5-shared-e!": return 30;
        case "r6-shared-a!": return 31; case "r6-shared-b!": return 32; case "r6-shared-c!": return 33; case "r6-shared-d!": return 34; case "r6-shared-e!": return 35;
        case "r7-shared-a!": return 36; case "r7-shared-b!": return 37; case "r7-shared-c!": return 38; case "r7-shared-d!": return 39; case "r7-shared-e!": return 40;
        default: return 0;
    }
}
function chooseLongKey(subject: string): number {
    switch (subject) {
        case "configuration/section/subsection/key-one": return 1; case "configuration/section/subsection/key-two": return 2;
        case "configuration/section/subsection/key-six": return 3; case "configuration/section/subsection/key-ten": return 4;
        default: return 0;
    }
}
function chooseKey(subject: string): number {
    switch (subject) {
        case "k000z": return 1; case "k001z": return 2; case "k002z": return 3; case "k003z": return 4; case "k004z": return 5;
        case "k005z": return 6; case "k006z": return 7; case "k007z": return 8; case "k008z": return 9; case "k009z": return 10;
        case "k010z": return 11; case "k011z": return 12; case "k012z": return 13; case "k013z": return 14; case "k014z": return 15;
        case "k015z": return 16; case "k016z": return 17; case "k017z": return 18; case "k018z": return 19; case "k019z": return 20;
        case "k020z": return 21; case "k021z": return 22; case "k022z": return 23; case "k023z": return 24; case "k024z": return 25;
        case "k025z": return 26; case "k026z": return 27; case "k027z": return 28; case "k028z": return 29; case "k029z": return 30;
        case "k030z": return 31; case "k031z": return 32; case "k032z": return 33; case "k033z": return 34; case "k034z": return 35;
        case "k035z": return 36; case "k036z": return 37; case "k037z": return 38; case "k038z": return 39; case "k039z": return 40;
        case "k040z": return 41; case "k041z": return 42; case "k042z": return 43; case "k043z": return 44; case "k044z": return 45;
        case "k045z": return 46; case "k046z": return 47; case "k047z": return 48; case "k048z": return 49; case "k049z": return 50;
        case "k050z": return 51; case "k051z": return 52; case "k052z": return 53; case "k053z": return 54; case "k054z": return 55;
        case "k055z": return 56; case "k056z": return 57; case "k057z": return 58; case "k058z": return 59; case "k059z": return 60;
        case "k060z": return 61; case "k061z": return 62; case "k062z": return 63; case "k063z": return 64; case "k064z": return 65;
        case "k065z": return 66; case "k066z": return 67; case "k067z": return 68; case "k068z": return 69; case "k069z": return 70;
        case "k070z": return 71; case "k071z": return 72; case "k072z": return 73; case "k073z": return 74; case "k074z": return 75;
        case "k075z": return 76; case "k076z": return 77; case "k077z": return 78; case "k078z": return 79; case "k079z": return 80;
        case "k080z": return 81; case "k081z": return 82; case "k082z": return 83; case "k083z": return 84; case "k084z": return 85;
        case "k085z": return 86; case "k086z": return 87; case "k087z": return 88; case "k088z": return 89; case "k089z": return 90;
        case "k090z": return 91; case "k091z": return 92; case "k092z": return 93; case "k093z": return 94; case "k094z": return 95;
        case "k095z": return 96; case "k096z": return 97; case "k097z": return 98; case "k098z": return 99; case "k099z": return 100;
        case "prefix/100": return 101; case "prefix/101": return 102; case "prefix/102": return 103; case "prefix/103": return 104; case "prefix/104": return 105;
        case "prefix/105": return 106; case "prefix/106": return 107; case "prefix/107": return 108; case "prefix/108": return 109; case "prefix/109": return 110;
        case "prefix/110": return 111; case "prefix/111": return 112; case "prefix/112": return 113; case "prefix/113": return 114; case "prefix/114": return 115;
        case "prefix/115": return 116; case "prefix/116": return 117; case "prefix/117": return 118; case "prefix/118": return 119; case "prefix/119": return 120;
        case "prefix/120": return 121; case "prefix/121": return 122; case "prefix/122": return 123; case "prefix/123": return 124; case "prefix/124": return 125;
        case "prefix/125": return 126; case "prefix/126": return 127; case "prefix/127": return 128; case "prefix/128": return 129; case "prefix/129": return 130;
        case "prefix/130": return 131; case "prefix/131": return 132; case "prefix/132": return 133; case "prefix/133": return 134; case "prefix/134": return 135;
        case "prefix/135": return 136; case "prefix/136": return 137; case "prefix/137": return 138; case "prefix/138": return 139; case "prefix/139": return 140;
        case "prefix/140": return 141; case "prefix/141": return 142; case "prefix/142": return 143; case "prefix/143": return 144; case "prefix/144": return 145;
        case "prefix/145": return 146; case "prefix/146": return 147; case "prefix/147": return 148; case "prefix/148": return 149; case "prefix/149": return 150;
        case "prefix/150": return 151; case "prefix/151": return 152; case "prefix/152": return 153; case "prefix/153": return 154; case "prefix/154": return 155;
        case "prefix/155": return 156; case "prefix/156": return 157; case "prefix/157": return 158; case "prefix/158": return 159; case "prefix/159": return 160;
        case "prefix/160": return 161; case "prefix/161": return 162; case "prefix/162": return 163; case "prefix/163": return 164; case "prefix/164": return 165;
        case "prefix/165": return 166; case "prefix/166": return 167; case "prefix/167": return 168; case "prefix/168": return 169; case "prefix/169": return 170;
        case "prefix/170": return 171; case "prefix/171": return 172; case "prefix/172": return 173; case "prefix/173": return 174; case "prefix/174": return 175;
        case "prefix/175": return 176; case "prefix/176": return 177; case "prefix/177": return 178; case "prefix/178": return 179; case "prefix/179": return 180;
        case "prefix/180": return 181; case "prefix/181": return 182; case "prefix/182": return 183; case "prefix/183": return 184; case "prefix/184": return 185;
        case "prefix/185": return 186; case "prefix/186": return 187; case "prefix/187": return 188; case "prefix/188": return 189; case "prefix/189": return 190;
        case "prefix/190": return 191; case "prefix/191": return 192; case "prefix/192": return 193; case "prefix/193": return 194; case "prefix/194": return 195;
        case "prefix/195": return 196; case "prefix/196": return 197; case "prefix/197": return 198; case "prefix/198": return 199; case "prefix/199": return 200;
        case "200-abcdefghijklmnopqrs": return 201; case "201-abcdefghijklmnopqrst": return 202; case "202-abcdefghijklmnopqrstu": return 203; case "203-abcdefghijklmnopqrstuv": return 204; case "204-abcdefghijklmnopqrstuvw": return 205;
        case "205-abcdefghijklmnopqrstuvwx": return 206; case "206-abcdefghijklmnopqrstuvwxy": return 207; case "207-abcdefghijklmnopqrstuvwxyz": return 208; case "208-a": return 209; case "209-ab": return 210;
        case "210-abc": return 211; case "211-abcd": return 212; case "212-abcde": return 213; case "213-abcdef": return 214; case "214-abcdefg": return 215;
        case "215-abcdefgh": return 216; case "216-abcdefghi": return 217; case "217-abcdefghij": return 218; case "218-abcdefghijk": return 219; case "219-abcdefghijkl": return 220;
        case "220-abcdefghijklm": return 221; case "221-abcdefghijklmn": return 222; case "222-abcdefghijklmno": return 223; case "223-abcdefghijklmnop": return 224; case "224-abcdefghijklmnopq": return 225;
        case "225-abcdefghijklmnopqr": return 226; case "226-abcdefghijklmnopqrs": return 227; case "227-abcdefghijklmnopqrst": return 228; case "228-abcdefghijklmnopqrstu": return 229; case "229-abcdefghijklmnopqrstuv": return 230;
        case "230-abcdefghijklmnopqrstuvw": return 231; case "231-abcdefghijklmnopqrstuvwx": return 232; case "232-abcdefghijklmnopqrstuvwxy": return 233; case "233-abcdefghijklmnopqrstuvwxyz": return 234; case "234-a": return 235;
        case "235-ab": return 236; case "236-abc": return 237; case "237-abcd": return 238; case "238-abcde": return 239; case "239-abcdef": return 240;
        case "240-abcdefg": return 241; case "241-abcdefgh": return 242; case "242-abcdefghi": return 243; case "243-abcdefghij": return 244; case "244-abcdefghijk": return 245;
        case "245-abcdefghijkl": return 246; case "246-abcdefghijklm": return 247; case "247-abcdefghijklmn": return 248; case "248-abcdefghijklmno": return 249; case "249-abcdefghijklmnop": return 250;
        case "250-abcdefghijklmnopq": return 251; case "251-abcdefghijklmnopqr": return 252; case "252-abcdefghijklmnopqrs": return 253; case "253-abcdefghijklmnopqrst": return 254; case "254-abcdefghijklmnopqrstu": return 255;
        case "255-abcdefghijklmnopqrstuv": return 256; case "256-abcdefghijklmnopqrstuvw": return 257; case "257-abcdefghijklmnopqrstuvwx": return 258; case "258-abcdefghijklmnopqrstuvwxy": return 259; case "259-abcdefghijklmnopqrstuvwxyz": return 260;
        case "260-a": return 261; case "261-ab": return 262; case "262-abc": return 263; case "263-abcd": return 264; case "264-abcde": return 265;
        case "265-abcdef": return 266; case "266-abcdefg": return 267; case "267-abcdefgh": return 268; case "268-abcdefghi": return 269; case "269-abcdefghij": return 270;
        case "270-abcdefghijk": return 271; case "271-abcdefghijkl": return 272; case "272-abcdefghijklm": return 273; case "273-abcdefghijklmn": return 274; case "274-abcdefghijklmno": return 275;
        case "275-abcdefghijklmnop": return 276; case "276-abcdefghijklmnopq": return 277; case "277-abcdefghijklmnopqr": return 278; case "278-abcdefghijklmnopqrs": return 279; case "279-abcdefghijklmnopqrst": return 280;
        case "280-abcdefghijklmnopqrstu": return 281; case "281-abcdefghijklmnopqrstuv": return 282; case "282-abcdefghijklmnopqrstuvw": return 283; case "283-abcdefghijklmnopqrstuvwx": return 284; case "284-abcdefghijklmnopqrstuvwxy": return 285;
        case "285-abcdefghijklmnopqrstuvwxyz": return 286; case "286-a": return 287; case "287-ab": return 288; case "288-abc": return 289; case "289-abcd": return 290;
        case "290-abcde": return 291; case "291-abcdef": return 292; case "292-abcdefg": return 293; case "293-abcdefgh": return 294; case "294-abcdefghi": return 295;
        case "295-abcdefghij": return 296; case "296-abcdefghijk": return 297; case "297-abcdefghijkl": return 298; case "298-abcdefghijklm": return 299; case "299-abcdefghijklmn": return 300;
        default: return 0;
    }
}

function chooseSingleFromUnknown(subject: unknown): number {
    switch (subject) {
        case "alpha": return 1;
        default: return 0;
    }
}
function chooseSentenceFromUnknown(subject: unknown): number {
    switch (subject) {
        case "the quick brown fox jumps over the lazy dog": return 1;
        default: return 0;
    }
}
function choosePairFromUnknown(subject: unknown): number {
    switch (subject) {
        case "left": return 1; case "rise": return 2;
        default: return 0;
    }
}
function chooseTripleFromUnknown(subject: unknown): number {
    switch (subject) {
        case "get": return 1; case "getOwn": return 2; case "getOwnKeys": return 3;
        default: return 0;
    }
}
function chooseTokenFromUnknown(subject: unknown): number {
    switch (subject) {
        case "+": return 1; case "-": return 2; case "*": return 3; case "/": return 4; case "%": return 5; case "(": return 6; case ")": return 7;
        case "a": return 8; case "Z": return 9; case "0": return 10; case " ": return 11; case "\n": return 12; case "\0": return 13; case "if": return 14;
        case "in": return 15; case "do": return 16; case "of": return 17; case "as": return 18; case "is": return 19; case "no": return 20; case "on": return 21;
        case "for": return 22; case "let": return 23; case "var": return 24; case "new": return 25; case "try": return 26; case "null": return 27; case "true": return 28;
        case "void": return 29; case "this": return 30; case "else": return 31; case "case": return 32; case "with": return 33; case "enum": return 34;
        default: return 0;
    }
}
function chooseMixedFromUnknown(subject: unknown): number {
    switch (subject) {
        case "": return 1; case "é": return 2; case "😀": return 3; case "日本語": return 4; case "e": return 5; case "cafe": return 6; case "café": return 7;
        case "caf": return 8; case "éé": return 9; case "😀😀": return 10; case "x": return 11; case "naïve and longer than seven": return 12; case "plain and longer than seven": return 13;
        default: return 0;
    }
}
function choosePrefixFromUnknown(subject: unknown): number {
    switch (subject) {
        case "a": return 1; case "ab": return 2; case "abc": return 3;
        case "abcd": return 4; case "abcde": return 5; case "abcdef": return 6;
        case "abcdefg": return 7; case "abcdefgh": return 8; case "abcdefghi": return 9;
        case "abcdefghij": return 10; case "abcdefghijk": return 11; case "abcdefghijkl": return 12;
        case "abcdefghijklm": return 13; case "abcdefghijklmn": return 14; case "abcdefghijklmno": return 15;
        case "abcdefghijklmnop": return 16; case "abcdefghijklmnopq": return 17; case "abcdefghijklmnopqr": return 18;
        case "abcdefghijklmnopqrs": return 19; case "abcdefghijklmnopqrst": return 20; case "abcdefghijklmnopqrstu": return 21;
        case "abcdefghijklmnopqrstuv": return 22; case "abcdefghijklmnopqrstuvw": return 23; case "abcdefghijklmnopqrstuvwx": return 24;
        case "abcdefghijklmnopqrstuvwxy": return 25; case "abcdefghijklmnopqrstuvwxyz": return 26; case "abcdefghijklmnopqrstuvwxyz0": return 27;
        case "abcdefghijklmnopqrstuvwxyz01": return 28; case "abcdefghijklmnopqrstuvwxyz012": return 29; case "abcdefghijklmnopqrstuvwxyz0123": return 30;
        case "abcdefghijklmnopqrstuvwxyz01234": return 31; case "abcdefghijklmnopqrstuvwxyz012345": return 32; case "abcdefghijklmnopqrstuvwxyz0123456": return 33;
        case "abcdefghijklmnopqrstuvwxyz01234567": return 34; case "abcdefghijklmnopqrstuvwxyz012345678": return 35; case "abcdefghijklmnopqrstuvwxyz0123456789": return 36;
        case "abcdefghijklmnopqrstuvwxyz0123456789-": return 37; case "abcdefghijklmnopqrstuvwxyz0123456789-_": return 38; case "abcdefghijklmnopqrstuvwxyz0123456789-_.": return 39;
        case "abcdefghijklmnopqrstuvwxyz0123456789-_.:": return 40;
        default: return 0;
    }
}

type Prefix = (typeof prefixes)[number];
function choosePrefixFromUnion(subject: Prefix): number {
    switch (subject) {
        case "a": return 1; case "ab": return 2; case "abc": return 3;
        case "abcd": return 4; case "abcde": return 5; case "abcdef": return 6;
        case "abcdefg": return 7; case "abcdefgh": return 8; case "abcdefghi": return 9;
        case "abcdefghij": return 10; case "abcdefghijk": return 11; case "abcdefghijkl": return 12;
        case "abcdefghijklm": return 13; case "abcdefghijklmn": return 14; case "abcdefghijklmno": return 15;
        case "abcdefghijklmnop": return 16; case "abcdefghijklmnopq": return 17; case "abcdefghijklmnopqr": return 18;
        case "abcdefghijklmnopqrs": return 19; case "abcdefghijklmnopqrst": return 20; case "abcdefghijklmnopqrstu": return 21;
        case "abcdefghijklmnopqrstuv": return 22; case "abcdefghijklmnopqrstuvw": return 23; case "abcdefghijklmnopqrstuvwx": return 24;
        case "abcdefghijklmnopqrstuvwxy": return 25; case "abcdefghijklmnopqrstuvwxyz": return 26; case "abcdefghijklmnopqrstuvwxyz0": return 27;
        case "abcdefghijklmnopqrstuvwxyz01": return 28; case "abcdefghijklmnopqrstuvwxyz012": return 29; case "abcdefghijklmnopqrstuvwxyz0123": return 30;
        case "abcdefghijklmnopqrstuvwxyz01234": return 31; case "abcdefghijklmnopqrstuvwxyz012345": return 32; case "abcdefghijklmnopqrstuvwxyz0123456": return 33;
        case "abcdefghijklmnopqrstuvwxyz01234567": return 34; case "abcdefghijklmnopqrstuvwxyz012345678": return 35; case "abcdefghijklmnopqrstuvwxyz0123456789": return 36;
        case "abcdefghijklmnopqrstuvwxyz0123456789-": return 37; case "abcdefghijklmnopqrstuvwxyz0123456789-_": return 38; case "abcdefghijklmnopqrstuvwxyz0123456789-_.": return 39;
        case "abcdefghijklmnopqrstuvwxyz0123456789-_.:": return 40;
        default: return 0;
    }
}

type Direction = "north" | "south" | "east" | "west";
const directions: readonly Direction[] = ["north", "south", "east", "west"];
function chooseOneDirection(direction: Direction): number {
    switch (direction) {
        case "south": return 2;
        default: return 0;
    }
}
function chooseTwoDirections(direction: Direction): number {
    switch (direction) {
        case "north": return 1; case "west": return 4;
        default: return 0;
    }
}
function chooseThreeDirections(direction: Direction): number {
    switch (direction) {
        case "north": return 1; case "south": return 2; case "east": return 3;
        default: return 0;
    }
}
function chooseDirection(direction: Direction): number {
    switch (direction) {
        case "north": return 1; case "south": return 2; case "east": return 3; case "west": return 4;
        default: return 0;
    }
}
function chooseOptionalDirection(direction: Direction | undefined | null): number {
    switch (direction) {
        case "north": return 1; case "south": return 2; case "east": return 3; case "west": return 4;
        default: return 0;
    }
}
function followPath(path: readonly Direction[]): number {
    let position = 0;
    for (const direction of path)
        position = position * 5 + chooseDirection(direction);
    return position;
}

function chooseTextOfValue(subject: unknown): number {
    switch (subject) {
        case "5": return 1; case "0": return 2; case "NaN": return 3; case "undefined": return 4; case "null": return 5;
        case "[object Object]": return 6; case "true": return 7; case "": return 8; case "a": return 9;
        default: return 0;
    }
}

function chooseJoined(head: string, tail: string): number {
    switch (head + tail) {
        case "get": return 1; case "getOwn": return 2; case "getOwnKeys": return 3;
        default: return 0;
    }
}

function chooseKind(value: unknown): number {
    switch (typeof value) {
        case "string": return 1; case "number": return 2; case "object": return 3; case "undefined": return 4;
        case "function": return 5; case "boolean": return 6; case "bigint": return 7; case "symbol": return 8;
        default: return 0;
    }
}

function countInLoop(subjects: readonly string[]): string {
    const counts = [0, 0, 0, 0, 0];
    for (const subject of subjects) {
        switch (subject) {
            case "get": counts[1]++; break;
            case "set": counts[2]++; break;
            case "has": counts[3]++; break;
            case "getOwnKeys": counts[4]++; break;
            default: counts[0]++;
        }
    }
    return counts.join(" ");
}

function chooseTokensInLoop(subjects: readonly string[]): number[] {
    const chosen: number[] = [];
    for (const subject of subjects) {
        let choice = 0;
        switch (subject) {
            case "+": choice = 1; break; case "-": choice = 2; break; case "*": choice = 3; break; case "/": choice = 4; break; case "%": choice = 5; break; case "(": choice = 6; break; case ")": choice = 7; break;
            case "a": choice = 8; break; case "Z": choice = 9; break; case "0": choice = 10; break; case " ": choice = 11; break; case "\n": choice = 12; break; case "\0": choice = 13; break; case "if": choice = 14; break;
            case "in": choice = 15; break; case "do": choice = 16; break; case "of": choice = 17; break; case "as": choice = 18; break; case "is": choice = 19; break; case "no": choice = 20; break; case "on": choice = 21; break;
            case "for": choice = 22; break; case "let": choice = 23; break; case "var": choice = 24; break; case "new": choice = 25; break; case "try": choice = 26; break; case "null": choice = 27; break; case "true": choice = 28; break;
            case "void": choice = 29; break; case "this": choice = 30; break; case "else": choice = 31; break; case "case": choice = 32; break; case "with": choice = 33; break; case "enum": choice = 34; break;
        }
        chosen.push(choice);
    }
    return chosen;
}
function chooseMixedInLoop(subjects: readonly unknown[]): number[] {
    const chosen: number[] = [];
    for (const subject of subjects) {
        let choice = 0;
        switch (subject) {
            case "": choice = 1; break; case "é": choice = 2; break; case "😀": choice = 3; break; case "日本語": choice = 4; break; case "e": choice = 5; break; case "cafe": choice = 6; break; case "café": choice = 7; break;
            case "caf": choice = 8; break; case "éé": choice = 9; break; case "😀😀": choice = 10; break; case "x": choice = 11; break; case "naïve and longer than seven": choice = 12; break; case "plain and longer than seven": choice = 13; break;
        }
        chosen.push(choice);
    }
    return chosen;
}
function choosePrefixesInLoop(subjects: readonly string[]): number[] {
    const chosen: number[] = [];
    for (const subject of subjects) {
        let choice = 0;
        switch (subject) {
            case "a": choice = 1; break; case "ab": choice = 2; break; case "abc": choice = 3; break;
            case "abcd": choice = 4; break; case "abcde": choice = 5; break; case "abcdef": choice = 6; break;
            case "abcdefg": choice = 7; break; case "abcdefgh": choice = 8; break; case "abcdefghi": choice = 9; break;
            case "abcdefghij": choice = 10; break; case "abcdefghijk": choice = 11; break; case "abcdefghijkl": choice = 12; break;
            case "abcdefghijklm": choice = 13; break; case "abcdefghijklmn": choice = 14; break; case "abcdefghijklmno": choice = 15; break;
            case "abcdefghijklmnop": choice = 16; break; case "abcdefghijklmnopq": choice = 17; break; case "abcdefghijklmnopqr": choice = 18; break;
            case "abcdefghijklmnopqrs": choice = 19; break; case "abcdefghijklmnopqrst": choice = 20; break; case "abcdefghijklmnopqrstu": choice = 21; break;
            case "abcdefghijklmnopqrstuv": choice = 22; break; case "abcdefghijklmnopqrstuvw": choice = 23; break; case "abcdefghijklmnopqrstuvwx": choice = 24; break;
            case "abcdefghijklmnopqrstuvwxy": choice = 25; break; case "abcdefghijklmnopqrstuvwxyz": choice = 26; break; case "abcdefghijklmnopqrstuvwxyz0": choice = 27; break;
            case "abcdefghijklmnopqrstuvwxyz01": choice = 28; break; case "abcdefghijklmnopqrstuvwxyz012": choice = 29; break; case "abcdefghijklmnopqrstuvwxyz0123": choice = 30; break;
            case "abcdefghijklmnopqrstuvwxyz01234": choice = 31; break; case "abcdefghijklmnopqrstuvwxyz012345": choice = 32; break; case "abcdefghijklmnopqrstuvwxyz0123456": choice = 33; break;
            case "abcdefghijklmnopqrstuvwxyz01234567": choice = 34; break; case "abcdefghijklmnopqrstuvwxyz012345678": choice = 35; break; case "abcdefghijklmnopqrstuvwxyz0123456789": choice = 36; break;
            case "abcdefghijklmnopqrstuvwxyz0123456789-": choice = 37; break; case "abcdefghijklmnopqrstuvwxyz0123456789-_": choice = 38; break; case "abcdefghijklmnopqrstuvwxyz0123456789-_.": choice = 39; break;
            case "abcdefghijklmnopqrstuvwxyz0123456789-_.:": choice = 40; break;
        }
        chosen.push(choice);
    }
    return chosen;
}
function chooseGridCellsInLoop(subjects: readonly string[]): number[] {
    const chosen: number[] = [];
    for (const subject of subjects) {
        let choice = 0;
        switch (subject) {
            case "r0-shared-a!": choice = 1; break; case "r0-shared-b!": choice = 2; break; case "r0-shared-c!": choice = 3; break; case "r0-shared-d!": choice = 4; break; case "r0-shared-e!": choice = 5; break;
            case "r1-shared-a!": choice = 6; break; case "r1-shared-b!": choice = 7; break; case "r1-shared-c!": choice = 8; break; case "r1-shared-d!": choice = 9; break; case "r1-shared-e!": choice = 10; break;
            case "r2-shared-a!": choice = 11; break; case "r2-shared-b!": choice = 12; break; case "r2-shared-c!": choice = 13; break; case "r2-shared-d!": choice = 14; break; case "r2-shared-e!": choice = 15; break;
            case "r3-shared-a!": choice = 16; break; case "r3-shared-b!": choice = 17; break; case "r3-shared-c!": choice = 18; break; case "r3-shared-d!": choice = 19; break; case "r3-shared-e!": choice = 20; break;
            case "r4-shared-a!": choice = 21; break; case "r4-shared-b!": choice = 22; break; case "r4-shared-c!": choice = 23; break; case "r4-shared-d!": choice = 24; break; case "r4-shared-e!": choice = 25; break;
            case "r5-shared-a!": choice = 26; break; case "r5-shared-b!": choice = 27; break; case "r5-shared-c!": choice = 28; break; case "r5-shared-d!": choice = 29; break; case "r5-shared-e!": choice = 30; break;
            case "r6-shared-a!": choice = 31; break; case "r6-shared-b!": choice = 32; break; case "r6-shared-c!": choice = 33; break; case "r6-shared-d!": choice = 34; break; case "r6-shared-e!": choice = 35; break;
            case "r7-shared-a!": choice = 36; break; case "r7-shared-b!": choice = 37; break; case "r7-shared-c!": choice = 38; break; case "r7-shared-d!": choice = 39; break; case "r7-shared-e!": choice = 40; break;
        }
        chosen.push(choice);
    }
    return chosen;
}

function chooseInColdCode(subject: unknown): number {
    switch (subject) {
        case "": return 1; case "é": return 2; case "ab": return 3; case "abcdefg": return 4; case "abcdefgh": return 5;
        case "abcdefghijklmnopqrstuvwxyz0123456789": return 6; case "5": return 7;
        default: return 0;
    }
}

check("1 case", chooseSingle, single);
check("1 long case", chooseSentence, sentence);
check("2 cases", choosePair, pair);
check("3 cases", chooseTriple, triple);
check("34 cases of 1 to 4 characters", chooseToken, tokens);
check("13 cases, some not ASCII", chooseMixed, mixed);
check("40 cases of 1 to 40 characters", choosePrefix, prefixes);
check("40 cases of 12 characters", chooseGridCell, grid);
check("4 cases of 40 characters", chooseLongKey, longKeys);
check("300 cases", chooseKey, keys);

check("1 case, unknown subject", chooseSingleFromUnknown, single);
check("1 long case, unknown subject", chooseSentenceFromUnknown, sentence);
check("2 cases, unknown subject", choosePairFromUnknown, pair);
check("3 cases, unknown subject", chooseTripleFromUnknown, triple);
check("34 cases of 1 to 4 characters, unknown subject", chooseTokenFromUnknown, tokens);
check("13 cases, some not ASCII, unknown subject", chooseMixedFromUnknown, mixed);
check("40 cases of 1 to 40 characters, unknown subject", choosePrefixFromUnknown, prefixes);

checkNotStrings("1 case", chooseSingleFromUnknown);
checkNotStrings("1 long case", chooseSentenceFromUnknown);
checkNotStrings("2 cases", choosePairFromUnknown);
checkNotStrings("3 cases", chooseTripleFromUnknown);
checkNotStrings("34 cases", chooseTokenFromUnknown);
checkNotStrings("13 cases", chooseMixedFromUnknown);
checkNotStrings("40 cases", choosePrefixFromUnknown);
checkNotStrings("texts of values", chooseTextOfValue);

checkMembers("1 case of a union of 4", chooseOneDirection, directions, [0, 2, 0, 0]);
checkMembers("2 cases of a union of 4", chooseTwoDirections, directions, [1, 0, 0, 4]);
checkMembers("3 cases of a union of 4", chooseThreeDirections, directions, [1, 2, 3, 0]);
checkMembers("4 cases of a union of 4", chooseDirection, directions, [1, 2, 3, 4]);
checkMembers("4 cases of an optional union of 4", chooseOptionalDirection, directions, [1, 2, 3, 4]);
checkMembers("40 cases of a union of 40", choosePrefixFromUnion, prefixes, prefixes.map((_, index) => index + 1));
console.log("path", followPath(["north", "east", "south", "west", "north"]), followPath([]), chooseOptionalDirection(undefined), chooseOptionalDirection(null));

for (const isNull of [false, true]) {
    console.log("nullish", chooseSingle(nothing(isNull)), chooseSentence(nothing(isNull)), choosePair(nothing(isNull)), chooseTriple(nothing(isNull)), chooseToken(nothing(isNull)),
        chooseMixed(nothing(isNull)), choosePrefix(nothing(isNull)), chooseGridCell(nothing(isNull)), chooseLongKey(nothing(isNull)), chooseKey(nothing(isNull)));
}

console.log("a value is not its text", [5, 0, NaN, undefined, null, {}, true, [], ["a"]].map(value => `${chooseTextOfValue(value)}${chooseTextOfValue(String(value))}`).join(" "));
console.log("a rope equal to a case", chooseTriple(flat("get") + flat("Own")), chooseTripleFromUnknown(flat("getOwn") + flat("Keys")), chooseKey(flat("prefix/") + flat("142")), choosePrefix(flat("abcdefghijklmnopqrstuvwxyz") + flat("0123456789")));

let joined = "";
for (const text of ["get", "getOwn", "getOwnKeys", "getOwnKey", "getOwm", "set", ""]) {
    for (let at = 0; at <= text.length; at += 3)
        joined += chooseJoined(flat(text.slice(0, at)), flat(text.slice(at)));
}
console.log("joined", joined);
console.log("kinds", ["text", ...notStrings].map(chooseKind).join(""));

const words: string[] = [];
for (const text of ["get", "set", "has", "getOwnKeys", "got", "ge", "gets", "getOwnKeyz", ""]) {
    for (const represent of representations)
        words.push(represent(text));
}
console.log("in a loop", countInLoop(words), "|", countInLoop(words), "|", countInLoop([]));
checkInLoop("34 cases of 1 to 4 characters, in a loop", chooseTokensInLoop, tokens);
checkInLoop("13 cases, some not ASCII, unknown subjects, in a loop", chooseMixedInLoop, mixed);
checkInLoop("40 cases of 1 to 40 characters, in a loop", choosePrefixesInLoop, prefixes);
checkInLoop("40 cases of 12 characters, in a loop", chooseGridCellsInLoop, grid);
console.log("values that are not strings, in a loop", chooseMixedInLoop(notStrings).join(""));

console.log("cold", chooseInColdCode("ab"), chooseInColdCode(rope("abcdefg")), chooseInColdCode(widePart("abcdefgh")), chooseInColdCode(part("abcdefghijklmnopqrstuvwxyz0123456789")),
    chooseInColdCode(rope("abcdefghijklmnopqrstuvwxyz012345678")), chooseInColdCode(""), chooseInColdCode(wideFlat("é")), chooseInColdCode(5), chooseInColdCode("5"), chooseInColdCode(undefined),
    chooseInColdCode(null), chooseInColdCode({}), chooseInColdCode("abcdefG"), chooseInColdCode(wideRope("abcdefgh")), chooseInColdCode(wideFlat("ab")), chooseInColdCode(rope("abcdefghi")));

let once = 0;
switch (rope("getOwn")) {
    case "get": once = 1; break;
    case "getOwn": once = 2; break;
    case "getOwnKeys": once = 3; break;
}
switch (widePart("prefix/142")) {
    case "prefix/141": once += 10; break;
    case "prefix/142": once += 20; break;
    case "prefix/143": once += 30; break;
    case "k142z": once += 40; break;
    default: once += 50;
}
switch (part("é")) {
    case "e": once += 100; break;
    case "é": once += 200; break;
    case "": once += 300; break;
}
switch (nothing(once > 0) as unknown) {
    case "null": once += 1000; break;
    case "undefined": once += 2000; break;
    default: once += 3000;
}
console.log("once", once);
console.log(failures ? "failures: " + failures : "every subject took its case");

export {};
