import {PCRE2RegExp} from 'bun';
import { expect, test } from 'bun:test';

// PCRE2RegExp('a');

test('PCRE2RegExp', () => {
    expect(new PCRE2RegExp('a').test('a')).toBe(true);
    let r = new PCRE2RegExp('a', 'g');
    expect(r.source).toBe('a');
    expect(r.flags).toBe('g')
    expect(r.toString()).toBe('/a/g');
    r.compile('b', 'i');
    expect(r.source).toBe('b');
    expect(r.flags).toBe('i')
    expect(r.toString()).toBe('/b/i');
    let b = new PCRE2RegExp('l', 'm');
    expect(r.compile(b)).toBe(undefined);
    expect(r.source).toBe('l');
    expect(r.flags).toBe('m');
    expect(r.toString()).toBe('/l/m');

    try {
        r.compile(b, 'g');
    } catch (e) {
        expect(e.message).toBe('Cannot supply flags when constructing one RegExp from another.');
    }
});

test('PCRE2RegExp flags', () => {
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
});
