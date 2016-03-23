#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

rm -f uri_dump;

# Enable logging in config
sed -i.bak 's/dump_test_uris:\ false/dump_test_uris:\ true/' config.test.yaml

# Run tests
sh $DIR/run_tests.sh test sqlite

# Remove duplicates
sort -u -o uri_dump.tmp uri_dump; mv uri_dump.tmp uri_dump

# Delete URIs exposed only for tests
sed -i.bak '/\/buckets\//d' uri_dump
sed -i.bak '/foobar\.com/d' uri_dump
sed -i.bak '/^\/$/d' uri_dump
sed -i.bak '/fr\.wikipedia\.org/d' uri_dump
sed -i.bak '/test\.wikipedia\.org/d' uri_dump
sed -i.bak '/test2\.wikipedia\.org/d' uri_dump
sed -i.bak '/User:Pchelolo\/Access_Check_Tests/d' uri_dump

# Rewrite to the /api/rest_v1/ form
sed -i.bak 's/^\/\([[:alnum:]\.]*\)\/v1/https:\/\/\1\/api\/rest_v1/' uri_dump

# Report and clean up.
echo "Collected uris: `cat uri_dump | wc -l`"
echo "The list of URIs could be found in 'uri_dump' file"
sed -i.bak 's/dump_test_uris:\ true/dump_test_uris:\ false/' config.test.yaml
rm -f config.test.yaml.bak uri_dump.bak