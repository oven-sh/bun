module m2 {
    function fn() {
        return 1;
    }
    export function exports() {
        return 1;
    }
    export function require() {
        return "require";
    }
}

module m2 {

    export function exports() {
        return 1;
    }

    export function require() {
        return "require";
    }
}
