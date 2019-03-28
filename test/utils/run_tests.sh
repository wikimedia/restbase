#!/bin/sh

mod_dir=$( cd "$( dirname "$0" )"/../.. && pwd )/node_modules
mocha="$mod_dir"/mocha/bin/mocha
nyc="$mod_dir"/.bin/nyc
CASSANDRA_HOST=${CASSANDRA_HOST:-localhost}

runTest ( ) {
    if [ "$1" = "cassandra" ]; then
        echo "Running with Cassandra backend"
        if [ `nc -z ${CASSANDRA_HOST} 9042 < /dev/null; echo $?` != 0 ]; then
          echo "Waiting for Cassandra to start..."
          while [ `nc -z ${CASSANDRA_HOST} 9042; echo $?` != 0 ]; do
            sleep 1
          done
          echo "Cassandra is ready."
        fi
        export RB_TEST_BACKEND=cassandra
        sh ./test/utils/cleandb.sh local_group_test
    else
        echo "Running with SQLite backend"
        export RB_TEST_BACKEND=sqlite
        rm -f test.db.sqlite3
    fi

    if [ "$2" = "test" ]; then
        "${mocha}"
    elif [ "$2" = "coverage" ]; then
        "${nyc}" --reporter=lcov node_modules/.bin/_mocha
    fi
}

if [ "x$2" = "x" ]; then
    # no concrete backend is provided, check for cassandra
    `echo exit;` | cqlsh 2> /dev/null
    if [ "$?" -eq 0 ]; then
        runTest "cassandra" $1
    else
        echo "Cassandra not available. Using SQLite backend for tests"
        runTest "sqlite" $1
    fi
elif [ "$2" = "sqlite" ]; then
    runTest "sqlite" $1
elif [ "$2" = "cassandra" ]; then
    runTest "cassandra" $1
elif [ "$2" = "all" ]; then
    runTest "cassandra" $1
    cassandra_result=$?
    runTest "sqlite" $1
    sqlite_result=$?
    exit $(($cassandra_result + $sqlite_result))
else
    echo "Invalid testing mode"
    exit 1
fi
