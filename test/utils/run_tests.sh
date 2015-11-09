#!/bin/sh

mod_dir=$( cd "$( dirname "$0" )"/../.. && pwd )/node_modules
mocha="$mod_dir"/mocha/bin/mocha
istanbul="$mod_dir"/istanbul/lib/cli.js

runTest ( ) {
    if [ "$1" = "sqlite" ]; then
        echo "Running with SQLite backend"
        export RB_TEST_BACKEND=sqlite
        rm -f test.db.sqlite3
    else
        echo "Running with Cassandra backend"
        echo "Cassandra version: `/usr/local/cassandra/bin/cassandra -v`"
        export RB_TEST_BACKEND=cassandra
        sh ./test/utils/cleandb.sh
    fi

    if [ "$2" = "test" ]; then
        "${mocha}"
    elif [ "$2" = "coverage" ]; then
        "${istanbul}" cover node_modules/.bin/_mocha -- -R spec
    fi
}

if [ "x$2" = "x" ]; then
    # no concrete backend is provided, check for cassandra
    `echo exit;` | cqlsh 2> /dev/null
    if [ "$?" -eq 0 ]; then
        runTest "cassandra" $1
    else
        echo "Cassandra not available. Using SQLite backed for tests"
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
