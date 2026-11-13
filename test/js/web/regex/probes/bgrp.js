const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (src, fl, str) => { try { const re = new RegExp(src, fl); const r = []; let m, n = 0;
  if (fl.includes("g")) { while ((m = re.exec(str)) !== null && n++ < 12) { r.push([m.index, ...m]); if (m[0] === "") re.lastIndex++; } out((src + " /" + fl + " " + s(str)).padEnd(52) + s(r)); }
  else { m = re.exec(str); out((src + " /" + fl + " " + s(str)).padEnd(52) + s(m && [m.index, ...m])); } } catch (e) { out((src + " /" + fl).padEnd(52) + "THREW " + e.message.slice(0, 24)); } };
const cases = [
  ["(?<=(a)+)b","","aaab"], ["(?<=(a)+?)b","","aaab"], ["(?<=(a){2,3})b","","aaaab"], ["(?<=(a){2,3}?)b","","aaaab"],
  ["(?<=(a|b)+)!","","abab!"], ["(?<=(a|b)+?)!","","abab!"], ["(?<=(ab)+c)!","","xababc!"], ["(?<=(ab)+?c)!","","xababc!"],
  ["(?<=(a*))b","","aaab"], ["(?<=(a*?))b","","aaab"], ["(?<=(a+?)a)b","","aaab"], ["(?<=(\\d)+\\.)x","g","1.x22.x"],
  ["(?<=((\\w)\\d)+)!","","a1b2c3!"], ["(?<=((?:x|(y)))+)!","","xyx!"], ["(?<=(a)(b)+)!","","abbb!"], ["(?<=(?:(c)|(d))+)!","","cdc!"],
  ["(?<!(a)+)b","g","aab bb"], ["(?<!(x|y){2})z","g","xxz xz z"], ["(?<=^(a|b)+)c","","abac"], ["(?<=(a)+)(?<=(b)?)c","","aabc"],
  ["(?<=(\\1z|(y))+)!","","yz!"], ["(?<=(a)(?:\\1)+)!","","aaa!"], ["(?<=(x)*(y)+)!","","xxyy!"], ["(?<=(?<n>a)+)b\\k<n>","","aaba"],
  ["(?<=(a){0})b","","ab"], ["(?<=(a)?)b","g","ab b"], ["(?<=(a){1,2}(b){1,2})!","","abb!"], ["(?<=((a)b|c(d))+)!","","abcd!"],
];
for (const [src, fl, str] of cases) t(src, fl, str);
for (const [src, fl, str] of cases) t(src, fl.replace("g","")+"u", str);
