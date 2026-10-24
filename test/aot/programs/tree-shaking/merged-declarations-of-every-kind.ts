// Two declarations make one name: a class and a namespace, a function and a namespace, an enum and a namespace, an enum in two pieces, a namespace in two pieces, an interface and a class, an interface and a constant, a type and a constant. Of each pair only one side is named by code that runs, and it needs the other.
class Shape { describe() { return "shape of kind " + Shape.kind; } }
namespace Shape { export const kind = "round"; }

function parse(text: string) { return parse.prefix + text; }
namespace parse { export const prefix = ">"; }

enum Level { Low = 1 }
namespace Level { export function name(level: Level) { return "level " + Level[level]; } }

enum Pieces { First = 1 }
enum Pieces { Second = 2 }

namespace Split { export const first = "first half"; }
namespace Split { export const second = first + ", second half"; }

interface Point { x: number }
class Point { y = 2; }

interface Config { port: number }
const Config = { port: 80 };

type Name = string;
const Name = "a constant beside a type";

class OnlyStatics {}
namespace OnlyStatics { export const value = "a namespace on a class nobody constructs"; }

class UnusedMerged {}
namespace UnusedMerged { export const value = 1; }
enum UnusedPieces { A }
enum UnusedPieces { B = 1 }

const point = new Point();
const config: Config = Config;
const name: Name = Name;
console.log(new Shape().describe(), parse("text"), Level.name(Level.Low), Pieces.First, Pieces.Second, Pieces[2], Split.second);
console.log(point.y, point.x, config.port, name, OnlyStatics.value);
