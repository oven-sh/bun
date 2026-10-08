import {interval} from 'rxjs/observable/interval';
import {filter} from 'rxjs/operator/filter';
import {take} from 'rxjs/operator/take';
import {map} from 'rxjs/operator/map';
import {throttle} from 'rxjs/operator/throttle';
import {takeUntil} from 'rxjs/operator/takeUntil';

function test(observable) {
    return observable
        ::filter(data => data.someTest)
        ::throttle(() =>
            interval(10)
                ::take(1)
                ::takeUntil(observable::filter(data => someOtherTest))
        )
        ::map(someFunction);
}
