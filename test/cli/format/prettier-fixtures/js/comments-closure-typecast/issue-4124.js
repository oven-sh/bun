/** @type {Object} */(myObject.property).someProp = true;
(/** @type {Object} */(myObject.property)).someProp = true;

const prop = /** @type {Object} */(myObject.property).someProp;

const test = /** @type (function (*): ?|undefined) */
      (goog.partial(NewThing.onTemplateChange, rationaleField, typeField));

const foo1 = /** @type (function (*): ?|undefined) */ (goog.partial(NewThing.onTemplateChange, rationaleField, typeField));

const model = /** @type {?{getIndex: Function}} */ (model);

const foo = /** @type {string} */
  (bar);

const foo2 = /** @type (function (*): ?|undefined) */ (foo);
