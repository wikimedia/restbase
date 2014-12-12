#!/bin/bash

dropKeyspaces ( ) {
  if [ "$#" -eq 1 ]
  then
    PATTERN=$1
    echo "looking for keyspaces named '*$PATTERN*'..."
    for KEYSPACE in `echo 'select keyspace_name from system.schema_keyspaces;' | cqlsh | grep $PATTERN`
    do
      echo dropping keyspace $KEYSPACE
      echo "drop keyspace if exists \"$KEYSPACE\";" | cqlsh
    done
  fi
}

dropKeyspaces "local_restbase"
dropKeyspaces "local_test"
