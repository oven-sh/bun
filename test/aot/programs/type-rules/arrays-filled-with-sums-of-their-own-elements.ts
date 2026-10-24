function show(name: string, f: () => unknown) { try { console.log(name, String(f())); } catch (e) { console.log(name, "threw", (e as Error).constructor.name); } }

function pushed() { const parts = []; parts.push("a"); parts.push(parts[0] + parts[1]); parts.push(parts[7] + parts[8]); return parts.join("|") + " " + typeof parts[2]; }
function onlyStrings() { const parts = []; parts.push("a"); parts.push(parts[0] + "b"); parts.push("c" + parts[1]); return parts.join("|") + " " + typeof parts[2] + " " + parts[2].length; }
function byIndex() { const parts = []; parts[0] = "a"; parts[1] = parts[0] + parts[0]; parts[2] = parts[8] + parts[9]; return parts.join("|") + " " + typeof parts[2]; }
function unshifted() { const parts = []; parts.unshift("a"); parts.unshift(parts[5] + parts[6]); return parts.join("|") + " " + typeof parts[0]; }
function eachOther() { const left = []; const right = []; left.push("a"); right.push("b"); left.push(right[0] + "x"); right.push(left[3] + left[4]); left.push(right[1] + right[1]); return left.join("|") + " " + right.join("|") + " " + typeof left[2] + " " + typeof right[1]; }
function nested() { const rows = []; rows.push(["a"]); rows.push([rows[0][0] + rows[0][1]]); rows.push([rows[0][5] + rows[0][6]]); return rows.join("|") + " " + typeof rows[2][0]; }
function lengthOfElement() { const parts = []; parts.push("a"); parts.push(parts[3] + parts[4]); return parts[1].length; }
function inALoop(count: number) { const parts = []; parts.push("a"); for (let i = 0; i < count; i++) parts.push(parts[i] + parts[i + 2]); return parts.join("|") + " " + typeof parts[count]; }
function fromOutside(text: string) { const parts = []; parts.push("a"); parts.push(parts[0] + JSON.parse(text)); parts.push(JSON.parse(text)); parts.push(parts[2] + parts[2]); return parts.join("|") + " " + typeof parts[2] + " " + typeof parts[3]; }

show("pushed", pushed);
show("only strings", onlyStrings);
show("by index", byIndex);
show("unshifted", unshifted);
show("each other", eachOther);
show("nested", nested);
show("length of an element", lengthOfElement);
show("in a loop", () => inALoop(3));
show("from outside", () => fromOutside("4"));
