#!/bin/sh

mod_dir=$( cd "$( dirname "$0" )"/../.. && pwd )/node_modules
mocha="${mod_dir}"/mocha/bin/mocha
nyc="${mod_dir}"/.bin/nyc
test_target=${TEST_TARGET:-$2}
test_mode=${TEST_MODE:-$3}
if [ "x$test_mode" = "x" ]; then
    test_mode="fs"
fi
export TEST_MODE=${test_mode}

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
    export RB_SQLITE_FILE=`mktemp -t sqlite.XXXXXXXXXX`
    echo "Saving SQLite DB to ${RB_SQLITE_FILE}"
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
    export RB_TEST_BACKEND_USERNAME=cassandra
    export RB_TEST_BACKEND_PASSWORD=cassandra
    sh ./test/utils/cleandb.sh local_group_test
elif [ "$test_target" = "mysql" ]; then
    echo "Running with MySQL backend"
    if [ `nc -z localhost 3306 < /dev/null; echo $?` != 0 ]; then
      echo "Waiting for MySQL to start..."
      while [ `nc -z localhost 3306; echo $?` != 0 ]; do
        sleep 1
      done
      echo "MySQL is ready."
    fi
    export RB_TEST_BACKEND=mysql
    export RB_TEST_BACKEND_USERNAME=mysql
    export RB_TEST_BACKEND_PASSWORD=mysql
    sh ./test/utils/cleandb.sh local_group_test
else
    echo "Invalid TEST_TARGET $test_target. Must me 'sqlite', 'cassandra' or 'mysql' if specified"
    exit 1
fi

echo "Running $test_mode mode"
${test_command};
exit $?;
