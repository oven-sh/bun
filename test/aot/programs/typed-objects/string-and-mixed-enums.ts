// String enums, unions of literals, const enums, mixed enums, and numeric enums used as discriminants.
enum Color { Red = "red", Green = "green", Blue = "BLUE", Empty = "" }
enum Level { Debug, Info, Warn = 10, Error, Off = -1 }
enum Mixed { No = 0, Yes = "YES", Maybe = 2 }
const enum Dir { Up = "up", Down = "down" }
type Align = "left" | "right" | "center"
type Digit = 0 | 1 | 2
interface Styled { color: Color; level: Level; align: Align; digit: Digit; mixed: Mixed; dir?: Dir; on: true | "auto" | 0 }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }

const st: Styled = { color: Color.Blue, level: Level.Warn, align: "center", digit: 2, mixed: Mixed.Yes, on: "auto" }
console.log(show(st), st.color, st.level, st.align, st.digit, st.mixed, st.dir, st.on)

// They are real strings and numbers as soon as anyone looks.
console.log(typeof st.color, st.color.length, st.color.toLowerCase(), st.color + "!", st.color[0], st.color === "BLUE" as Color, st.color > Color.Green, `${st.color}/${st.align}`, st.align.toUpperCase(), st.align.charCodeAt(0), [st.color, st.align].join("-"))
console.log(typeof st.level, st.level + 1, st.level * 0.5, st.level.toFixed(1), st.digit + st.digit, -st.digit, st.digit / 4, Level[st.level], String(st.mixed) + typeof st.mixed, Color.Empty.length, !Color.Empty, Color.Empty || "fallback")

// Every member through one field.
const seen: string[] = []
for (const c of [Color.Red, Color.Green, Color.Blue, Color.Empty]) { st.color = c; seen.push(st.color + ":" + st.color.length) }
for (const l of [Level.Debug, Level.Info, Level.Warn, Level.Error, Level.Off]) { st.level = l; seen.push(l + "=" + Level[st.level]) }
for (const m of [Mixed.No, Mixed.Yes, Mixed.Maybe]) { st.mixed = m; seen.push(typeof st.mixed + st.mixed) }
for (const v of [true, "auto", 0] as const) { st.on = v; seen.push(typeof st.on + String(st.on) + (st.on ? "T" : "F")) }
for (const d of [0, 1, 2] as const) { st.digit = d; seen.push(String(st.digit * 2)) }
console.log(seen.join())

// A string built at run time is the same value as the literal.
function build(parts: string[]): string { return parts.join("") }
const built = build(["ri", "ght"])
if (built === "left" || built === "right" || built === "center") st.align = built
const parsedColor: string = JSON.parse('"green"')
if (parsedColor === Color.Green) st.color = parsedColor
console.log(st.align, st.align === "right", st.color, st.color === Color.Green, st.color === build(["gre", "en"]), new Set<string>([st.align, "right", build(["right"])]).size)

// switch, with fall-through and default.
function paint(c: Color): number { switch (c) { case Color.Red: return 1; case Color.Green: case Color.Blue: return 2; case Color.Empty: return 3 } }
function side(a: Align): string { switch (a) { case "left": return "L"; case "right": return "R"; default: return "C" } }
function severity(l: Level): string { switch (l) { case Level.Off: return "off"; case Level.Debug: case Level.Info: return "low"; case Level.Warn: return "mid"; default: return "high" } }
console.log([Color.Red, Color.Green, Color.Blue, Color.Empty].map(paint).join(), (["left", "right", "center"] as Align[]).map(side).join(""), [Level.Debug, Level.Info, Level.Warn, Level.Error, Level.Off].map(severity).join())

// As keys of records (laid out: the keys are known) and of dictionaries and maps.
const perColor: Record<Color, number> = { [Color.Red]: 1, [Color.Green]: 2, [Color.Blue]: 3, [Color.Empty]: 4 }
const perAlign: { [K in Align]?: number } = { right: 1 }
perAlign[st.align] = (perAlign[st.align] ?? 0) + 1; perAlign.left = 5
perColor[st.color] += 10
console.log(show(perColor), show(perAlign), perColor[Color.Empty], perColor[""], perAlign.center, "center" in perAlign)
const perLevel: Record<Level, string> = { [Level.Debug]: "d", [Level.Info]: "i", [Level.Warn]: "w", [Level.Error]: "e", [Level.Off]: "o" }
console.log(show(perLevel), perLevel[Level.Off], perLevel[st.level], perLevel[11])
const tally = new Map<Color | Align, number>([[Color.Red, 1], ["left", 2]])
console.log(tally.get(Color.Red), tally.get("left"), tally.get(st.align), tally.has("red" as Color))

// The enum objects.
console.log(show(Color), show(Level), show(Mixed), Level[10], Level[-1], Level[5], Level.Error, Color["Red"], Object.values(Color).join(), Object.entries(Mixed).map(e => e.join("=")).join())
const anyLevel: any = Level
anyLevel.Extra = 99
console.log(anyLevel.Extra, Object.keys(Level).length, Level.Warn)

// const enums leave only their values.
const going: { dir: Dir; back?: Dir } = { dir: Dir.Up }
going.back = going.dir === Dir.Up ? Dir.Down : Dir.Up
console.log(show(going), going.dir.length, Dir.Down + Dir.Up)

// Leaving through any, JSON, spread, and coming back by a checked path.
const away: any = st
console.log(away.color, away.align, away.level + 1, JSON.stringify({ ...st }), Object.values(st).map(v => typeof v).join())
away.color = Color.Red; away.align = "left"; away.level = Level.Info; away.digit = 1
console.log(st.color, st.align, st.level, st.digit, paint(st.color), side(st.align), severity(st.level), show(st))

// Many objects, one site, all members.
const colors = [Color.Red, Color.Green, Color.Blue, Color.Empty], aligns: Align[] = ["left", "right", "center"]
const grid: Styled[] = []
for (let i = 0; i < 12; i++) grid.push({ ...st, color: colors[i % 4], align: aligns[i % 3], digit: (i % 3) as Digit, level: i % 2 ? Level.Off : Level.Error })
console.log(grid.map(g => paint(g.color) + side(g.align) + g.digit + severity(g.level)[0]).join())
