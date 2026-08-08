const out = typeof print === "function" ? print : console.log; const s = v => JSON.stringify(v);
const t = (label, fn) => { try { out(label.padEnd(40) + s(fn())); } catch (e) { out(label.padEnd(40) + "THREW " + e.message.slice(0,40)); } };
// Finding 3: ^ in nested forward assertion
t("(?<=(?=^)x)y", () => /(?<=(?=^)x)y/.exec("xy"));
t("(?<=(?<=(?=^))a)x 3-deep", () => /(?<=(?<=(?=^))a)x/.exec("ax"));
// Finding 2: \b in nested forward assertion at subject start (substring parent effect)
t("(?<=(?=\\bx)x)y independent", () => /(?<=(?=\bx)x)y/.exec("xy!"));
t("(?<=(?=\\bx)x)y substring-w", () => { const p = "wxy!"; return /(?<=(?=\bx)x)y/.exec(p.slice(1)); });
t("(?<=(?=\\Bx)x)y", () => /(?<=(?=\Bx)x)y/.exec("axy"));
// Finding 4: astral literal in nested group head sets the register
t("\u{1F601}z|x(?:a)", () => new RegExp("\u{1F601}z|x(?:a)", "u").exec("x\u{1F601}z"));
t("x(?=a)|\u{1F601}z", () => new RegExp("\u{1F601}z|x(?=a)", "u").exec("x\u{1F601}z"));
t("\u{1F601}z|x(?:a)+", () => new RegExp("\u{1F601}z|x(?:a)+", "u").exec("x\u{1F601}z"));
