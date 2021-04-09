#!/bin/bash

rb_test_backend=${RB_TEST_BACKEND:-$2}

dropKeyspaces ( ) {
  if [ "$#" -eq 1 ]
  then
    PATTERN=$1
    echo "looking for keyspaces named '*$PATTERN*'..."
    for KEYSPACE in `echo 'describe keyspaces;' | cqlsh | grep ${PATTERN}`
    do
      echo dropping keyspace $KEYSPACE
      echo "drop keyspace if exists $KEYSPACE;" | cqlsh
    done
  fi
}

dropTables ( ) {
  if [ "$#" -eq 1 ]
  then
    DATABASE=$1
    echo "looking for database named '*$DATABASE*'..."
    echo 'begin;' | mysql -BD${DATABASE}
    for TABLE in `echo 'show tables;' | mysql -BD${DATABASE}`
    do
      echo dropping table $TABLE
      echo "drop table if exists $TABLE;" | mysql -BD${DATABASE}
    done
    echo 'commit;' | mysql -BD${DATABASE}
  fi
}

if [ "$rb_test_backend" = "cassandra" ]; then
  dropKeyspaces "local_group_test"
elif [ "$rb_test_backend" = "mysql" ]; then
  dropTables "test_db"
else
    echo "Invalid TEST_TARGET $rb_test_backend. Must me 'sqlite', 'cassandra' or 'mysql' if specified"
    exit 1
fi
