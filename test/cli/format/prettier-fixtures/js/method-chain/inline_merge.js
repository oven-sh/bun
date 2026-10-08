Object.keys(
  availableLocales({
    test: true
  })
)
.forEach(locale => {
  // ...
});

this.layoutPartsToHide = this.utils.hashset(
	_.flatMap(this.visibilityHandlers, fn => fn())
		.concat(this.record.resolved_legacy_visrules)
		.filter(Boolean)
);

var jqxhr = $.ajax("example.php")
  .done(doneFn)
  .fail(failFn);
