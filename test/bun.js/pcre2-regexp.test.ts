import { PCRE2RegExp } from 'bun';
import { expect, it, test } from 'bun:test';
import { gc as gcTrace } from "./gc";


it("PCRE2RegExp.prototype.exec()", () => {
    let a1 = new PCRE2RegExp('(foo)', 'gd')
    let a1_1 = a1.exec('table football, foosball');
    a1_1 = a1.exec('table football, foosball');

    let a2 = new RegExp('(foo)', 'dg')
    let a2_1 = a2.exec('table football, foosball');
    a2_1 = a2.exec('table football, foosball');

    expect(a1_1[0]).toBe(a2_1[0]);
    expect(a1_1[1]).toBe(a2_1[1]);
    expect(a1_1.index).toBe(a2_1.index);
    expect(a1_1.input).toBe(a2_1.input);
    expect(a1.lastIndex).toBe(a2.lastIndex);
    expect(a1_1.groups).toBe(a2_1.groups);
    expect(a1_1.indices[0][0]).toBe(a2_1.indices[0][0]);
    expect(a1_1.indices[0][1]).toBe(a2_1.indices[0][1]);
    expect(a1_1.indices[1][0]).toBe(a2_1.indices[1][0]);
    expect(a1_1.indices[1][1]).toBe(a2_1.indices[1][1]);
});

test("PCRE2RegExp.prototype.source", () => {
    let a1 = new PCRE2RegExp('(foo)', 'gd')
    let a2 = new RegExp('(foo)', 'dg')
    expect(a1.source).toBe(a2.source);

    expect(new PCRE2RegExp('/').source).toBe('\\/');
    expect(new RegExp('/').source).toBe('\\/');

    expect(new PCRE2RegExp().source).toBe(new RegExp().source);
    expect(new PCRE2RegExp('').source).toBe(new RegExp('').source);
    expect(new PCRE2RegExp('a').source).toBe(new RegExp('a').source);
    expect(new PCRE2RegExp('a', 'g').source).toBe(new RegExp('a', 'g').source);
    expect(new PCRE2RegExp('/').source).toBe(new RegExp('/').source);
    expect(new PCRE2RegExp('\n').source).toBe(new RegExp('\n').source);
    expect(new PCRE2RegExp('\r').source).toBe(new RegExp('\r').source);
});

test("PCRE2RegExp.prototype.toString()", () => {
    expect(new PCRE2RegExp().toString()).toBe(new RegExp().toString());
    expect(new PCRE2RegExp('').toString()).toBe(new RegExp('').toString());
    expect(new PCRE2RegExp('a').toString()).toBe(new RegExp('a').toString());
    expect(new PCRE2RegExp('a', 'g').toString()).toBe(new RegExp('a', 'g').toString());
    expect(new PCRE2RegExp('/').toString()).toBe(new RegExp('/').toString());
    expect(new PCRE2RegExp('\n').toString()).toBe(new RegExp('\n').toString());
    expect(new PCRE2RegExp('\r').toString()).toBe(new RegExp('\r').toString());
    expect(new PCRE2RegExp('jf/\.a.,voejpjoajglz;/qwjopeiv\\/\/\\/jpoqaj/Zdkj').toString()).toBe(new RegExp('jf/\.a.,voejpjoajglz;/qwjopeiv\\/\/\\/jpoqaj/Zdkj').toString());
});

test('PCRE2RegExp flags', () => {
    // multiline option
    expect(new PCRE2RegExp('boat').test('sailor\nboat')).toBe(true);
    expect(new PCRE2RegExp('^boat').test('sailor\nboat')).toBe(false);
    expect(new PCRE2RegExp('^boat', 'm').test('sailor\nboat')).toBe(true);
    expect(new RegExp('boat').test('sailor\nboat')).toBe(true);
    expect(new RegExp('^boat').test('sailor\nboat')).toBe(false);
    expect(new RegExp('^boat', 'm').test('sailor\nboat')).toBe(true);

    // sticky option
    let str2 = 'sailor';
    let h1 = new PCRE2RegExp('or');
    let h2 = new PCRE2RegExp('or', 'y');
    expect(h1.test(str2)).toBe(true);
    expect(h2.test(str2)).toBe(false);
    let h3 = new RegExp('or');
    let h4 = new RegExp('or', 'y');
    expect(h3.test(str2)).toBe(true);
    expect(h4.test(str2)).toBe(false);
    let g1 = new PCRE2RegExp('sail');
    let g2 = new PCRE2RegExp('sail', 'y');
    expect(g1.test(str2)).toBe(true);
    expect(g2.test(str2)).toBe(true);

    // case insensitive option
    expect(new PCRE2RegExp('Is ThIs SqL?').test('IS THIS SQL?')).toBe(false);
    expect(new PCRE2RegExp('Is ThIs SqL?', 'i').test('IS THIS SQL?')).toBe(true);
    expect(new RegExp('Is ThIs SqL?').test('IS THIS SQL?')).toBe(false);
    expect(new RegExp('Is ThIs SqL?', 'i').test('IS THIS SQL?')).toBe(true);

    // dotall option
    expect(new PCRE2RegExp('a.b').test('a\nb')).toBe(false);
    expect(new PCRE2RegExp('a.b', 's').test('a\nb')).toBe(true);
    expect(new RegExp('a.b').test('a\nb')).toBe(false);
    expect(new RegExp('a.b', 's').test('a\nb')).toBe(true);
});

test('PCRE2RegExp.lastIndex', () => {
    let a1 = new PCRE2RegExp('foo', 'g');
    let a2 = new RegExp('foo', 'g');
    expect(a1.lastIndex).toBe(a2.lastIndex);
    a1.lastIndex = 1;
    a2.lastIndex = 1;
    expect(a1.lastIndex).toBe(a2.lastIndex);
    a1.lastIndex = 0;
    a2.lastIndex = 0;
    expect(a1.lastIndex).toBe(a2.lastIndex);
    a1.lastIndex = 0;
    a2.lastIndex = 0;
    expect(a1.lastIndex).toBe(a2.lastIndex);
    a1.lastIndex = 1;
    a2.lastIndex = 1;
    expect(a1.lastIndex).toBe(a2.lastIndex);
    a1.lastIndex = 0;
    a2.lastIndex = 0;
    expect(a1.lastIndex).toBe(a2.lastIndex);

    let p1 = new PCRE2RegExp('a');
    expect(p1.lastIndex).toBe(0);
    p1.lastIndex = 2;
    expect(p1.lastIndex).toBe(2);
    let p2 = new PCRE2RegExp('b');
    expect(p2.lastIndex).toBe(0);
    p2.lastIndex = 2348;
    expect(p2.lastIndex).toBe(2348);
    expect(p1.lastIndex).toBe(2);
})

test('PCRE2RegExp errors', () => {
    let r = new PCRE2RegExp('a', 'igsym');
    let b = new PCRE2RegExp('l', 'm');
    try {
        r.compile(b, 'g');
    } catch (e) {
        expect(e.message).toBe('Cannot supply flags when constructing one RegExp from another.');
    }
    try {
        r.compile('ll', 'a');
    } catch (e) {
        expect(e.message).toBe('Invalid flags supplied to RegExp constructor.');
    }
    try {
        new PCRE2RegExp('c', 'a');
    } catch (e) {
        expect(e.message).toBe('Invalid flags supplied to RegExp constructor.');
    }
    const invalidRegExpError = 'Invalid regular expression: ';
    try {
        new PCRE2RegExp('?', 'g');
    } catch (e) {
        expect(e.message.substring(0, invalidRegExpError.length)).toBe(invalidRegExpError);
    }
    try {
        new PCRE2RegExp('?');
    } catch (e) {
        expect(e.message.substring(0, invalidRegExpError.length)).toBe(invalidRegExpError);
    }
    try {
        r.compile('?', 'g');
    } catch (e) {
        expect(e.message.substring(0, invalidRegExpError.length)).toBe(invalidRegExpError);
    }
    try {
        r.compile('?');
    } catch (e) {
        expect(e.message.substring(0, invalidRegExpError.length)).toBe(invalidRegExpError);
    }

    try {
        new PCRE2RegExp('\\');
    } catch (e) {
        expect(e.message.substring(0, invalidRegExpError.length)).toBe(invalidRegExpError);
    }
})

test('PCRE2RegExp random', () => {

    expect(new PCRE2RegExp("love").test("I love JavaScript")).toBe(true);
    expect(new RegExp("love").test("I love JavaScript")).toBe(true);
    
    expect(new PCRE2RegExp('a').test('sailor')).toBe(true);
    expect(new PCRE2RegExp('or').test('sailor')).toBe(true);
    expect(new RegExp('a').test('sailor')).toBe(true);
    expect(new RegExp('or').test('sailor')).toBe(true);


    expect(new PCRE2RegExp('a').test('a')).toBe(true);
    expect(new PCRE2RegExp('a').test('b')).toBe(false);
    expect(new PCRE2RegExp('a', 'i').test('a')).toBe(true);
    expect(new PCRE2RegExp('a', 'i').test('A')).toBe(true);
    expect(new PCRE2RegExp('a', 'g').test('A')).toBe(false);
    expect(new PCRE2RegExp('A', 'i').test('a')).toBe(true);
    expect(new PCRE2RegExp('A', 'g').test('a')).toBe(false);
    expect(new PCRE2RegExp('afasdfebadf', 'i').test('b')).toBe(false);
    
    
    let r = new PCRE2RegExp('a', 'g');
    expect(r.source).toBe('a');
    expect(r.flags).toBe('g')
    expect(r.toString()).toBe('/a/g');

    r.compile('b', 'i');
    expect(r.source).toBe('b');
    expect(r.flags).toBe('i');
    expect(r.toString()).toBe('/b/i');

    let b = new PCRE2RegExp('l', 'm');
    expect(r.compile(b)).toBe(undefined);
    expect(r.source).toBe('l');
    expect(r.flags).toBe('m');
    expect(r.toString()).toBe('/l/m');

    expect(new PCRE2RegExp('a', 'd').hasIndices).toBe(true);
    expect(new PCRE2RegExp('a', 'i').hasIndices).toBe(false);
    expect(new PCRE2RegExp('a', 's').dotAll).toBe(true);
    expect(new PCRE2RegExp('a', 'i').dotAll).toBe(false);
    expect(new PCRE2RegExp('a', 'i').ignoreCase).toBe(true);
    expect(new PCRE2RegExp('a', 's').ignoreCase).toBe(false);
    expect(new PCRE2RegExp('a', 'g').global).toBe(true);
    expect(new PCRE2RegExp('a', 's').global).toBe(false);
    expect(new PCRE2RegExp('a', 'm').multiline).toBe(true);
    expect(new PCRE2RegExp('a', 's').multiline).toBe(false);
    expect(new PCRE2RegExp('a', 'y').sticky).toBe(true);
    expect(new PCRE2RegExp('a', 'i').sticky).toBe(false);
    expect(new PCRE2RegExp('a', 'u').unicode).toBe(true);
    expect(new PCRE2RegExp('a', 'd').unicode).toBe(false);
    expect(new RegExp('a', 'd').hasIndices).toBe(true);
    expect(new RegExp('a', 'i').hasIndices).toBe(false);
    expect(new RegExp('a', 's').dotAll).toBe(true);
    expect(new RegExp('a', 'i').dotAll).toBe(false);
    expect(new RegExp('a', 'i').ignoreCase).toBe(true);
    expect(new RegExp('a', 's').ignoreCase).toBe(false);
    expect(new RegExp('a', 'g').global).toBe(true);
    expect(new RegExp('a', 's').global).toBe(false);
    expect(new RegExp('a', 'm').multiline).toBe(true);
    expect(new RegExp('a', 's').multiline).toBe(false);
    expect(new RegExp('a', 'y').sticky).toBe(true);
    expect(new RegExp('a', 'i').sticky).toBe(false);
    expect(new RegExp('a', 'u').unicode).toBe(true);
    expect(new RegExp('a', 'd').unicode).toBe(false);
});

