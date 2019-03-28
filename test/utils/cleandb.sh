#!/bin/bash

CASSANDRA_HOST=${CASSANDRA_HOST:-localhost}

dropKeyspaces ( ) {
  if [ "$#" -eq 1 ]
  then
    PATTERN=$1
    echo "looking for keyspaces named '*$PATTERN*'..."
    for KEYSPACE in `echo 'describe keyspaces;' | cqlsh ${CASSANDRA_HOST} | grep $PATTERN`
    do
      echo dropping keyspace $KEYSPACE
      echo "drop keyspace if exists $KEYSPACE;" | cqlsh ${CASSANDRA_HOST}
    done
  fi
}

dropKeyspaces "local_group_test"
