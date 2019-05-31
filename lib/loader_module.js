'const strict';

module.exports = (spec, options) => {
    options = options || {};
    spec = spec || {};
    spec.paths = spec.paths || {};
    if (options.exclude) {
        if (!Array.isArray(options.exclude)) {
            options.exclude = options.exclude.split(',');
        }
        options.exclude.forEach((module) => {
            module = /^\//.test(module) ? module : `/${module}`;
            if (spec.paths[module]) {
                delete spec.paths[module];
            }
        });
    }
    return {
        spec,
        operations: {},
        globals: { options }
    };
};
