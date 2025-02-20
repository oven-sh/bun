import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";

const tests_path = import.meta.dirname + "/../node_modules/test262-parser-tests";

const assert = require("assert");

function parse(filename: string, src: string) {
  // consider:
  // bun build --target=bun --no-bundle file.js

  // console.log(filename);
  const t = new Bun.Transpiler({ loader: "js" });
  // console.log("executing: "+JSON.stringify(src));
  t.transformSync(src, "js", {});
  // consider try { t.transformSync(prev_transformed, "js", {}) }
}

const panics = new Set<string>([
  // debug assertion "Scope location {d} must be greater than {d}"
  "fail/c220924a9ace3542.js",
  "fail/45b295d6c9abe25d.js",
  "fail/e922f1c6f6e5fdef.module.js",
]);
const fails = new Set<string>([
  // assigning to 'arguments' and 'eval'
  "pass/8ed2a171ab34c301.js",
  "pass/7a964712d5220b79.js",
  "pass/4ae32442eef8a4e0.js",
  "pass/ed49ee70d6eabf4a.js",
  "pass/d8b6a56583bdefab.js",
  "pass/a2f26b79b01628f9.js",
  "pass/11a021c9efe0e432.js",
  "pass/cdb9bd6096e2732c.js",
  "pass/3f6fd744861ee7c3.js",
  "pass/98c7fb7947f7eae4.js",
  "pass/48f39ccbea69907a.js",
  "pass/10fda5cd119b39a5.js",
  "pass/7be9be4918d25634.js",

  // html comment
  "pass/c532e126a986c1d4.js",
  "pass/e03ae54743348d7d.js",
  "pass/40215319424a8227.js",
  "pass/5d5b9de6d9b95f3e.js",
  "pass/d3ac25ddc7ba9779.js",
  "pass/1270d541e0fd6af8.js",
  "pass/8ec6a55806087669.js",
  "pass/ba00173ff473e7da.js",
  "pass/946bee37652a31fa.js",
  "pass/4f5419fe648c691b.js",
  "pass/fbcd793ec7c82779.js",
  "pass/b15ab152f8531a9f.js",
  "pass/8c56cf12f007a392.js",
  "pass/5a2a8e992fa4fe37.js",
  "pass/47094fe8a994b7de.js",
  "pass/9f0d8eb6f7ab8180.js",

  // (class extends !a {})
  "fail/7fc173197c3cc75d.js",

  // expression after `++`
  "fail/f0ab9eb343631ea4.js",

  // yield* must have an expression, unlike yield
  "fail/cc28dc2255cfe34d.js",
  "fail/80d1e106056a576f.js",

  // bad "yield" within generator fn
  "fail/fc7ed197a376fa5f.js",
  "fail/5e6f67a0e748cc42.js",
  "fail/04bc213db9cd1130.js",
  "fail/78e861dca5c2377d.js",
  "fail/4a887c2761eb95fb.js",
  "fail/328fddc7bdffb499.js",
  "early/aca2b59599b813df.js",
  "early/12ca91086414d5bf.js",
  "early/212c9bd036be7fe3.js",
  "early/3190762e2e329b66.js",

  // disallowed name
  "fail/2226edabbd2261a7.module.js",
  "early/84ef3bbaa772075f.js",
  "early/987442878ab414e7.js",
  "early/277a9ece19806bca.js",
  "early/4435f19f2a2a24bd.js",
  "early/227c9b7aff6a3a91.js",
  "early/cf6241d836f7f9b1.js",

  // top level return
  "fail/7187f0675eb38279.js",
  "fail/02e5861a1ef10c42.js",
  "fail/7bfaaa1e80d6255f.js",
  "fail/8beaabe25ab7e0a8.js",

  // extra parenthesis
  "fail/50a060984b757dc1.js",
  "fail/d55f938e1619ed72.js",
  "fail/8053fd407fd3d848.js",
  "fail/7fe1dff1cf764f72.js",
  "fail/38816d56f582672f.js",
  "fail/47b1abed697fe128.js",
  "fail/db41a80ccf646002.js",
  "fail/90cd97db35a1a503.js",
  "fail/cbc35276c97fcf51.js",
  "early/59c2dac860a0ceb7.js",

  // destructuring missing error
  "fail/96060983e86029b6.js",
  "fail/854ff4a8b5f8ff01.js",
  "fail/7e811fe4eb307470.js",
  "fail/fb166b71033d63b2.js",
  "fail/6b9bc191e6f5ef69.js",
  "fail/f8941121f644c8c0.js",
  "fail/29fb02620b662387.js",
  "fail/2cfb3ee18926479e.js",
  "fail/a651ee9d0db08692.js",
  "fail/b87364b546f27bff.js",
  "fail/f0f16b655e08b92c.js",
  "fail/a633b3217b5b8026.js",
  "early/a633b3217b5b8026.js",

  // regex missing error
  "fail/66e383bfd18e66ab.js",
  "fail/bf49ec8d96884562.js",
  "fail/78c215fabdf13bae.js",
  "fail/e4a43066905a597b.js",

  // Uncaught SyntaxError: setter functions must have one argument
  "fail/aae5dc521eff47c4.js",
  "fail/2f95824f19005b11.js",

  // Uncaught SyntaxError: a lexical declaration in the head of a for-in/of loop can't have an initializer
  "fail/e3fbcf63d7e43ead.js",
  "fail/e6559958e6954318.js",
  "fail/4e2cce832b4449f1.js",
  "fail/c75e9f5ea55611f3.js",
  "fail/e01265e2211e48b3.js",
  "fail/73d061b5d635a807.js",
  "fail/33d43e9f01bda5ce.js",
  "fail/858b72be7f8f19d7.js",
  "fail/0ddab4a1a651034c.js",

  // new.target only allowed within functions
  "early/d32d2f1285789b8e.js",

  // multiple labels on one loop
  "pass/7a405ea1fdb6a26e.js",
  "pass/1f3808cbdfab97e4.js",

  // duplicate label
  "early/8a6549558d83d0ee.js",
  "early/f7df8b7ca4fd194d.js",
  "early/f3c9e78cb021ccd2.js",

  // non-strict mode has errors
  "pass/784a059faa166072.js",
  "pass/b7d99c0034be0ce1.js",

  // strict mode missing errors
  "fail/3990bb94b19b1071.module.js",
  "fail/ca2716d236c027cd.js",
  "fail/938db8c9f82c8cb5.module.js",
  "fail/974222e3683f284a.js",
  "fail/11d61dbd7c1fbd1b.js",
  "fail/175c1c09015415e1.js",
  "fail/6ac4f95d48362a35.js",
  "fail/3078b4fed5626e2a.js",
  "fail/a028a9ab5777d337.js",
  "fail/295b0ed4d7872983.js",
  "fail/ab35979364766bf0.js",
  "fail/af3a9b653481f43a.js",
  "fail/147fa078a7436e0e.js",
  "fail/37e9fb0470e7ec3d.js",
  "fail/8dc484a35dd0dc16.js",
  "fail/3bc2b27a7430f818.js",
  "fail/d04aecd166354406.js",
  "fail/2d46c7c14cfb0330.js",
  "fail/0d5e450f1da8a92a.js",
  "fail/748656edbfb2d0bb.js",
  "fail/4ce3c0a393c624d5.js",
  "fail/19699bcdea35eb46.js",
  "fail/5c63ac420337d014.js",
  "fail/80bfa9f27278bbba.js",
  "fail/d201e6e384a593bb.js",
  "fail/f6924dd818b18733.js",
  "fail/66e667cc2b718770.js",
  "fail/618f5bdbe9497960.js",
  "fail/15a6123f6b825c38.js",
  "fail/bfadeead1ddbd122.js",
  "fail/ca27a03a9d04acd2.js",
  "early/903b3f9a0ac6fae6.js",
  "early/47ae14af022534a0.js",
  "early/8f12b5b733b9b694.js",
  "early/de07a50e8f528926.js",
  "early/050a006ae573e260.js",
  "early/120c78cff8ff65dc.js",
  "early/d17c5f9623ec3a71.js",
  "early/3fccb1ddcd0b1a21.js",
  "early/9efca380f8fbc57b.js",
  "early/3d3525bcdb365af8.js",
  "early/7ea0f80766201023.module.js",
  "early/5f6c26cf3848f722.js",
  "early/05e304566bded41b.js",
  "early/bd320eba790d65a4.js",

  // missing "cannot declare multiple constructors in a single class"
  "early/d76a6ab8347fca64.js",
  "early/7ff093da75220530.js",

  // uncategorized
  "early/eac5e9a554000a84.js",
  "early/ccecca0820018fef.js",
  "early/540fe548c19b2197.js",
  "early/8c0dcbcb0ba9a5c6.js",
  "early/d6828a45cebf554c.js",
  "early/277ec371718b3aa0.js",
  "early/726aaf0164355893.js",
  "early/574ea84fc61bdc31.js",
  "early/3e4d9cd4f8cc13a1.js",
  "early/80c2d2d1d35c8dcc.js",
  "early/86131c9fbad63a79.js",
  "early/a75bfa84ae7ce2dc.js",
  "early/00b5935e92cb70cf.js",
  "early/db85c599bd0e1e91.js",
  "early/c0de4c602bee2121.js",
  "early/4de83a7417cd30dd.js",
  "early/2c0f785914da9d0b.js",
  "early/0f5f47108da5c34e.js",
  "early/f1de9fc3ec4637cc.js",
  "early/06593c3474233eca.js",
  "early/be7329119eaa3d47.js",
  "early/6231fa8c107affff.js",
  "early/b8a915136484b7c6.js",
  "early/0f1c90f57df0f783.js",
  "early/51e5a52e36642bf2.module.js",
  "early/e2430bb781d34c21.js",
  "early/301abb5ba3b6506a.js",
  "early/105ffb01ec9f8aad.js",
  "early/6c4fe38464c16309.js",
  "early/0e74198f1a7ae211.js",
  "early/768606c6831f0d63.js",
  "early/2fcc5b7e8d0ff3c9.js",
  "early/3c93c40648ef8eae.js",
  "early/3db5225c6a017594.js",
  "early/c06fd9680b078c2c.js",
  "early/34aa7f65abf79bc9.js",
  "early/4497d48f4bdf5f47.module.js",
  "early/f9d44f5aa2f3ffc3.js",
  "early/57ddf6956d63bc7e.js",
  "early/fc9cad7477872ddf.js",
  "early/c020a8b89b508036.js",
  "early/e0c3d30b6fe96812.js",
  "early/e9af991a7b1821ee.js",
  "early/5d5fcacbdbc2fe97.js",
  "early/c635335476821654.js",
  "early/4286a88aed2001ee.js",
  "early/5529555236f65506.js",
  "early/33e8f35b568836ba.module.js",
  "early/1a1d935b84b0b362.js",
  "early/7958864040a4f3c1.js",
  "early/2dae582489877ee5.js",
  "early/8643da76fe7e95c7.js",
  "early/94fac3e2a049dac5.js",
  "early/1cab3eedbdd8ecca.js",
  "early/ea548dff1a942307.js",
  "early/b44d69c497ba8742.js",
  "early/3d5969e02c02bd8f.js",
  "early/cc3a712aaffdd07f.js",
  "early/12956d61ed0275e7.js",
  "early/33aec60ac4f4c6b9.js",
  "early/ec31fa5e521c5df4.js",
]);

const invalids = new Set<string>([
  // now allowed
  "fail/98204d734f8c72b3.js",
  "fail/ef81b93cf9bdb4ec.js",

  // esm in cjs file
  "fail/80da22a7d2a15fc5.js",
  "fail/7fdf990c6f42edcd.js",
  "fail/975d02f132c05a98.js",
  "fail/0f8806b7b4358487.js",
  "fail/4554c00dbb28cad8.js",

  // allowed
  "fail/79f882da06f88c9f.js",
  "fail/92b6af54adef3624.js",
  "early/1aff49273f3e3a98.js",
  "early/12a74c60f52a60de.js",
]);

const testfn = (name: string) => (panics.has(name) ? test.skip : fails.has(name) ? test.todo : test);

readdirSync(`${tests_path}/pass`).forEach(f => {
  const name = "pass/" + f;
  if (invalids.has(name)) return;
  let firstTree: unknown, secondTree: unknown;
  testfn(name)(name, () => {
    assert.doesNotThrow(() => {
      firstTree = parse(name, readFileSync(`${tests_path}/${name}`, "utf8"));
    });
    assert.doesNotThrow(() => {
      secondTree = parse(`pass-explicit/${f}`, readFileSync(`${tests_path}/pass-explicit/${f}`, "utf8"));
    });
    assert.deepStrictEqual(firstTree, secondTree);
  });
});

readdirSync(`${tests_path}/fail`).forEach(f => {
  const name = "fail/" + f;
  if (invalids.has(name)) return;
  testfn(name)(name, () => {
    assert.throws(() => {
      parse(name, readFileSync(`${tests_path}/${name}`, "utf8"));
    });
  });
});

readdirSync(`${tests_path}/early`).forEach(f => {
  const name = "early/" + f;
  if (invalids.has(name)) return;
  testfn(name)(name, () => {
    assert.throws(() => {
      parse(name, readFileSync(`${tests_path}/${name}`, "utf8"));
    });
  });
});
