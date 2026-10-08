// examples from https://github.com/prettier/prettier/issues/4125

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

req.checkBody('id').isInt().optional();
req.checkBody('name').notEmpty().optional();

const x = moment().add(1, 'day').valueOf()

// should stay on one line:
const y = obj.foo(1).foo(2).foo(3);
const z = obj.foo(-1).foo(import('2')).foo(!x).check(/[A-Z]/);

// better on multiple lines:
somePromise.then(format).then((val)=>doSomething(val)).catch((err)=>handleError(err))

// you can still force multi-line chaining with a comment:
const sha256_2 = (data) =>
  crypto // breakme
    .createHash("sha256")
    .update(data)
    .digest("hex");

// examples from https://github.com/prettier/prettier/pull/4765

if ($(el).attr("href").includes("/wiki/")) {
}

if ($(el).attr("href").includes("/wiki/")) {
  if ($(el).attr("xyz").includes("/whatever/")) {
    if ($(el).attr("hello").includes("/world/")) {
    }
  }
}

const parseNumbers = s => s.split('').map(Number).sort()

function palindrome(a, b) {
  return a.slice().reverse().join(',') === b.slice().sort().join(',');
}

// examples from https://github.com/prettier/prettier/issues/1565

d3.select("body").selectAll("p").data([1, 2, 3]).enter().style("color", "white");

Object.keys(props).filter(key => key in own === false).reduce((a, key) => {
  a[key] = props[key];
  return a;
}, {})

point().x(4).y(3).z(6).plot();

assert.equal(this.$().text().trim(), '1000');

something().then(() => doSomethingElse()).then(result => dontForgetThisAsWell(result))

db.branch(
  db.table('users').filter({ email }).count(),
  db.table('users').filter({ email: 'a@b.com' }).count(),
  db.table('users').insert({ email }),
  db.table('users').filter({ email }),
)

sandbox.stub(config, 'get').withArgs('env').returns('dev')

const date = moment.utc(userInput).hour(0).minute(0).second(0)

fetchUser(id)
  .then(fetchAccountForUser)
  .catch(handleFetchError)

fetchUser(id) //
  .then(fetchAccountForUser)
  .catch(handleFetchError)

// examples from https://github.com/prettier/prettier/issues/3107

function HelloWorld() {
  window.FooClient.setVars({
    locale: getFooLocale({ page }),
    authorizationToken: data.token,
  }).initVerify('foo_container');

  fejax.ajax({
    url: '/verification/',
    dataType: 'json',
  }).then(
    (data) => {
      this.setState({ isLoading: false });
      this.initWidget(data);
    },
    (data) => {
      this.logImpression('foo_fetch_error', data);
      Flash.error(I18n.t('offline_identity.foo_issue'));
    },
  );
}

action$.ofType(ActionTypes.SEARCHED_USERS)
  .map(action => action.payload.query)
  .filter(q => !!q)
  .switchMap(q =>
    Observable.timer(800) // debounce
      .takeUntil(action$.ofType(ActionTypes.CLEARED_SEARCH_RESULTS))
      .mergeMap(() =>
        Observable.merge(
          Observable.of(replace(`?q=${q}`)),
          ajax
            .getJSON(`https://api.github.com/search/users?q=${q}`)
            .map(res => res.items)
            .map(receiveUsers)
        )
      )
  );

window.FooClient
  .setVars({
    locale: getFooLocale({ page }),
    authorizationToken: data.token,
  })
  .initVerify('foo_container');

it('gets triggered by mouseenter', () => {
  const wrapper = shallow(<CalendarDay />);
  wrapper.dive().find(Button).prop();
});

const a1 = x.a(true).b(null).c(123)
const a2 = x.d('').e(``).f(g)
const a3 = x.d('').e(`${123}`).f(g)
const a4 = x.h(i.j).k(l()).m([n, o])
class X {
  y() {
    const j = x.a(this).b(super.cde()).f(/g/).h(new i()).j();
  }
}

// should break when call expressions get complex
x.a().b([c, [d, [e]]]).f()
x.a().b(c(d(e()))).f()
x.a().b(`${c(d())}`).f()

xyz.a().b().c(a(a(b(c(d().p).p).p).p))

var l = base
    .replace(/^\w*:\/\//, '')
    .replace(/\/$/, '')
    .split('/').length

