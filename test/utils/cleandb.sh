#!/bin/bash

dropKeyspaces ( ) {
  if [ "$#" -eq 1 ]
  then
    PATTERN=$1
    echo "looking for keyspaces named '*$PATTERN*'..."
    for KEYSPACE in `echo 'describe keyspaces;' | cqlsh`
    do
      echo dropping keyspace $KEYSPACE
      echo "drop keyspace if exists $KEYSPACE;" | cqlsh
    done
  fi
}

dropKeyspaces "local_group_test"
