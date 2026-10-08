require(
    [
        'jquery',
        'common/global.context',
        'common/log.event',
        'some_project/square',
        'some_project/rectangle',
        'some_project/triangle',
        'some_project/circle',
        'some_project/star',
    ],
    function($, Context, EventLogger, Square, Rectangle, Triangle, Circle, Star) {

        console.log('some code')
    }
);

define(
    [
        'jquery',
        'common/global.context',
        'common/log.event',
        'some_project/square',
        'some_project/rectangle',
        'some_project/triangle',
        'some_project/circle',
        'some_project/star',
    ],
    function($, Context, EventLogger, Square, Rectangle, Triangle, Circle, Star) {

        console.log('some code')
    }
);
