#!/bin/bash

runTest ( ) {
    if [ "$1" = "sqlite" ]
    then
        echo "Running with SQLite backend"
        export RB_TEST_BACKEND=sqlite
        rm -f restbase
    else
        echo "Running with Cassandra backend"
         export RB_TEST_BACKEND=cassandra
        sh ./test/utils/cleandb.sh
    fi

    if [ "$2" = "test" ]
    then
        mocha
    fi

    if [ "$2" = "coverage" ]
    then
        istanbul cover _mocha -- -R spec
    fi
}

if [ -z ${2+x} ]
then
    # no concrete backend is provided, check for cassandra
    `echo exit;` | cqlsh
    if [ "$?" -eq 0 ]
    then
        runTest "cassandra" $1
    else
        echo "Cassandra not available. Using SQLite backed for tests"
        runTest "sqlite" $1
    fi
fi

if [ "$2" = "sqlite" ]
then
    runTest "sqlite" $1
fi

if [ "$2" = "cassandra" ]
then
    runTest "cassandra" $1
fi

if [ "$2" = "all" ]
then
    runTest "sqlite" $1
    runTest "cassandra" $1
fi
