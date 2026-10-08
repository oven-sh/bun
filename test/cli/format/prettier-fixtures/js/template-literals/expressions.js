const long1 = `long ${a//comment
  .b} long longlong ${a.b.c.d.e} long longlong ${a.b.c.d.e} long longlong ${a.b.c.d.e} long long`;
const long2 = `long ${a.b.c.d.e} long longlong ${loooooooooooooooooong} long longlong ${loooooooooooooooooong} long longlong ${loooooooooooooooooong} long long`;

const long3 = `long long long long long long long long long long long ${a.b.c.d.e} long long long long long long long long long long long long long`;

const description =
  `The value of the ${cssName} css of the ${this._name} element`;

const foo = `such a long template string ${foo.bar.baz} that prettier will want to wrap it`;

const shouldWrapForNow = `such a long template string ${foo().bar.baz} that prettier will want to wrap it`;

const shouldNotWrap = `simple expressions should not break ${this} ${variable} ${a.b.c} ${this.b.c} ${a[b].c} ${a.b[c]} ${a.b['c']} ${a?.b?.c}`;

console.log(chalk.white(`Covered Lines below threshold: ${coverageSettings.lines}%. Actual: ${coverageSummary.total.lines.pct}%`))

x = `mdl-textfield mdl-js-textfield ${className} ${content.length > 0
  ? 'is-dirty'
  : ''} combo-box__input`

function testing() {
  const p = {};
  // faking some tabs since I can't paste my real code in
  if(true) {
    if(false) {
      return `${process.env.OPENID_URL}/something/something/something?${Object.keys(p)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`)
        .join("&")}`;
    }
  }
}

console.log(
  `Trying update appcast for ${app.name} (${app.cask.appcast}) -> (${app.cask.appcastGenerated})`
)

console.log(`brew cask audit --download ${_.map(definitions, 'caskName').join(' ')}`)

console.log(`\nApparently jetbrains changed the release artifact for ${app.name}@${app.jetbrains.version}.\n`);

descirbe('something', () => {
  test(`{pass: false} expect(${small}).toBeGreaterThanOrEqual(${big})`, () => {});
})

throw new Error(`pretty-format: Option "theme" has a key "${key}" whose value "${value}" is undefined in ansi-styles.`,)

a = `${[[1, 2, 3], [4, 5, 6]]}`
