// https://github.com/meriyah/meriyah/issues/164

function get() {}

function* getData() {
    return yield get();
}
