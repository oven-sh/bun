// Adapted from Node.js: test/parallel/test-util-inspect-regexp.js
import assert from "assert";
import { expect, test } from "bun:test";
import util from "util";

function expectColored(regexp, expected) {
  const colored = util.inspect(regexp, { colors: true });
  const plain = util.inspect(regexp, { colors: false });
  assert.strictEqual(util.stripVTControlCharacters(colored), plain);
  assert.strictEqual(colored, expected);
}

// prettier-ignore
const tests = [
  [/a/, "\x1B[32m/\x1B[39m\x1B[33ma\x1B[39m\x1B[32m/\x1B[39m"],
  [/a|b/, "\x1B[32m/\x1B[39m\x1B[33ma\x1B[39m\x1B[35m|\x1B[39m\x1B[33mb\x1B[39m\x1B[32m/\x1B[39m"],
  [/^$/, "\x1B[32m/\x1B[39m\x1B[35m^\x1B[39m\x1B[35m$\x1B[39m\x1B[32m/\x1B[39m"],
  [/ab+c/gi, "\x1B[32m/\x1B[39m\x1B[33ma\x1B[39m\x1B[33mb\x1B[39m\x1B[35m+\x1B[39m\x1B[33mc\x1B[39m\x1B[32m/\x1B[39m\x1B[31mgi\x1B[39m"],
  [/^(?<year>\d{4})-(?<mon>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\d|3[01])$/u, "\x1B[32m/\x1B[39m\x1B[35m^\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?<\x1B[39m\x1B[33myear\x1B[39m\x1B[31m>\x1B[39m\x1B[36m\\d\x1B[39m\x1B[33m{\x1B[39m\x1B[35m4\x1B[39m\x1B[33m}\x1B[39m\x1B[31m)\x1B[39m\x1B[33m-\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?<\x1B[39m\x1B[33mmon\x1B[39m\x1B[31m>\x1B[39m\x1B[36m0\x1B[39m\x1B[33m[\x1B[39m\x1B[36m1\x1B[39m\x1B[35m-\x1B[39m\x1B[36m9\x1B[39m\x1B[33m]\x1B[39m\x1B[32m|\x1B[39m\x1B[36m1\x1B[39m\x1B[33m[\x1B[39m\x1B[36m0\x1B[39m\x1B[35m-\x1B[39m\x1B[36m2\x1B[39m\x1B[33m]\x1B[39m\x1B[31m)\x1B[39m\x1B[33m-\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?<\x1B[39m\x1B[33mday\x1B[39m\x1B[31m>\x1B[39m\x1B[36m0\x1B[39m\x1B[33m[\x1B[39m\x1B[36m1\x1B[39m\x1B[35m-\x1B[39m\x1B[36m9\x1B[39m\x1B[33m]\x1B[39m\x1B[32m|\x1B[39m\x1B[33m[\x1B[39m\x1B[36m1\x1B[39m\x1B[36m2\x1B[39m\x1B[33m]\x1B[39m\x1B[36m\\d\x1B[39m\x1B[32m|\x1B[39m\x1B[36m3\x1B[39m\x1B[33m[\x1B[39m\x1B[36m0\x1B[39m\x1B[36m1\x1B[39m\x1B[33m]\x1B[39m\x1B[31m)\x1B[39m\x1B[35m$\x1B[39m\x1B[32m/\x1B[39m\x1B[31mu\x1B[39m"],
  [/^(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{12,}$/, "\x1B[32m/\x1B[39m\x1B[35m^\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?=\x1B[39m\x1B[35m.\x1B[39m\x1B[32m*\x1B[39m\x1B[33m[\x1B[39m\x1B[36mA\x1B[39m\x1B[35m-\x1B[39m\x1B[36mZ\x1B[39m\x1B[33m]\x1B[39m\x1B[31m)\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?=\x1B[39m\x1B[35m.\x1B[39m\x1B[32m*\x1B[39m\x1B[36m\\d\x1B[39m\x1B[31m)\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?=\x1B[39m\x1B[35m.\x1B[39m\x1B[32m*\x1B[39m\x1B[33m[\x1B[39m\x1B[36m^\x1B[39m\x1B[36m\\w\x1B[39m\x1B[36m\\s\x1B[39m\x1B[33m]\x1B[39m\x1B[31m)\x1B[39m\x1B[36m.\x1B[39m\x1B[31m{\x1B[39m\x1B[36m12\x1B[39m\x1B[33m,\x1B[39m\x1B[31m}\x1B[39m\x1B[35m$\x1B[39m\x1B[32m/\x1B[39m"],
  [/\b(?<!\$)\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/, "\x1B[32m/\x1B[39m\x1B[33m\\b\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?<!\x1B[39m\x1B[36m\\$\x1B[39m\x1B[31m)\x1B[39m\x1B[33m\\d\x1B[39m\x1B[31m{\x1B[39m\x1B[36m1\x1B[39m\x1B[33m,\x1B[39m\x1B[36m3\x1B[39m\x1B[31m}\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?:\x1B[39m\x1B[32m,\x1B[39m\x1B[36m\\d\x1B[39m\x1B[33m{\x1B[39m\x1B[35m3\x1B[39m\x1B[33m}\x1B[39m\x1B[31m)\x1B[39m\x1B[35m*\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?:\x1B[39m\x1B[36m\\.\x1B[39m\x1B[36m\\d\x1B[39m\x1B[32m+\x1B[39m\x1B[31m)\x1B[39m\x1B[35m?\x1B[39m\x1B[33m\\b\x1B[39m\x1B[32m/\x1B[39m"],
  [/\b\w+(?=\s*:\s)/, "\x1B[32m/\x1B[39m\x1B[33m\\b\x1B[39m\x1B[33m\\w\x1B[39m\x1B[35m+\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?=\x1B[39m\x1B[36m\\s\x1B[39m\x1B[32m*\x1B[39m\x1B[36m:\x1B[39m\x1B[36m\\s\x1B[39m\x1B[31m)\x1B[39m\x1B[32m/\x1B[39m"],
  [/^(?:(?!cat).)*$/s, "\x1B[32m/\x1B[39m\x1B[35m^\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?:\x1B[39m\x1B[33m(\x1B[39m\x1B[33m?!\x1B[39m\x1B[35mc\x1B[39m\x1B[35ma\x1B[39m\x1B[35mt\x1B[39m\x1B[33m)\x1B[39m\x1B[35m.\x1B[39m\x1B[31m)\x1B[39m\x1B[35m*\x1B[39m\x1B[35m$\x1B[39m\x1B[32m/\x1B[39m\x1B[31ms\x1B[39m"],
  [/\b(0[xX])(?<hex>[0-9A-Fa-f]+)\b/, "\x1B[32m/\x1B[39m\x1B[33m\\b\x1B[39m\x1B[31m(\x1B[39m\x1B[36m0\x1B[39m\x1B[33m[\x1B[39m\x1B[36mx\x1B[39m\x1B[36mX\x1B[39m\x1B[33m]\x1B[39m\x1B[31m)\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?<\x1B[39m\x1B[33mhex\x1B[39m\x1B[31m>\x1B[39m\x1B[33m[\x1B[39m\x1B[36m0\x1B[39m\x1B[35m-\x1B[39m\x1B[36m9\x1B[39m\x1B[36mA\x1B[39m\x1B[35m-\x1B[39m\x1B[36mF\x1B[39m\x1B[36ma\x1B[39m\x1B[35m-\x1B[39m\x1B[36mf\x1B[39m\x1B[33m]\x1B[39m\x1B[32m+\x1B[39m\x1B[31m)\x1B[39m\x1B[33m\\b\x1B[39m\x1B[32m/\x1B[39m"],
  [/\b([A-Za-z]+)\s+\1\b/i, "\x1B[32m/\x1B[39m\x1B[33m\\b\x1B[39m\x1B[31m(\x1B[39m\x1B[33m[\x1B[39m\x1B[36mA\x1B[39m\x1B[35m-\x1B[39m\x1B[36mZ\x1B[39m\x1B[36ma\x1B[39m\x1B[35m-\x1B[39m\x1B[36mz\x1B[39m\x1B[33m]\x1B[39m\x1B[32m+\x1B[39m\x1B[31m)\x1B[39m\x1B[33m\\s\x1B[39m\x1B[35m+\x1B[39m\x1B[33m\\1\x1B[39m\x1B[33m\\b\x1B[39m\x1B[32m/\x1B[39m\x1B[31mi\x1B[39m"],
  [/^(?:\r\n|[\n\r\u2028\u2029])+$/, "\x1B[32m/\x1B[39m\x1B[35m^\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?:\x1B[39m\x1B[36m\\r\x1B[39m\x1B[36m\\n\x1B[39m\x1B[32m|\x1B[39m\x1B[33m[\x1B[39m\x1B[36m\\n\x1B[39m\x1B[36m\\r\x1B[39m\x1B[36m\\u\x1B[39m\x1B[36m2\x1B[39m\x1B[36m0\x1B[39m\x1B[36m2\x1B[39m\x1B[36m8\x1B[39m\x1B[36m\\u\x1B[39m\x1B[36m2\x1B[39m\x1B[36m0\x1B[39m\x1B[36m2\x1B[39m\x1B[36m9\x1B[39m\x1B[33m]\x1B[39m\x1B[31m)\x1B[39m\x1B[35m+\x1B[39m\x1B[35m$\x1B[39m\x1B[32m/\x1B[39m"],
  [/^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$/, "\x1B[32m/\x1B[39m\x1B[35m^\x1B[39m\x1B[33m#\x1B[39m\x1B[31m[\x1B[39m\x1B[33m0\x1B[39m\x1B[36m-\x1B[39m\x1B[33m9\x1B[39m\x1B[33mA\x1B[39m\x1B[36m-\x1B[39m\x1B[33mF\x1B[39m\x1B[33ma\x1B[39m\x1B[36m-\x1B[39m\x1B[33mf\x1B[39m\x1B[31m]\x1B[39m\x1B[31m{\x1B[39m\x1B[36m3\x1B[39m\x1B[31m}\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?:\x1B[39m\x1B[33m[\x1B[39m\x1B[36m0\x1B[39m\x1B[35m-\x1B[39m\x1B[36m9\x1B[39m\x1B[36mA\x1B[39m\x1B[35m-\x1B[39m\x1B[36mF\x1B[39m\x1B[36ma\x1B[39m\x1B[35m-\x1B[39m\x1B[36mf\x1B[39m\x1B[33m]\x1B[39m\x1B[33m{\x1B[39m\x1B[35m3\x1B[39m\x1B[33m}\x1B[39m\x1B[31m)\x1B[39m\x1B[35m?\x1B[39m\x1B[35m$\x1B[39m\x1B[32m/\x1B[39m"],
  [/^(?:\[(?:[^\]\\]|\.)*]|"(?:[^"\\]|\\.)*")$/, '\x1B[32m/\x1B[39m\x1B[35m^\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?:\x1B[39m\x1B[36m\\[\x1B[39m\x1B[33m(\x1B[39m\x1B[33m?:\x1B[39m\x1B[36m[\x1B[39m\x1B[35m^\x1B[39m\x1B[35m\\]\x1B[39m\x1B[35m\\\\\x1B[39m\x1B[36m]\x1B[39m\x1B[31m|\x1B[39m\x1B[35m\\.\x1B[39m\x1B[33m)\x1B[39m\x1B[32m*\x1B[39m\x1B[36m]\x1B[39m\x1B[32m|\x1B[39m\x1B[36m"\x1B[39m\x1B[33m(\x1B[39m\x1B[33m?:\x1B[39m\x1B[36m[\x1B[39m\x1B[35m^\x1B[39m\x1B[35m"\x1B[39m\x1B[35m\\\\\x1B[39m\x1B[36m]\x1B[39m\x1B[31m|\x1B[39m\x1B[35m\\\\\x1B[39m\x1B[32m.\x1B[39m\x1B[33m)\x1B[39m\x1B[32m*\x1B[39m\x1B[36m"\x1B[39m\x1B[31m)\x1B[39m\x1B[35m$\x1B[39m\x1B[32m/\x1B[39m'],
  [/^(?<quote>["'])(?:\.|(?!\k<quote>)[\s\S])*\k<quote>$/, "\x1B[32m/\x1B[39m\x1B[35m^\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?<\x1B[39m\x1B[33mquote\x1B[39m\x1B[31m>\x1B[39m\x1B[33m[\x1B[39m\x1B[36m\"\x1B[39m\x1B[36m'\x1B[39m\x1B[33m]\x1B[39m\x1B[31m)\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?:\x1B[39m\x1B[36m\\.\x1B[39m\x1B[32m|\x1B[39m\x1B[33m(\x1B[39m\x1B[33m?!\x1B[39m\x1B[33m\\k<\x1B[39m\x1B[36mquote\x1B[39m\x1B[33m>\x1B[39m\x1B[33m)\x1B[39m\x1B[33m[\x1B[39m\x1B[36m\\s\x1B[39m\x1B[36m\\S\x1B[39m\x1B[33m]\x1B[39m\x1B[31m)\x1B[39m\x1B[35m*\x1B[39m\x1B[32m\\k<\x1B[39m\x1B[31mquote\x1B[39m\x1B[32m>\x1B[39m\x1B[35m$\x1B[39m\x1B[32m/\x1B[39m"],
  [/^(?=.*\d)(?=.*[^\x61-\x7F])(?=.*[A-Za-z]).{8,}$/u, "\x1B[32m/\x1B[39m\x1B[35m^\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?=\x1B[39m\x1B[35m.\x1B[39m\x1B[32m*\x1B[39m\x1B[36m\\d\x1B[39m\x1B[31m)\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?=\x1B[39m\x1B[35m.\x1B[39m\x1B[32m*\x1B[39m\x1B[33m[\x1B[39m\x1B[36m^\x1B[39m\x1B[36m\\x61\x1B[39m\x1B[35m-\x1B[39m\x1B[36m\\x7F\x1B[39m\x1B[33m]\x1B[39m\x1B[31m)\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?=\x1B[39m\x1B[35m.\x1B[39m\x1B[32m*\x1B[39m\x1B[33m[\x1B[39m\x1B[36mA\x1B[39m\x1B[35m-\x1B[39m\x1B[36mZ\x1B[39m\x1B[36ma\x1B[39m\x1B[35m-\x1B[39m\x1B[36mz\x1B[39m\x1B[33m]\x1B[39m\x1B[31m)\x1B[39m\x1B[36m.\x1B[39m\x1B[31m{\x1B[39m\x1B[36m8\x1B[39m\x1B[33m,\x1B[39m\x1B[31m}\x1B[39m\x1B[35m$\x1B[39m\x1B[32m/\x1B[39m\x1B[31mu\x1B[39m"],
  [/^\p{Lu}\p{Ll}+(?:\s\p{Lu}\p{Ll}+)+$/u, "\x1B[32m/\x1B[39m\x1B[35m^\x1B[39m\x1B[31m\\p{\x1B[39m\x1B[33mLu\x1B[39m\x1B[31m}\x1B[39m\x1B[31m\\p{\x1B[39m\x1B[33mLl\x1B[39m\x1B[31m}\x1B[39m\x1B[35m+\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?:\x1B[39m\x1B[36m\\s\x1B[39m\x1B[33m\\p{\x1B[39m\x1B[36mLu\x1B[39m\x1B[33m}\x1B[39m\x1B[33m\\p{\x1B[39m\x1B[36mLl\x1B[39m\x1B[33m}\x1B[39m\x1B[32m+\x1B[39m\x1B[31m)\x1B[39m\x1B[35m+\x1B[39m\x1B[35m$\x1B[39m\x1B[32m/\x1B[39m\x1B[31mu\x1B[39m"],
  [/^[\p{Script=Greek}\p{Nd}]+$/u, "\x1B[32m/\x1B[39m\x1B[35m^\x1B[39m\x1B[31m[\x1B[39m\x1B[33m\\p{\x1B[39m\x1B[36mScript=Greek\x1B[39m\x1B[33m}\x1B[39m\x1B[33m\\p{\x1B[39m\x1B[36mNd\x1B[39m\x1B[33m}\x1B[39m\x1B[31m]\x1B[39m\x1B[35m+\x1B[39m\x1B[35m$\x1B[39m\x1B[32m/\x1B[39m\x1B[31mu\x1B[39m"],
  [/(a)/, "\x1B[32m/\x1B[39m\x1B[31m(\x1B[39m\x1B[36ma\x1B[39m\x1B[31m)\x1B[39m\x1B[32m/\x1B[39m"],
  [/(?:a)/, "\x1B[32m/\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?:\x1B[39m\x1B[36ma\x1B[39m\x1B[31m)\x1B[39m\x1B[32m/\x1B[39m"],
  [/(?=a)/, "\x1B[32m/\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?=\x1B[39m\x1B[36ma\x1B[39m\x1B[31m)\x1B[39m\x1B[32m/\x1B[39m"],
  [/(?!a)/, "\x1B[32m/\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?!\x1B[39m\x1B[36ma\x1B[39m\x1B[31m)\x1B[39m\x1B[32m/\x1B[39m"],
  [/(?<=a)/, "\x1B[32m/\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?<=\x1B[39m\x1B[36ma\x1B[39m\x1B[31m)\x1B[39m\x1B[32m/\x1B[39m"],
  [/(?<!a)/, "\x1B[32m/\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?<!\x1B[39m\x1B[36ma\x1B[39m\x1B[31m)\x1B[39m\x1B[32m/\x1B[39m"],
  [/(?<name>a)/, "\x1B[32m/\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?<\x1B[39m\x1B[33mname\x1B[39m\x1B[31m>\x1B[39m\x1B[36ma\x1B[39m\x1B[31m)\x1B[39m\x1B[32m/\x1B[39m"],
  [/(?<name>a)\k<name>/, "\x1B[32m/\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?<\x1B[39m\x1B[33mname\x1B[39m\x1B[31m>\x1B[39m\x1B[36ma\x1B[39m\x1B[31m)\x1B[39m\x1B[32m\\k<\x1B[39m\x1B[31mname\x1B[39m\x1B[32m>\x1B[39m\x1B[32m/\x1B[39m"],
  [/\p{Letter}+/u, "\x1B[32m/\x1B[39m\x1B[31m\\p{\x1B[39m\x1B[33mLetter\x1B[39m\x1B[31m}\x1B[39m\x1B[35m+\x1B[39m\x1B[32m/\x1B[39m\x1B[31mu\x1B[39m"],
  [/[\u{1F600}-\u{1F601}]/u, "\x1B[32m/\x1B[39m\x1B[31m[\x1B[39m\x1B[33m\\u{\x1B[39m\x1B[36m1F600\x1B[39m\x1B[33m}\x1B[39m\x1B[36m-\x1B[39m\x1B[33m\\u{\x1B[39m\x1B[36m1F601\x1B[39m\x1B[33m}\x1B[39m\x1B[31m]\x1B[39m\x1B[32m/\x1B[39m\x1B[31mu\x1B[39m"],
  [/\x61/, "\x1B[32m/\x1B[39m\x1B[33m\\x61\x1B[39m\x1B[32m/\x1B[39m"],
  [/\u{1F600}/u, "\x1B[32m/\x1B[39m\x1B[31m\\u{\x1B[39m\x1B[33m1F600\x1B[39m\x1B[31m}\x1B[39m\x1B[32m/\x1B[39m\x1B[31mu\x1B[39m"],
  [/[a-z-]/, "\x1B[32m/\x1B[39m\x1B[31m[\x1B[39m\x1B[33ma\x1B[39m\x1B[36m-\x1B[39m\x1B[33mz\x1B[39m\x1B[33m-\x1B[39m\x1B[31m]\x1B[39m\x1B[32m/\x1B[39m"],
  [/.{2,3}?abc?/, "\x1B[32m/\x1B[39m\x1B[36m.\x1B[39m\x1B[31m{\x1B[39m\x1B[36m2\x1B[39m\x1B[33m,\x1B[39m\x1B[36m3\x1B[39m\x1B[31m}\x1B[39m\x1B[35m?\x1B[39m\x1B[33ma\x1B[39m\x1B[33mb\x1B[39m\x1B[33mc\x1B[39m\x1B[35m?\x1B[39m\x1B[32m/\x1B[39m"],
  [/a{2}/, "\x1B[32m/\x1B[39m\x1B[33ma\x1B[39m\x1B[31m{\x1B[39m\x1B[36m2\x1B[39m\x1B[31m}\x1B[39m\x1B[32m/\x1B[39m"],
  [/\d/, "\x1B[32m/\x1B[39m\x1B[33m\\d\x1B[39m\x1B[32m/\x1B[39m"],
  [/[^a-z\d\u{1F600}-\u{1F601}]/u, "\x1B[32m/\x1B[39m\x1B[31m[\x1B[39m\x1B[33m^\x1B[39m\x1B[33ma\x1B[39m\x1B[36m-\x1B[39m\x1B[33mz\x1B[39m\x1B[33m\\d\x1B[39m\x1B[33m\\u{\x1B[39m\x1B[36m1F600\x1B[39m\x1B[33m}\x1B[39m\x1B[36m-\x1B[39m\x1B[33m\\u{\x1B[39m\x1B[36m1F601\x1B[39m\x1B[33m}\x1B[39m\x1B[31m]\x1B[39m\x1B[32m/\x1B[39m\x1B[31mu\x1B[39m"],
  [/(?<=Mr\.|Mrs.)\s[A-Z]\w+/, "\x1B[32m/\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?<=\x1B[39m\x1B[36mM\x1B[39m\x1B[36mr\x1B[39m\x1B[36m\\.\x1B[39m\x1B[32m|\x1B[39m\x1B[36mM\x1B[39m\x1B[36mr\x1B[39m\x1B[36ms\x1B[39m\x1B[35m.\x1B[39m\x1B[31m)\x1B[39m\x1B[33m\\s\x1B[39m\x1B[31m[\x1B[39m\x1B[33mA\x1B[39m\x1B[36m-\x1B[39m\x1B[33mZ\x1B[39m\x1B[31m]\x1B[39m\x1B[33m\\w\x1B[39m\x1B[35m+\x1B[39m\x1B[32m/\x1B[39m"],
  [/a/giu, "\x1B[32m/\x1B[39m\x1B[33ma\x1B[39m\x1B[32m/\x1B[39m\x1B[31mgiu\x1B[39m"],
  [/^p{Lu}p{Ll}+(?:sp{Lu}p{Ll}+)+$/, "\x1B[32m/\x1B[39m\x1B[35m^\x1B[39m\x1B[33mp\x1B[39m\x1B[33m{\x1B[39m\x1B[33mL\x1B[39m\x1B[33mu\x1B[39m\x1B[33m}\x1B[39m\x1B[33mp\x1B[39m\x1B[33m{\x1B[39m\x1B[33mL\x1B[39m\x1B[33ml\x1B[39m\x1B[33m}\x1B[39m\x1B[35m+\x1B[39m\x1B[31m(\x1B[39m\x1B[31m?:\x1B[39m\x1B[36ms\x1B[39m\x1B[36mp\x1B[39m\x1B[36m{\x1B[39m\x1B[36mL\x1B[39m\x1B[36mu\x1B[39m\x1B[36m}\x1B[39m\x1B[36mp\x1B[39m\x1B[36m{\x1B[39m\x1B[36mL\x1B[39m\x1B[36ml\x1B[39m\x1B[36m}\x1B[39m\x1B[32m+\x1B[39m\x1B[31m)\x1B[39m\x1B[35m+\x1B[39m\x1B[35m$\x1B[39m\x1B[32m/\x1B[39m"],
];

test("inspect.styles.regexp is a function with default color palette", () => {
  expect(typeof util.inspect.styles.regexp).toBe("function");
  expect(util.inspect.styles.regexp.colors).toEqual(["green", "red", "yellow", "cyan", "magenta"]);
});

test("util.inspect(regexp, {colors: true}) tokenizes per ECMAScript grammar", () => {
  for (const [regexp, expected] of tests) {
    expectColored(regexp, expected);
  }
});

test("highlightRegExp palette can be customized and falls back when empty", () => {
  const regexp = /(?<year>\d{4})-\d{2}|\d{2}-(?<year>\d{4})/;
  const saved = util.inspect.styles.regexp;
  const savedColors = saved.colors;
  try {
    const regular = util.inspect(regexp, { colors: true });

    util.inspect.styles.regexp.colors = [];
    assert.strictEqual(util.inspect(regexp, { colors: true }), regular);

    util.inspect.styles.regexp.colors = undefined;
    assert.strictEqual(util.inspect(regexp, { colors: true }), regular);

    util.inspect.styles.regexp.colors = ["red", "yellow", "cyan"];
    assert.strictEqual(
      util.inspect(regexp, { colors: true }),
      "\x1B[31m/\x1B[39m\x1B[33m(\x1B[39m\x1B[33m?<\x1B[39m\x1B[36myear\x1B[39m\x1B[33m>\x1B[39m\x1B[31m\\d\x1B[39m\x1B[36m{\x1B[39m\x1B[33m4\x1B[39m\x1B[36m}\x1B[39m\x1B[33m)\x1B[39m\x1B[36m-\x1B[39m\x1B[36m\\d\x1B[39m\x1B[33m{\x1B[39m\x1B[31m2\x1B[39m\x1B[33m}\x1B[39m\x1B[33m|\x1B[39m\x1B[36m\\d\x1B[39m\x1B[33m{\x1B[39m\x1B[31m2\x1B[39m\x1B[33m}\x1B[39m\x1B[36m-\x1B[39m\x1B[33m(\x1B[39m\x1B[33m?<\x1B[39m\x1B[36myear\x1B[39m\x1B[33m>\x1B[39m\x1B[31m\\d\x1B[39m\x1B[36m{\x1B[39m\x1B[33m4\x1B[39m\x1B[36m}\x1B[39m\x1B[33m)\x1B[39m\x1B[31m/\x1B[39m",
    );

    util.inspect.styles.regexp = "red";
    assert.strictEqual(
      util.inspect(regexp, { colors: true }),
      "\x1B[31m/(?<year>\\d{4})-\\d{2}|\\d{2}-(?<year>\\d{4})/\x1B[39m",
    );
  } finally {
    util.inspect.styles.regexp = saved;
    util.inspect.styles.regexp.colors = savedColors;
  }
});

test("RegExp with extra own properties still highlights the source", () => {
  const re = Object.assign(/ab+c/gi, { x: 1 });
  const out = util.inspect(re, { colors: true, breakLength: Infinity });
  expect(out).toBe(
    "\x1B[32m/\x1B[39m\x1B[33ma\x1B[39m\x1B[33mb\x1B[39m\x1B[35m+\x1B[39m\x1B[33mc\x1B[39m\x1B[32m/\x1B[39m\x1B[31mgi\x1B[39m { x: \x1B[33m1\x1B[39m }",
  );
});
