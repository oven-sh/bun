class Foo {
    /** Does this key match a given MinimalKey extending object? */
    match(keyevent) {
<<<PRETTIER_RANGE_START>>>        // 'in' doesn't include prototypes, so it's safe for this object.
        for (let attr in this) {
            if (this[attr] !== keyevent[attr]) return false
        }
        return true
    }<<<PRETTIER_RANGE_END>>>
}
