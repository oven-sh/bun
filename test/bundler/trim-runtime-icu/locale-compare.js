import { attempt, COLLATIONS, done, LOCALES, SOME } from "./lists.js";

const pairs = [["a", "b"], ["a", "ä"], ["z", "Z"], ["résumé", "resume"], ["10", "9"], ["漢", "字"], ["か", "カ"], ["한", "글"], ["ก", "ข"], ["я", "а"], ["ch", "h"], ["", "a"], ["a-b", "ab"], ["😀", "😁"]];
const options = [undefined, { usage: "search" }, { numeric: true }, { caseFirst: "upper" }, { sensitivity: "base" }, { sensitivity: "accent" }, { ignorePunctuation: true }];
for (const locale of LOCALES) {
  for (const o of options) for (const [a, b] of pairs) attempt(() => a.localeCompare(b, locale, o));
  for (const collation of COLLATIONS.concat(["standard", "search", "big5han", "gb2312"])) attempt(() => "漢a".localeCompare("字b", locale + "-u-co-" + collation));
}
for (const locale of SOME) for (const keyword of ["kn-true", "kf-upper", "ks-level1", "ka-shifted", "kr-latn-digit"]) attempt(() => "a1".localeCompare("A2", locale + "-u-" + keyword));
attempt(() => "a".localeCompare("b"));
done("localeCompare");
