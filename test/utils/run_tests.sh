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
        if [ `nc localhost 9042 < /dev/null; echo $?` != 0 ]; then
          sh ../apache-cassandra-3.11.0/bin/cassandra 1> logs1 2> logs2
          echo "Waiting for Cassandra to start..."
          while [ `nc -z localhost 9042; echo $?` != 0 ]; do
            cat logs1
            cat logs2
            sleep 10
          done
          echo "Cassandra is ready."
        fi
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
