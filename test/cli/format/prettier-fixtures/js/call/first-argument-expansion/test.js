setTimeout(function() {
  thing();
}, 500);

["a","b","c"].reduce(function(item, thing) {
  return thing + " " + item;
}, "letters:")

func(() => {
  thing();
}, identifier);

func(function() {
  thing();
}, this.props.timeout * 1000);

func((that) => {
  thing();
}, this.props.getTimeout());

func(() => {
  thing();
}, true);

func(() => {
  thing();
}, null);

func(() => {
  thing();
}, undefined);

func(() => {
  thing();
}, /regex.*?/);

func(() => {
  thing();
}, 1 ? 2 : 3);

func(function() {
  return thing()
}, 1 ? 2 : 3);

func(() => {
  thing();
}, something() ? someOtherThing() : somethingElse(true, 0));


func(() => {
  thing();
}, something(longArgumentName, anotherLongArgumentName) ? someOtherThing() : somethingElse(true, 0));


func(() => {
  thing();
}, something(longArgumentName, anotherLongArgumentName, anotherLongArgumentName, anotherLongArgumentName) ? someOtherThing() : somethingElse(true, 0));

compose((a) => {
  return a.thing;
}, b => b * b);

somthing.reduce(function(item, thing) {
  return thing.blah =  item;
}, {})

somthing.reduce(function(item, thing) {
  return thing.push(item);
}, [])

reallyLongLongLongLongLongLongLongLongLongLongLongLongLongLongMethod((f, g, h) => {
  return f.pop();
}, true);

// Don't do the rest of these

func(function() {
  thing();
}, true, false);

func(() => {
  thing();
}, {yes: true, cats: 5});

compose((a) => {
  return a.thing;
}, b => {
  return b + "";
});

compose((a) => {
  return a.thing;
}, b => [1, 2, 3, 4, 5]);

renderThing(a =>
  <div>Content. So much to say. Oh my. Are we done yet?</div>
,args);

setTimeout(
  // Something
  function() {
    thing();
  },
  500
);

setTimeout(/* blip */ function() {
  thing();
}, 500);

func((args) => {
  execute(args);
}, result => result && console.log("success"))
