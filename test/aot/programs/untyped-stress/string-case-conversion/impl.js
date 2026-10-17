function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function thrownBy(f, ...args) {
    try {
        f(...args);
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}
(function () {
    function lower(value) { return String(value).toLowerCase(); }
    function upper(value) { return String(value).toUpperCase(); }
    function lowerOfConcatenation(a, b) { return (String(a) + String(b)).toLowerCase(); }
    function upperOfConcatenation(a, b) { return (String(a) + String(b)).toUpperCase(); }
    function lowerOfPart(value, from, to) { return String(value).substring(from, to).toLowerCase(); }
    function upperOfPart(value, from, to) { return String(value).substring(from, to).toUpperCase(); }
    function lowerTwice(value) { return String(value).toLowerCase().toLowerCase(); }
    function upperThenLower(value) { return String(value).toUpperCase().toLowerCase(); }
    function withArguments(value) { return String(value).toLowerCase("ignored", 1) + String(value).toUpperCase("ignored", 1); }
    function ignoresResults(value) { const text = String(value); text.toLowerCase(); text.toUpperCase(); return text; }

    function lowerOneByOne(text) {
        let result = "";
        for (const character of text) {
            const code = character.codePointAt(0);
            result += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : character;
        }
        return result;
    }
    function upperOneByOne(text) {
        let result = "";
        for (const character of text) {
            const code = character.codePointAt(0);
            result += code >= 97 && code <= 122 ? String.fromCharCode(code - 32) : character;
        }
        return result;
    }
    noInline(lowerOneByOne);
    noInline(upperOneByOne);

    let allASCII = "";
    for (let code = 0; code < 128; ++code)
        allASCII += String.fromCharCode(code);
    const ascii = ["", "a", "A", "z", "Z", "@", "[", "`", "{", "0", " ", "content-type", "Content-Type", "CONTENT-TYPE", "get", "GET", "Get", "geT", "x-request-id", "X_REQUEST_ID", "123", "a1b2", "A1B2", "@[`{", "aZ", "Za",
        "lower case with spaces and 123", "UPPER CASE WITH SPACES AND 123", "only the last letteR", "ONLY THE LAST LETTEr", "Only the first letter", "oNLY THE FIRST LETTER", allASCII, "\0", "\x7f", "a\0b", "A\0B"];
    for (let round = 0; round < 3; ++round) {
        for (const text of ascii) {
            check(lower(text), lowerOneByOne(text), "toLowerCase of " + JSON.stringify(text));
            check(upper(text), upperOneByOne(text), "toUpperCase of " + JSON.stringify(text));
            check(lowerTwice(text), lowerOneByOne(text), "toLowerCase twice of " + JSON.stringify(text));
            check(upperThenLower(text), lowerOneByOne(text), "toUpperCase and toLowerCase of " + JSON.stringify(text));
            check(withArguments(text), lowerOneByOne(text) + upperOneByOne(text), "arguments are ignored for " + JSON.stringify(text));
            check(ignoresResults(text), text, "results that are not used");
            for (const more of ["", "x", "X", "-", "tail that is longer", "TAIL THAT IS LONGER"]) {
                check(lowerOfConcatenation(text, more), lowerOneByOne(text + more), "toLowerCase of a rope");
                check(upperOfConcatenation(text, more), upperOneByOne(text + more), "toUpperCase of a rope");
            }
            for (let from = 0; from < Math.min(text.length, 4); ++from) {
                check(lowerOfPart(text, from, text.length), lowerOneByOne(text.substring(from)), "toLowerCase of the end of a string");
                check(upperOfPart(text, from, text.length), upperOneByOne(text.substring(from)), "toUpperCase of the end of a string");
                check(lowerOfPart(text, 0, text.length - from), lowerOneByOne(text.substring(0, text.length - from)), "toLowerCase of the start of a string");
                check(upperOfPart(text, 0, text.length - from), upperOneByOne(text.substring(0, text.length - from)), "toUpperCase of the start of a string");
            }
        }
        for (let length = 0; length < 70; ++length) {
            const small = "abcdefghij".repeat(7).substring(0, length), capital = "ABCDEFGHIJ".repeat(7).substring(0, length);
            check(lower(small), small, "toLowerCase of " + length + " small letters");
            check(upper(small), capital, "toUpperCase of " + length + " small letters");
            check(lower(capital), small, "toLowerCase of " + length + " capital letters");
            check(upper(capital), capital, "toUpperCase of " + length + " capital letters");
            for (let position = 0; position < length; position += 7) {
                const oneCapital = small.substring(0, position) + "Q" + small.substring(position + 1), oneSmall = capital.substring(0, position) + "q" + capital.substring(position + 1);
                check(lower(oneCapital), small.substring(0, position) + "q" + small.substring(position + 1), "toLowerCase with one capital letter at " + position);
                check(upper(oneSmall), capital.substring(0, position) + "Q" + capital.substring(position + 1), "toUpperCase with one small letter at " + position);
                check(upper(oneCapital), capital.substring(0, position) + "Q" + capital.substring(position + 1), "toUpperCase with one capital letter at " + position);
                check(lower(oneSmall), small.substring(0, position) + "q" + small.substring(position + 1), "toLowerCase with one small letter at " + position);
            }
        }
        const long = "0123456789 already lower ".repeat(4000);
        check(lower(long), long, "toLowerCase of a long string that does not change");
        check(upper(long).length, long.length, "toUpperCase of a long string");
        check(upper(upper(long)), upper(long), "toUpperCase of a long string that does not change");
        check(lower(long + "X"), long + "x", "toLowerCase of a long string whose last letter changes");

        check(lower("\xe9t\xe9"), "\xe9t\xe9", "toLowerCase of small letters of Latin-1");
        check(upper("\xe9t\xe9"), "\xc9T\xc9", "toUpperCase of small letters of Latin-1");
        check(lower("\xc9T\xc9"), "\xe9t\xe9", "toLowerCase of capital letters of Latin-1");
        check(upper("\xc9T\xc9"), "\xc9T\xc9", "toUpperCase of capital letters of Latin-1");
        check(upper("stra\xdfe"), "STRASSE", "toUpperCase of a sharp s");
        check(upper("STRA\xdfE"), "STRASSE", "toUpperCase of a sharp s among capital letters");
        check(lower("stra\xdfe"), "stra\xdfe", "toLowerCase of a sharp s");
        check(upper("\xb5"), "Μ", "toUpperCase of the micro sign");
        check(upper("A\xb5"), "AΜ", "toUpperCase of the micro sign after a capital letter");
        check(upper("\xff"), "Ÿ", "toUpperCase of y with diaeresis");
        check(lower("\xd7\xf7"), "\xd7\xf7", "toLowerCase of signs of Latin-1");
        check(upper("\xd7\xf7"), "\xd7\xf7", "toUpperCase of signs of Latin-1");
        check(lower("abc\x80"), "abc\x80", "toLowerCase with the first character that is not ASCII");
        check(upper("ABC\x80"), "ABC\x80", "toUpperCase with the first character that is not ASCII");
        check(lower("abcΔ"), "abcδ", "toLowerCase of a 16-bit string");
        check(upper("ABCδ"), "ABCΔ", "toUpperCase of a 16-bit string");
        check(lower("abcδ"), "abcδ", "toLowerCase of a 16-bit string that does not change");
        check(upper("ABCΔ"), "ABCΔ", "toUpperCase of a 16-bit string that does not change");
        check(lower("Δabc".substring(1)), "abc", "toLowerCase of ASCII in 16 bits");
        check(upper("Δabc".substring(1)), "ABC", "toUpperCase of ASCII in 16 bits");
        check(lower("İ"), "i̇", "toLowerCase that makes the string longer");
        check(upper("ﬀ"), "FF", "toUpperCase that makes the string longer");
        check(lower("𐐀"), "𐐨", "toLowerCase outside the basic plane");
        check(lower(12), "12", "toLowerCase of a number made a string");
        check(upper(null), "NULL", "toUpperCase of null made a string");
        check(upper(1e21), "1E+21", "toUpperCase of a large number made a string");
    }

    function ofUnknownReceiver(value) { return value.toLowerCase() + "," + value.toUpperCase(); }
    noInline(ofUnknownReceiver);
    function onReceiver(method, receiver) { return method.call(receiver); }
    for (let round = 0; round < 50; ++round) {
        check(ofUnknownReceiver("Text"), "text,TEXT", "a string as a parameter");
        check(ofUnknownReceiver("text"), "text,TEXT", "a string as a parameter");
        check(ofUnknownReceiver(new String("Text")), "text,TEXT", "a String object");
        check(ofUnknownReceiver({ toLowerCase() { return "mine"; }, toUpperCase() { return "MINE"; } }), "mine,MINE", "an object with such methods");
        check(thrownBy(ofUnknownReceiver, 1), "TypeError", "a number has no such method");
        check(thrownBy(ofUnknownReceiver, undefined), "TypeError", "undefined");
        check(onReceiver(String.prototype.toLowerCase, 1.5), "1.5", "toLowerCase called on a number");
        check(onReceiver(String.prototype.toUpperCase, true), "TRUE", "toUpperCase called on a boolean");
        check(onReceiver(String.prototype.toUpperCase, { toString() { return "object"; } }), "OBJECT", "toUpperCase called on an object");
        check(onReceiver(String.prototype.toLowerCase, ["A", "B"]), "a,b", "toLowerCase called on an array");
        check(thrownBy(onReceiver, String.prototype.toLowerCase, null), "TypeError", "toLowerCase called on null");
        check(thrownBy(onReceiver, String.prototype.toUpperCase, undefined), "TypeError", "toUpperCase called on undefined");
        check(thrownBy(onReceiver, String.prototype.toUpperCase, Symbol()), "TypeError", "toUpperCase called on a symbol");
    }

    function keepsManyAlive(count) {
        const results = [];
        for (let i = 0; i < count; ++i) {
            const text = "key-" + i;
            results.push(text.toLowerCase(), text.toUpperCase());
            if (!(i % 500))
                gc();
        }
        for (let i = 0; i < count; ++i) {
            if (results[2 * i] !== "key-" + i || results[2 * i + 1] !== "KEY-" + i)
                return "wrong at " + i;
        }
        return "right";
    }
    check(keepsManyAlive(3000), "right", "results across collections");
})();
console.log("passed");
