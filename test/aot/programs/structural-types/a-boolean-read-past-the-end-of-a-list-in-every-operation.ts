const flags: boolean[] = [true, false];
const odd = flags[2];
console.log(odd);
console.log(typeof odd);
console.log(typeof odd === "boolean");
console.log(odd === undefined);
console.log(odd === true, odd === false, odd !== true, odd !== false);
console.log(odd == false, odd != true, odd == null);
console.log(Number(odd), String(odd), `${odd}`, JSON.stringify(odd), JSON.stringify([odd]), JSON.stringify({ odd }));
console.log(odd ? 1 : 0, !odd, !!odd, Boolean(odd), odd && 1, odd || 2, odd ?? 3);
console.log(odd === flags[3], [odd].includes(false), [odd].indexOf(false), [odd, true].indexOf(true));
console.log(Object.is(odd, false), Object.is(odd, undefined));
switch (odd) {
  case true:
    console.log("case true");
    break;
  case false:
    console.log("case false");
    break;
  default:
    console.log("default");
}
const kept: boolean[] = [odd, odd];
console.log(kept.length, kept[0], kept.filter(flag => flag === false).length, kept.filter(flag => !flag).length, kept.every(flag => flag === true || flag === false));
