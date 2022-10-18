import { OnigurumaRegExp } from 'bun';
import { expect, it, test } from 'bun:test';
import { gc as gcTrace } from "./gc";


it("OnigurumaRegExp.prototype.exec()", () => {
    let a1 = new OnigurumaRegExp('(foo)', 'gd')
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

test("OnigurumaRegExp flag order", () => {
    expect(new OnigurumaRegExp('a', 'gd').toString()).toBe('/a/dg');
    expect(new OnigurumaRegExp('a', 'ydmg').toString()).toBe('/a/dgmy');
});

test("OnigurumaRegExp.prototype.source", () => {
    let a1 = new OnigurumaRegExp('(foo)', 'gd')
    let a2 = new RegExp('(foo)', 'dg')
    expect(a1.source).toBe(a2.source);

    expect(new OnigurumaRegExp('/').source).toBe('\\/');
    expect(new RegExp('/').source).toBe('\\/');

    expect(new OnigurumaRegExp().source).toBe(new RegExp().source);
    expect(new OnigurumaRegExp('').source).toBe(new RegExp('').source);
    expect(new OnigurumaRegExp('a').source).toBe(new RegExp('a').source);
    expect(new OnigurumaRegExp('a', 'g').source).toBe(new RegExp('a', 'g').source);
    expect(new OnigurumaRegExp('/').source).toBe(new RegExp('/').source);
    expect(new OnigurumaRegExp('\n').source).toBe(new RegExp('\n').source);
    expect(new OnigurumaRegExp('\r').source).toBe(new RegExp('\r').source);
});

test("OnigurumaRegExp.prototype.toString()", () => {
    expect(new OnigurumaRegExp().toString()).toBe(new RegExp().toString());
    expect(new OnigurumaRegExp('').toString()).toBe(new RegExp('').toString());
    expect(new OnigurumaRegExp('a').toString()).toBe(new RegExp('a').toString());
    expect(new OnigurumaRegExp('a', 'g').toString()).toBe(new RegExp('a', 'g').toString());
    expect(new OnigurumaRegExp('/').toString()).toBe(new RegExp('/').toString());
    expect(new OnigurumaRegExp('\n').toString()).toBe(new RegExp('\n').toString());
    expect(new OnigurumaRegExp('\r').toString()).toBe(new RegExp('\r').toString());
    expect(new OnigurumaRegExp('jf/\.a.,voejpjoajglz;/qwjopeiv\\/\/\\/jpoqaj/Zdkj').toString()).toBe(new RegExp('jf/\.a.,voejpjoajglz;/qwjopeiv\\/\/\\/jpoqaj/Zdkj').toString());
});

test('OnigurumaRegExp flags', () => {
    // multiline option
    for (const RegExpConstructor of [OnigurumaRegExp, RegExp]) {
        expect(new RegExpConstructor('boat').test('sailor\nboat')).toBe(true);
        expect(new RegExpConstructor('^boat').test('sailor\nboat')).toBe(false);
        expect(new RegExpConstructor('^boat', 'm').test('sailor\nboat')).toBe(true);
    }
        
    // sticky option
    for (const RegExpConstructor of [RegExp]) {
        let str2 = 'sailor';
        let h3 = new RegExpConstructor('or');
        let h4 = new RegExpConstructor('or', 'y');
        expect(h3.test(str2)).toBe(true);
        expect(h4.test(str2)).toBe(false);
        let g1 = new RegExpConstructor('sail');
        let g2 = new RegExpConstructor('sail', 'y');
        expect(g1.test(str2)).toBe(true);
        expect(g2.test(str2)).toBe(true);
    }

    // case insensitive option
    for (const RegExpConstructor of [OnigurumaRegExp, RegExp]) {
        expect(new RegExpConstructor('Is ThIs SqL?').test('IS THIS SQL?')).toBe(false);
        expect(new RegExpConstructor('Is ThIs SqL?', 'i').test('IS THIS SQL?')).toBe(true);
    }

    // dotall option
    for (const RegExpConstructor of [OnigurumaRegExp, RegExp]) {
        expect(new RegExpConstructor('a.b').test('a\nb')).toBe(false);
        expect(new RegExpConstructor('a.b', 's').test('a\nb')).toBe(true);
    }

    // indices option
    for (const RegExpConstructor of [OnigurumaRegExp, RegExp]) {
        expect(new RegExpConstructor('a', 'g').exec('a').indices).toBe(undefined);
        expect(new RegExpConstructor('a', 'gd').exec('a').index).toBe(0);
        expect(new RegExpConstructor('a', 'dg').exec('a').index).toBe(0);
    }
});

test('OnigurumaRegExp.lastIndex', () => {
    for (const RegExpConstructor of [RegExp, OnigurumaRegExp]) {
        let a = new RegExpConstructor('foo', 'g');
        expect(a.lastIndex).toBe(0);
        a.lastIndex = 1;
        expect(a.lastIndex).toBe(1);
        a.lastIndex = 0;
        expect(a.lastIndex).toBe(0);
        a.lastIndex = 1;
        expect(a.lastIndex).toBe(1);
        a.test('kfjekf');
        expect(a.lastIndex).toBe(0);
        a.test('o');
        expect(a.lastIndex).toBe(0);
    }

    let p1 = new OnigurumaRegExp('a');
    expect(p1.lastIndex).toBe(0);
    p1.lastIndex = 2;
    expect(p1.lastIndex).toBe(2);
    let p2 = new OnigurumaRegExp('b');
    expect(p2.lastIndex).toBe(0);
    p2.lastIndex = 2348;
    expect(p2.lastIndex).toBe(2348);
    expect(p1.lastIndex).toBe(2);

    for (const RegExpConstructor of [RegExp, OnigurumaRegExp]) {
        let a = new RegExpConstructor('foo', 'g');
        a.lastIndex = 33;
        expect(a.lastIndex).toBe(33);
        a.compile('bar');
        expect(a.lastIndex).toBe(0);
        a.lastIndex = 44;
        expect(a.lastIndex).toBe(44);
    }

    for (const RegExpConstructor of [OnigurumaRegExp]) {
        let a = new RegExpConstructor('foo', 'g');
        expect(a.lastIndex).toBe(0);
        a.test('kfjekfoofjekf');
        expect(a.lastIndex).toBe(8);
        a.test('kejfkjs');
        expect(a.lastIndex).toBe(0);
        a.exec('kfjekfoofjekf');
        expect(a.lastIndex).toBe(8);
        a.exec('kejfkjs');
        expect(a.lastIndex).toBe(0);
    }
});

test('OnigurumaRegExp errors', () => {
    let r = new OnigurumaRegExp('a', 'igsym');
    let b = new OnigurumaRegExp('l', 'm');
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
        new OnigurumaRegExp('c', 'a');
    } catch (e) {
        expect(e.message).toBe('Invalid flags supplied to RegExp constructor.');
    }
    const invalidRegExpError = 'Invalid regular expression: ';
    try {
        new OnigurumaRegExp('?', 'g');
    } catch (e) {
        expect(e.message.substring(0, invalidRegExpError.length)).toBe(invalidRegExpError);
    }
    try {
        new OnigurumaRegExp('?');
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
        new OnigurumaRegExp('\\');
    } catch (e) {
        expect(e.message.substring(0, invalidRegExpError.length)).toBe(invalidRegExpError);
    }
})

test('OnigurumaRegExp random', () => {

    expect(new OnigurumaRegExp("love").test("I love JavaScript")).toBe(true);
    expect(new RegExp("love").test("I love JavaScript")).toBe(true);
    
    expect(new OnigurumaRegExp('a').test('sailor')).toBe(true);
    expect(new OnigurumaRegExp('or').test('sailor')).toBe(true);
    expect(new RegExp('a').test('sailor')).toBe(true);
    expect(new RegExp('or').test('sailor')).toBe(true);


    expect(new OnigurumaRegExp('a').test('a')).toBe(true);
    expect(new OnigurumaRegExp('a').test('b')).toBe(false);
    expect(new OnigurumaRegExp('a', 'i').test('a')).toBe(true);
    expect(new OnigurumaRegExp('a', 'i').test('A')).toBe(true);
    expect(new OnigurumaRegExp('a', 'g').test('A')).toBe(false);
    expect(new OnigurumaRegExp('A', 'i').test('a')).toBe(true);
    expect(new OnigurumaRegExp('A', 'g').test('a')).toBe(false);
    expect(new OnigurumaRegExp('afasdfebadf', 'i').test('b')).toBe(false);
    
    
    let r = new OnigurumaRegExp('a', 'g');
    expect(r.source).toBe('a');
    expect(r.flags).toBe('g')
    expect(r.toString()).toBe('/a/g');

    r.compile('b', 'i');
    expect(r.source).toBe('b');
    expect(r.flags).toBe('i');
    expect(r.toString()).toBe('/b/i');

    let b = new OnigurumaRegExp('l', 'm');
    expect(r.compile(b)).toBe(undefined);
    expect(r.source).toBe('l');
    expect(r.flags).toBe('m');
    expect(r.toString()).toBe('/l/m');

    expect(new OnigurumaRegExp('a', 'd').hasIndices).toBe(true);
    expect(new OnigurumaRegExp('a', 'i').hasIndices).toBe(false);
    expect(new OnigurumaRegExp('a', 's').dotAll).toBe(true);
    expect(new OnigurumaRegExp('a', 'i').dotAll).toBe(false);
    expect(new OnigurumaRegExp('a', 'i').ignoreCase).toBe(true);
    expect(new OnigurumaRegExp('a', 's').ignoreCase).toBe(false);
    expect(new OnigurumaRegExp('a', 'g').global).toBe(true);
    expect(new OnigurumaRegExp('a', 's').global).toBe(false);
    expect(new OnigurumaRegExp('a', 'm').multiline).toBe(true);
    expect(new OnigurumaRegExp('a', 's').multiline).toBe(false);
    expect(new OnigurumaRegExp('a', 'y').sticky).toBe(true);
    expect(new OnigurumaRegExp('a', 'i').sticky).toBe(false);
    expect(new OnigurumaRegExp('a', 'u').unicode).toBe(true);
    expect(new OnigurumaRegExp('a', 'd').unicode).toBe(false);
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


it("String.prototype.replace", () => {
    for (let RegExpConstructor of [OnigurumaRegExp, RegExp]) {
        const r = new RegExpConstructor('a', 'g');
        expect('a'.replace(r, 'b')).toBe('b');
        expect('a'.replace(r, () => 'b')).toBe('b');
        expect('a'.replace(r, (match, offset, string) => {
            expect(match).toBe('a');
            expect(offset).toBe(0);
            expect(string).toBe('a');
            return 'b';
        })).toBe('b');
    }

    expect('aaaaaa'.replace(new OnigurumaRegExp('a', 'g'), 'b')).toBe('bbbbbb');
    expect('aaaaaa'.replace(new OnigurumaRegExp('a'), 'b')).toBe('baaaaa');
    // case sensitive
    expect('aaaaaa'.replace(new OnigurumaRegExp('A', 'i'), 'b')).toBe('baaaaa');
    expect('aaaaaa'.replace(new OnigurumaRegExp('A'), 'b')).toBe('aaaaaa');

    expect('aaaaaa'.replace(new RegExp('a', 'g'), 'b')).toBe('bbbbbb');
    expect('aaaaaa'.replace(new RegExp('a'), 'b')).toBe('baaaaa');
});

it("Strings.prototype.match", () => {
    let str = 'The rain in SPAIN stays mainly in the plain';
    for (let RegExpConstructor of [OnigurumaRegExp, RegExp]) {
        let r1 = new RegExpConstructor('ain', 'g');
        let m1 = str.match(r1);
        expect(m1[0]).toBe('ain');
        expect(m1[1]).toBe('ain');
        expect(m1[2]).toBe('ain');

        r1.compile('ain', 'ig');
        m1 = str.match(r1);
        expect(m1[0]).toBe('ain');
        expect(m1[1]).toBe('AIN');
        expect(m1[2]).toBe('ain');
        expect(m1[3]).toBe('ain');    
    }
});

it("String.prototype.matchAll", () => {
    let str = 'test1test2';
    for (let RegExpConstructor of [RegExp, OnigurumaRegExp]) {
        const regexp = new RegExpConstructor('t(e)(st(\d?))', 'g');
        const array = [...str.matchAll(regexp)];
        expect(array[0][0]).toBe('test');
        expect(array[0][1]).toBe('e');
        expect(array[0][2]).toBe('st');
        expect(array[0][3]).toBe('');
        expect(array[1][0]).toBe('test');
        expect(array[1][1]).toBe('e');
        expect(array[1][2]).toBe('st');
        expect(array[1][3]).toBe('');
    }
});

it("String.prototype.search", () => {
    let str = 'The rain in SPAIN stays mainly in the plain';
    for (let RegExpConstructor of [OnigurumaRegExp, RegExp]) {
        let r1 = new RegExpConstructor('ain', 'g');
        expect(str.search(r1)).toBe(5);
        r1.compile('ain', 'ig');
        expect(str.search(r1)).toBe(5);
    }
});

it("String.prototype.split", () => {
    let str = 'Hello World. How are you doing?';
    for (let RegExpConstructor of [RegExp, OnigurumaRegExp]) {
        let r1 = new RegExpConstructor('\\s', 'g');
        let m1 = str.split(r1);
        expect(m1[0]).toBe('Hello');
        expect(m1[1]).toBe('World.');
        expect(m1[2]).toBe('How');
        expect(m1[3]).toBe('are');
        expect(m1[4]).toBe('you');
        expect(m1[5]).toBe('doing?');
    }
});

it("lookbehinds", () => {
    expect(/\d+(?=%)/.source).toBe('\\d+(?=%)');
    expect(/\d+(?!%)/.source).toBe('\\d+(?!%)');
    expect(/(?<=\$)\d+/.source).toBe('(?<=\\$)\\d+');
    expect(/(?<!\$)\d+/.source).toBe('(?<!\\$)\\d+');
    expect(/h(?=(\w)+)/.source).toBe('h(?=(\\w)+)');
    expect(/(?<=(\w)+)r/.source).toBe("(?<=(\\w)+)r");
    expect(/(?<=(o)d\1)r/.source).toBe('(?<=(o)d\\1)r');
    expect(/(?<=\1d(o))r/.source).toBe('(?<=\\1d(o))r');
});