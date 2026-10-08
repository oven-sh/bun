function a() {
  // prettier-ignore
  var fnString =
    '"' + this.USE + ' ' + this.STRICT + '";\n' +
    this.filterPrefix() +
    'var fn=' + this.generateFunction('fn', 's,l,a,i') +
    extra +
    this.watchFns() +
    'return fn;';

  // prettier-ignore
  const identity = Matrix.create(
    1, 0, 0,
    0, 1, 0,
    0, 0, 0
  );

  // Let's make sure that this comment doesn't interfere

  // prettier-ignore
  const commentsWithPrettierIgnore =   {
    "ewww":
            "gross-formatting",
  };

  function giveMeSome() {
    a(  a  ); // prettier-ignore
    // shouldn't I return something?  :shrug:
  }

  // prettier-ignore
  console.error(
    'In order to use ' + prompt + ', you need to configure a ' +
    'few environment variables to be able to commit to the ' +
    'repository. Follow those steps to get you setup:\n' +
    '\n' +
    'Go to https://github.com/settings/tokens/new\n' +
    ' - Fill "Token description" with "' + prompt + ' for ' +
      repoSlug + '"\n' +
    ' - Check "public_repo"\n' +
    ' - Press "Generate Token"\n' +
    '\n' +
    'In a different tab, go to https://travis-ci.org/' +
      repoSlug + '/settings\n' +
    ' - Make sure "Build only if .travis.yml is present" is ON\n' +
    ' - Fill "Name" with "GITHUB_USER" and "Value" with the name of the ' +
      'account you generated the token with. Press "Add"\n' +
    '\n' +
    'Once this is done, commit anything to the repository to restart ' +
      'Travis and it should work :)'
  );
}

const response = {
  // prettier-ignore
  '_text': 'Turn on the lights',
  intent: 'lights',
};
