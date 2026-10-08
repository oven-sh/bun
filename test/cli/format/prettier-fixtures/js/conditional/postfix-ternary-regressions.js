
// concatened string in consequent should be visually distinguishable from alternate
// … or maybe this is okay, because the colon is enough?
const avatar = has_ordered ?
    'https://marmelab.com/posters/avatar/longer-word-that-breaks-consequent-' +
    numberOfCustomers +
    '.jpeg'
  : undefined;

// Similarly, in the alternate:
const redirectUrl = pathName ?
    pathName
  : nextPathName + nextSearch ||
    defaultAuthParams.afterLoginUrl.makeThisLongerSoItBreaks;

// And another, more pathological case of the above:
const isEmpty = obj =>
  obj instanceof Date ?
    false
  : obj === '' ||
    obj === null ||
    obj === undefined ||
    obj === somethingThatIsLonger ||
    shallowEqual(obj, {});


// Again, this case is a bit hard to distinguish the alternate.
const eventsFromOrders =
  orderIds && orders ?
    orderIds.map(id => ({
        type: 'order',
        date: orders[id].date,
        data: orders[id],
    }))
  : [];

// Kinda weird to have dedents to the level of "return" in a function.
function foo() {
  return !linkTo ?
      false
    : typeof linkTo === 'function'
      ? linkTo(record, reference)
      : linkToRecord(rootPath, sourceId, linkTo_as_string);
}
function foo2() {
  return React.isValidElement(emptyText)
    ? React.cloneElement(emptyText)
    : emptyText === ''
      ? ' ' // em space, forces the display of an empty line of normal height
      : translate(emptyText, { _: emptyText });
}

// Function call ideally wouldnt break break
const matchingReferencesError = isMatchingReferencesError(
  matchingReferences
)
  ? translate(matchingReferences.error, {
      _: matchingReferences.error,
    })
  : null;

// This one is kinda confusing any way you slice it…
const obj = {
  error:
    matchingReferencesError &&
    (!input.value ||
      (input.value &&
        selectedReferencesDataStatus === REFERENCES_STATUS_EMPTY))
      ? translate('ra.input.references.all_missing', {
          _: 'ra.input.references.all_missing',
        })
      : null,
}

// I think we should indent after the inner || on this, and do better wtih the parens around the &&
const obj2 = {
  warning:
    matchingReferencesError ||
    (input.value && selectedReferencesDataStatus !== REFERENCES_STATUS_READY)
      ? matchingReferencesError ||
          translate('ra.input.references.many_missing', {
              _: 'ra.input.references.many_missing',
          })
      : null,
}

// The boolean conditions in the test should look cohesive.
const selectedReferencesDataStatus =
  !isEmpty(value) && typeof value === 'string' && !pattern.test(value)
      ? getMessage(message, { pattern }, value, values)
      : undefined


// Would be nice if these two nested ternaries didn't look like a single one.
resolveRedirectTo(
  redirectTo,
  basePath,
  payload
    ? payload.id || (payload.data ? payload.data.id : null)
    : requestPayload
      ? requestPayload.id
      : null,
  payload && payload.data
    ? payload.data
    : requestPayload && requestPayload.data
      ? requestPayload.data
      : null
)

const delayedDataProvider = new Proxy(restProvider, {
  get: (target, name, self) =>
      name === 'then' ? // as we await for the dataProvider, JS calls then on it. We must trap that call or else the dataProvider will be called with the then method
           self
          : (
          (resource, params) =>
              new Promise(resolve =>
                  setTimeout(
                      () =>
                          resolve(
                              restProvider[name](resource, params)
                          ),
                      500
                  )
              )
      ),
});

function foo4() {
  return !match || match.length < 5 ? line : (
    match[1] + match[2] + match[3] + match[4]
  )
}

function foo5() {
  return !match || match.length < 5 ? foo(line) : (
    match[1] + match[2] + match[3] + match[4]
  )
}

function foo6() {
  return !match || match.length < 5 ? linethatisverylongandbreaksthelinehooray : (
    match[1] + match[2] + match[3] + match[4]
  )
}

function foo7() {
  return !match || match.length < 5 ? linethatisverylongandbreaksthelinehoorayjustabitlonger : (
    match[1] + match[2] + match[3] + match[4]
  )
}

const badComments =
  schema.model ? schema
    // If model is an array where the items schema is a referred model then we need to use that
  : schema.type === 'array' ? schema.items
  : schema;

const anotherBadComment =
  refModel ?
    // If we're in a shared params file then reference the model name directly
    inSharedParamsFile ? refModel
      // If we're not in a shared params file then reference the in-file type
    : classRef()
    // We don't have a model name, use the in-file name
  : classRef()
