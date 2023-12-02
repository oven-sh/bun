// To update this, copy paste the following into the console of the browser
// ------------------------------------------------------------
var tab = "\t";
var シ = "wow";
var f = "";
var f = "\u2087";
var obj = {
  "\r\n": "\r\n",
  "\n": "\n",
  "\t": "\t",
  "\f": "\f",
  "\v": "\v",
  "\u2028": "\u2028",
  "\u2029": "\u2029",
  "\0": "\0 null byte",
  "😊": "😊",
  "😃": "😃",
  "🕵🏽‍♂️": "🕵🏽‍♂️",
  "㋡": "㋡",
  "☺": "☺",
  シ: "シ",
  "👋": "👋",
  f: f,
  "☹": "☹",
  "☻": "☻",
  children: 123,
};

const encoder = new TextEncoder();
const encodedObj = encoder.encode(JSON.stringify(obj));
// ------------------------------------------------------------
const correctEncodedObj = [
  123, 34, 92, 114, 92, 110, 34, 58, 34, 92, 114, 92, 110, 34, 44, 34, 92, 110, 34, 58, 34, 92, 110, 34, 44, 34, 92,
  116, 34, 58, 34, 92, 116, 34, 44, 34, 92, 102, 34, 58, 34, 92, 102, 34, 44, 34, 92, 117, 48, 48, 48, 98, 34, 58, 34,
  92, 117, 48, 48, 48, 98, 34, 44, 34, 226, 128, 168, 34, 58, 34, 226, 128, 168, 34, 44, 34, 226, 128, 169, 34, 58, 34,
  226, 128, 169, 34, 44, 34, 92, 117, 48, 48, 48, 48, 34, 58, 34, 92, 117, 48, 48, 48, 48, 194, 160, 110, 117, 108, 108,
  32, 98, 121, 116, 101, 34, 44, 34, 240, 159, 152, 138, 34, 58, 34, 240, 159, 152, 138, 34, 44, 34, 240, 159, 152, 131,
  34, 58, 34, 240, 159, 152, 131, 34, 44, 34, 240, 159, 149, 181, 240, 159, 143, 189, 226, 128, 141, 226, 153, 130, 239,
  184, 143, 34, 58, 34, 240, 159, 149, 181, 240, 159, 143, 189, 226, 128, 141, 226, 153, 130, 239, 184, 143, 34, 44, 34,
  227, 139, 161, 34, 58, 34, 227, 139, 161, 34, 44, 34, 226, 152, 186, 34, 58, 34, 226, 152, 186, 34, 44, 34, 227, 130,
  183, 34, 58, 34, 227, 130, 183, 34, 44, 34, 240, 159, 145, 139, 34, 58, 34, 240, 159, 145, 139, 34, 44, 34, 102, 34,
  58, 34, 226, 130, 135, 34, 44, 34, 226, 152, 185, 34, 58, 34, 226, 152, 185, 34, 44, 34, 226, 152, 187, 34, 58, 34,
  226, 152, 187, 34, 44, 34, 99, 104, 105, 108, 100, 114, 101, 110, 34, 58, 49, 50, 51, 125,
];

export const jsxVariants = (
  <>
    "\r\n": "\r\n", "\n": "\n", "\t": "\t", "\f": "\f", "\v": "\v", "\u2028": "\u2028", "\u2029": "\u2029", "😊": "😊",
    "😃": "😃", "🕵🏽‍♂️": "🕵🏽‍♂️", "㋡": "㋡", "☺": "☺", シ: "シ", "👋": "👋", f: f, "☹": "☹", "☻": "☻", children: 123,
    <div data="\r\n" />
    <div data="\n" />
    <div data="\t" />
    <div data="\f" />
    <div data="\v" />
    <div data="\u2028" />
    <div data="\u2029" />
    <div data="😊" />
    <div data="😃" />
    <div data="🕵🏽‍♂️" />
    <div data="㋡" />
    <div data="☺" />
    <div data="シ" />
    <div data="👋" />
    <div data="☹" />
    <div data="☻" />
    <div data="123" />
    <div key="\r\n" />
    <div>\r\n</div>
    <div key="\n" />
    <div>\n</div>
    <div key="\t" />
    <div>\t</div>
    <div key="\f" />
    <div>\f</div>
    <div key="\v" />
    <div>\v</div>
    <div key="\u2028" />
    <div>\u2028</div>
    <div key="\u2029" />
    <div>\u2029</div>
    <div key="😊" />
    <div>😊</div>
    <div key="😃" />
    <div>😃</div>
    <div key="🕵🏽‍♂️" />
    <div>🕵🏽‍♂️</div>
    <div key="㋡" />
    <div>㋡</div>
    <div key="☺" />
    <div>☺</div>
    <div key="シ" />
    <div>シ</div>
    <div key="👋" />
    <div>👋</div>
    <div key="☹" />
    <div>☹</div>
    <div key="☻" />
    <div>☻</div>
    <div key="123" />
    <div>123</div>
  </>
);

const foo = () => {};
const Bar = foo("a", {
  children: 123,
});

const carriage = obj["\r\n"];
const newline = obj["\n"];

export { obj };

export function test() {
  console.assert(carriage === "\r\n");
  console.assert(newline === "\n");
  console.assert(tab === "\t");
  console.assert(correctEncodedObj.length === encodedObj.length);
  console.assert(correctEncodedObj.every((v, i) => v === encodedObj[i]));
  return testDone(import.meta.url);
}
