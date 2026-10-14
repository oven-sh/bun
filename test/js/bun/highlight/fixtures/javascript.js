"use strict";
const fs = require("fs");
const { join: joinPath } = require("path");

/** @typedef {{ name: string, age?: number }} Person */

/**
 * @param {Person[]} people
 * @param {(person: Person) => boolean} [filter]
 */
function names(people, filter = () => true) {
  return people.filter(filter).map(({ name }) => name);
}

class Animal {
  static count = 0;
  #sound;
  constructor(sound) {
    this.#sound = sound;
    Animal.count += 1;
  }
  speak(times = 1) {
    return `${this.#sound} `.repeat(times).trim();
  }
  static {
    Animal.count = 0;
  }
}

function Legacy() {
  if (!new.target) return new Legacy();
  this.args = arguments;
}
Legacy.prototype.toString = function () {
  return "[Legacy]";
};

var a = 1, b = a / 2 / a, c = /=/.test("=") ? a : b;
label: do {
  switch (a) {
    case 1:
      break label;
    default:
      debugger;
  }
} while (a-- > 0);

for (const key in fs) if (key in globalThis) delete globalThis[key];
const html = String.raw`<div>\n</div>`;
const page = html`<p class=${a}>Hello <b>${names([])}</b></p>`;
const element = <div onClick={() => c}>text</div>;
module.exports = { names, Animal, Legacy, joinPath, page, element, undefined };
import("./other.js").then(m => m.default?.(import.meta.url) ?? null);
