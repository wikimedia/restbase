#!/usr/bin/env node

'use strict';

// B/C wrapper to make the old init script work with service-runner.
const ServiceRunner = require('service-runner');
new ServiceRunner().start();
