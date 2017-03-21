#!/bin/bash

set -euo pipefail

sh test/utils/run_tests.sh coverage all && (npm run-script coveralls || exit 0)
sonar-scanner

export DEPLOY_PULL_REQUEST=true
