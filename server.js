"use strict";

// B/C wrapper to make the old init script work with service-runner.
var ServiceRunner = require('service-runner');
new ServiceRunner().run();
