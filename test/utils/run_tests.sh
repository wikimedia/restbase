#!/bin/sh

mod_dir=$( cd "$( dirname "$0" )"/../.. && pwd )/node_modules
mocha="${mod_dir}"/mocha/bin/mocha
nyc="${mod_dir}"/.bin/nyc
test_target=${TEST_TARGET:-$2}
test_mode=${TEST_MODE:=$3}

if [ "$1" = "test" ]; then
    test_command="${mocha}"
elif [ "$1" = "coverage" ]; then
    test_command="${nyc} --reporter=lcov node_modules/.bin/_mocha"
else
    echo "Invalid test command. Must be 'test' or 'coverage"
    exit 1
fi

if [ "x$test_target" = "x" ] || [ "$test_target" = "sqlite" ]; then
    echo "Running with SQLite backend"
    rm -f test.db.sqlite3
elif [ "$test_target" = "cassandra" ]; then
    echo "Running with Cassandra backend"
    if [ `nc -z localhost 9042 < /dev/null; echo $?` != 0 ]; then
      echo "Waiting for Cassandra to start..."
      while [ `nc -z localhost 9042; echo $?` != 0 ]; do
        sleep 1
      done
      echo "Cassandra is ready."
    fi
    export RB_TEST_BACKEND=cassandra
    sh ./test/utils/cleandb.sh local_group_test
else
    echo "Invalid TEST_TARGET ${test_target}. Must me 'sqlite' or 'cassandra' if specified"
    exit 1
fi

echo "Running ${test_mode} mode"
${test_command};
exit $?;
