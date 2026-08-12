import { expect } from "bun:test";

try {
  expect("a\nb\nc\n d\ne").toEqual("a\nd\nc\nd\ne");
} catch (e) {
  console.log(e.message);
}

const a = {
  age: 25,
  name: "Alice",
  logs: [
    "Entered the building",
    "Checked in at reception",
    "Took elevator to floor 3",
    "Attended morning meeting",
    "Started working on project",
  ],
};

const b = {
  age: 30,
  name: "Bob",
  logs: [
    "Logged into system",
    "Accessed dashboard",
    "Reviewed daily reports",
    "Updated project status",
    "Sent status email to team",
    "Scheduled follow-up meeting",
  ],
};
try {
  expect(a).toEqual(b);
} catch (e) {
  console.log(e.message);
}

const longInt32ArrayExpected = new Int32Array(100000);
const longInt32ArrayReceived = new Int32Array(100000);
for (let i = 0; i < 100000; i++) {
  longInt32ArrayExpected[i] = i;
  longInt32ArrayReceived[i] = i + 1;
}
try {
  expect(longInt32ArrayReceived).toEqual(longInt32ArrayExpected);
} catch (e) {
  console.log(e.message);
}

try {
  expect("Hello 👋 世界 🌍").toEqual("Hello 👋 世界 🌎");
} catch (e) {
  console.log(e.message);
}

try {
  expect("Line 1: 你好\nLine 2: مرحبا\nLine 3: Здравствуйте").toEqual("Line 1: 你好\nLine 2: مرحبا\nLine 3: Привет");
} catch (e) {
  console.log(e.message);
}

try {
  expect({
    emoji: "🔥💧🌊",
    chinese: "测试字符串",
    arabic: "اختبار",
    mixed: "Hello 世界 🌍",
  }).toEqual({
    emoji: "🔥💧🌊",
    chinese: "测试文本",
    arabic: "اختبار",
    mixed: "Hello 世界 🌎",
  });
} catch (e) {
  console.log(e.message);
}

try {
  expect("café résumé naïve").toEqual("café resumé naive");
} catch (e) {
  console.log(e.message);
}

try {
  expect("© ® ™ £ € ¥ § ¶").toEqual("© ® ™ £ € ¥ § ¶");
} catch (e) {
  console.log(e.message);
}

try {
  expect("Línea 1: ñoño\nLínea 2: àèìòù\nLínea 3: äëïöü").toEqual("Línea 1: ñoño\nLínea 2: àèìòù\nLínea 3: aeiou");
} catch (e) {
  console.log(e.message);
}

try {
  expect({
    french: "crème brûlée",
    spanish: "niño español",
    special: "½ ¼ ¾ ± × ÷",
  }).toEqual({
    french: "crème brulée",
    spanish: "niño español",
    special: "½ ¼ ¾ ± × ÷",
  });
} catch (e) {
  console.log(e.message);
}

// Unequal values that render to the same text: single-line and multi-line.
try {
  expect(Symbol("a")).toEqual(Symbol("a"));
} catch (e) {
  console.log(e.message);
}

try {
  expect([1, , 3]).toStrictEqual([1, undefined, 3]);
} catch (e) {
  console.log(e.message);
}

try {
  const items = Array.from({ length: 600 }, (_, i) => i);
  expect({ items, id: Symbol("a") }).toEqual({ items, id: Symbol("a") });
} catch (e) {
  console.log(e.message);
}
