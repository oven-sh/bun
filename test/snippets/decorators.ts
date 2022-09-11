@first
class HelloDecorators {
    x: number;
    y: number;

    constructor(){
        this.x = 4;
        this.y = 3;
    }

    @second
    move(newX: number, newY: number){
        this.x = newX;
        this.y = newY;
    }

    noDecorator(){
        console.log("noDecorator() called");
    }
}


function first(constructor) {
    console.log("first() decorator called");
}

function second(second) {
    console.log("second() decorator called");
}

export function test() {
    let test = new HelloDecorators();
    let test2 = new HelloDecorators();
    console.log("class: ", test.x, test.y);

    return testDone(import.meta.url);
}