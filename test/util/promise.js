'use strict';

module.exports = function() {

    Promise.prototype.fails = function(onRejected) {
        var failed = false;
        function trackFailure(e) {
            //console.log(e);
            failed = true;
            return onRejected(e);
        }
        function check(x) {
            if (!failed) {
                throw new Error('expected error was not thrown');
            } else {
                return this;
            }
        }
        return this.catch(trackFailure).then(check);
    };
};
