// A literal passed to `new` of a class that is held as `any`.
class Keeper {
  kept: any;
  constructor(given: any) {
    this.kept = given;
  }
}
const classes: any = { Keeper };
const keeper = new classes.Keeper({ count: 1, more: { n: 1, extra: "e" } });
keeper.kept.more = { n: 2 };
keeper.kept.count = "many";
console.log(keeper.kept.more.n, keeper.kept.more.extra, keeper.kept.count, JSON.stringify(keeper.kept));
