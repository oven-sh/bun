const HEX = "0123456789ABCDEF";
const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

function isUnreserved(byte: number): boolean {
  return (
    (byte >= 0x41 && byte <= 0x5a) || // A-Z
    (byte >= 0x61 && byte <= 0x7a) || // a-z
    (byte >= 0x30 && byte <= 0x39) || // 0-9
    byte === 0x2d || // -
    byte === 0x5f || // _
    byte === 0x2e || // .
    byte === 0x7e // ~
  );
}

function uriEncodeBytes(bytes: Uint8Array, encodeSlash: boolean): string {
  let out = "";
  for (const byte of bytes) {
    if (isUnreserved(byte) || (byte === 0x2f && !encodeSlash)) {
      out += String.fromCharCode(byte);
    } else {
      out += "%" + HEX[byte >> 4] + HEX[byte & 15];
    }
  }
  return out;
}

/**
 * The URI encoding of AWS Signature Version 4. It keeps `A-Z a-z 0-9 - _ . ~`
 * and writes each other byte of the UTF-8 form as `%XX` with uppercase hex.
 * The canonical URI keeps `/`. The canonical query string encodes it.
 */
export function uriEncode(input: string | Uint8Array, encodeSlash: boolean): string {
  if (typeof input !== "string") {
    const text = decodeUtf8(input);
    if (text === undefined) return uriEncodeBytes(input, encodeSlash);
    input = text;
  }
  if (!/[^A-Za-z0-9\-_.~]/.test(input)) return input;
  let encoded: string;
  try {
    encoded = encodeURIComponent(input);
  } catch {
    // The text has one half of a surrogate pair.
    return uriEncodeBytes(encoder.encode(input), encodeSlash);
  }
  // encodeURIComponent keeps these 5 characters. The encoding of AWS does not.
  encoded = encoded.replace(/[!'()*]/g, char => "%" + HEX[char.charCodeAt(0) >> 4] + HEX[char.charCodeAt(0) & 15]);
  return encodeSlash ? encoded : encoded.replaceAll("%2F", "/");
}

function hexValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

/**
 * Decodes percent-encoding to bytes. A `%` that two hex digits do not follow
 * stays as it is. `plusIsSpace` is for query strings.
 */
export function percentDecode(input: string, plusIsSpace = false): Uint8Array {
  const raw = encoder.encode(input);
  if (!input.includes("%") && !(plusIsSpace && input.includes("+"))) return raw;
  const out = new Uint8Array(raw.length);
  let length = 0;
  for (let i = 0; i < raw.length; i++) {
    const byte = raw[i];
    if (byte === 0x25 && i + 2 < raw.length && hexValue(raw[i + 1]) !== -1 && hexValue(raw[i + 2]) !== -1) {
      out[length++] = (hexValue(raw[i + 1]) << 4) | hexValue(raw[i + 2]);
      i += 2;
    } else if (byte === 0x2b && plusIsSpace) {
      out[length++] = 0x20;
    } else {
      out[length++] = byte;
    }
  }
  return out.subarray(0, length);
}

/** Decodes UTF-8. Returns `undefined` when the bytes are not valid UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

/** Percent-decodes to a string. Returns `undefined` when the result is not valid UTF-8. */
export function percentDecodeToString(input: string, plusIsSpace = false): string | undefined {
  if (!input.includes("%")) return plusIsSpace ? input.replaceAll("+", " ") : input;
  try {
    return decodeURIComponent(plusIsSpace ? input.replaceAll("+", " ") : input);
  } catch {
    // decodeURIComponent refuses a `%` without two hex digits. The server keeps such a `%` as it is.
    return decodeUtf8(percentDecode(input, plusIsSpace));
  }
}

/**
 * The encoding that S3 applies to keys in a list response when the request has
 * `encoding-type=url`. It keeps `A-Z a-z 0-9 - _ . * /`, writes a space as `+`
 * and writes each other byte as `%XX`.
 */
export function urlEncodeListValue(value: string): string {
  let out = "";
  for (const byte of encoder.encode(value)) {
    if ((isUnreserved(byte) && byte !== 0x7e) || byte === 0x2a || byte === 0x2f) {
      out += String.fromCharCode(byte);
    } else if (byte === 0x20) {
      out += "+";
    } else {
      out += "%" + HEX[byte >> 4] + HEX[byte & 15];
    }
  }
  return out;
}

/**
 * Orders strings by their UTF-8 bytes, the order in which S3 lists keys. It
 * differs from the UTF-16 order of JavaScript for a character above U+FFFF
 * against one in U+E000 to U+FFFF.
 */
export function compareUtf8(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    const xSurrogate = x >= 0xd800 && x <= 0xdfff;
    const ySurrogate = y >= 0xd800 && y <= 0xdfff;
    if (xSurrogate !== ySurrogate) return xSurrogate ? 1 : -1;
    return x < y ? -1 : 1;
  }
  return a.length - b.length;
}

export function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** Formats a date as `YYYYMMDDTHHMMSSZ`, the format of `x-amz-date`. */
export function formatAmzDate(date: Date): string {
  return (
    pad(date.getUTCFullYear(), 4) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

/** Parses `YYYYMMDDTHHMMSSZ`. Returns `undefined` when the text has another format or is not a real date. */
export function parseAmzDate(text: string): Date | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (formatAmzDate(date) !== text) return undefined;
  return date;
}

/** Formats a date for an HTTP header such as `Last-Modified`. */
export function httpDate(date: Date): string {
  return date.toUTCString();
}

/** Parses an HTTP date header. Returns `undefined` when the text is not a date. */
export function parseHttpDate(text: string | null | undefined): Date | undefined {
  if (!text) return undefined;
  const time = Date.parse(text);
  return Number.isNaN(time) ? undefined : new Date(time);
}

/** Removes one pair of double quotes and the weak validator prefix from an entity tag. */
export function unquoteETag(value: string): string {
  let tag = value.trim();
  if (tag.startsWith("W/")) tag = tag.slice(2);
  if (tag.length >= 2 && tag.startsWith('"') && tag.endsWith('"')) tag = tag.slice(1, -1);
  return tag;
}

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A random identifier of letters and digits. */
export function randomId(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  return out;
}

export function randomHex(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");
}
