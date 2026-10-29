import { malformedXml } from "./errors.ts";

export const S3_XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";

/**
 * The content of an XML element.
 * - A string, number or boolean is text.
 * - A `Date` is an ISO 8601 timestamp with milliseconds, the format of S3.
 * - An object is a sequence of child elements, one per property, in insertion order.
 * - An array repeats the element once per item.
 * - `undefined` and `null` write nothing.
 * - An `XmlFragment` is a sequence of child elements where one name can occur
 *   more than once, not in one block.
 */
export type XmlNode =
  | string
  | number
  | boolean
  | Date
  | undefined
  | null
  | XmlFragment
  | XmlAttributes
  | XmlNode[]
  | { [tag: string]: XmlNode };

export class XmlFragment {
  constructor(readonly items: [tag: string, node: XmlNode][]) {}
}

/** An element that has attributes. */
export class XmlAttributes {
  constructor(
    readonly attributes: Record<string, string>,
    readonly content: XmlNode,
  ) {}
}

export function escapeXml(text: string): string {
  let out = "";
  let copied = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    let escaped: string;
    if (code === 0x26) escaped = "&amp;";
    else if (code === 0x3c) escaped = "&lt;";
    else if (code === 0x3e) escaped = "&gt;";
    else if (code === 0x22) escaped = "&quot;";
    else if (code === 0x27) escaped = "&apos;";
    else if (code < 0x20 || code === 0x7f || code === 0xfffe || code === 0xffff) {
      escaped = `&#x${code.toString(16).toUpperCase()};`;
    } else continue;
    out += text.slice(copied, i) + escaped;
    copied = i + 1;
  }
  return copied === 0 ? text : out + text.slice(copied);
}

function writeElement(out: string[], tag: string, node: XmlNode): void {
  if (node === undefined || node === null) return;
  if (Array.isArray(node)) {
    for (const item of node) writeElement(out, tag, item);
    return;
  }
  if (node instanceof XmlAttributes) {
    out.push("<", tag);
    for (const name in node.attributes) out.push(" ", name, '="', escapeXml(node.attributes[name]), '"');
    out.push(">");
    if (node.content !== undefined && node.content !== null) writeContent(out, node.content);
    out.push("</", tag, ">");
    return;
  }
  out.push("<", tag, ">");
  writeContent(out, node);
  out.push("</", tag, ">");
}

function writeContent(out: string[], node: Exclude<XmlNode, undefined | null>): void {
  if (Array.isArray(node) || node instanceof XmlAttributes) {
    throw new TypeError("An array or an element with attributes needs a tag name");
  }
  if (node instanceof XmlFragment) {
    for (const [tag, child] of node.items) writeElement(out, tag, child);
  } else if (node instanceof Date) {
    out.push(node.toISOString());
  } else if (typeof node === "object") {
    for (const tag in node) writeElement(out, tag, node[tag]);
  } else {
    out.push(escapeXml(String(node)));
  }
}

/** Serializes a document with the XML declaration. The root element gets the S3 namespace unless `xmlns` is `null`. */
export function xmlDocument(
  root: string,
  content: Exclude<XmlNode, undefined | null | XmlNode[] | XmlAttributes>,
  xmlns: string | null = S3_XMLNS,
): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n<', root];
  if (xmlns !== null) out.push(' xmlns="', escapeXml(xmlns), '"');
  out.push(">");
  writeContent(out, content);
  out.push("</", root, ">");
  return out.join("");
}

export interface XmlElement {
  /** The local name, without a namespace prefix. */
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** The text and CDATA that are direct children of the element, joined. */
  text: string;
}

export function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return element?.children.find(c => c.name === name);
}

export function children(element: XmlElement | undefined, name: string): XmlElement[] {
  return element?.children.filter(c => c.name === name) ?? [];
}

/** The text of the first child element with that name. */
export function childText(element: XmlElement | undefined, name: string): string | undefined {
  return child(element, name)?.text;
}

const MAX_DEPTH = 64;

function isNameStart(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a) || code === 0x5f || code === 0x3a || code >= 0x80
  );
}

function isNameCharacter(code: number): boolean {
  return isNameStart(code) || (code >= 0x30 && code <= 0x39) || code === 0x2d || code === 0x2e;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/**
 * Parses an XML document from a request body. It accepts what S3 request
 * bodies use: elements, attributes, text, CDATA, comments, processing
 * instructions, and the predefined and numeric entities. A document type
 * declaration is an error. Any error is the S3 error `MalformedXML`.
 */
export function parseXml(input: string | Uint8Array): XmlElement {
  let source: string;
  if (typeof input === "string") {
    source = input;
  } else {
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      throw malformedXml();
    }
  }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);

  let pos = 0;

  function fail(): never {
    throw malformedXml();
  }

  function skipWhitespace(): void {
    while (pos < source.length) {
      const c = source.charCodeAt(pos);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) break;
      pos++;
    }
  }

  function skipUntil(terminator: string): void {
    const end = source.indexOf(terminator, pos);
    if (end === -1) fail();
    pos = end + terminator.length;
  }

  /** Skips whitespace, comments and processing instructions. */
  function skipMisc(): void {
    for (;;) {
      skipWhitespace();
      if (source.startsWith("<?", pos)) skipUntil("?>");
      else if (source.startsWith("<!--", pos)) skipUntil("-->");
      else return;
    }
  }

  function readName(): string {
    const start = pos;
    if (pos >= source.length || !isNameStart(source.charCodeAt(pos))) fail();
    pos++;
    while (pos < source.length && isNameCharacter(source.charCodeAt(pos))) pos++;
    return source.slice(start, pos);
  }

  function decodeEntities(text: string): string {
    if (!text.includes("&")) return text;
    return text.replace(/&([^;&]*);?/g, (match, body: string) => {
      if (!match.endsWith(";")) fail();
      if (body.startsWith("#")) {
        const hex = body[1] === "x" || body[1] === "X";
        const digits = body.slice(hex ? 2 : 1);
        if (!(hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)) fail();
        const codePoint = parseInt(digits, hex ? 16 : 10);
        if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) fail();
        return String.fromCodePoint(codePoint);
      }
      const value = ENTITIES[body];
      if (value === undefined) fail();
      return value;
    });
  }

  function readElement(depth: number): XmlElement {
    if (depth > MAX_DEPTH) fail();
    // The caller checked that source[pos] is "<".
    pos++;
    const qualifiedName = readName();
    const attributes: Record<string, string> = {};

    for (;;) {
      const before = pos;
      skipWhitespace();
      if (source.startsWith("/>", pos)) {
        pos += 2;
        return { name: localName(qualifiedName), attributes, children: [], text: "" };
      }
      if (source[pos] === ">") {
        pos++;
        break;
      }
      if (pos === before) fail();
      const attribute = readName();
      skipWhitespace();
      if (source[pos] !== "=") fail();
      pos++;
      skipWhitespace();
      const quote = source[pos];
      if (quote !== '"' && quote !== "'") fail();
      const end = source.indexOf(quote, pos + 1);
      if (end === -1) fail();
      const raw = source.slice(pos + 1, end);
      if (raw.includes("<") || attribute in attributes) fail();
      attributes[attribute] = decodeEntities(raw);
      pos = end + 1;
    }

    const element: XmlElement = { name: localName(qualifiedName), attributes, children: [], text: "" };
    for (;;) {
      const next = source.indexOf("<", pos);
      if (next === -1) fail();
      if (next > pos) element.text += decodeEntities(source.slice(pos, next));
      pos = next;

      if (source.startsWith("</", pos)) {
        pos += 2;
        if (readName() !== qualifiedName) fail();
        skipWhitespace();
        if (source[pos] !== ">") fail();
        pos++;
        // Whitespace between child elements is not content.
        if (element.children.length > 0 && element.text.trim() === "") element.text = "";
        return element;
      }
      if (source.startsWith("<!--", pos)) {
        skipUntil("-->");
      } else if (source.startsWith("<![CDATA[", pos)) {
        const end = source.indexOf("]]>", pos);
        if (end === -1) fail();
        element.text += source.slice(pos + 9, end);
        pos = end + 3;
      } else if (source.startsWith("<?", pos)) {
        skipUntil("?>");
      } else if (source.startsWith("<!", pos)) {
        fail();
      } else {
        element.children.push(readElement(depth + 1));
      }
    }
  }

  skipMisc();
  if (source[pos] !== "<" || source[pos + 1] === "!") fail();
  const root = readElement(0);
  skipMisc();
  if (pos !== source.length) fail();
  return root;
}

function localName(qualifiedName: string): string {
  const colon = qualifiedName.indexOf(":");
  return colon === -1 ? qualifiedName : qualifiedName.slice(colon + 1);
}
