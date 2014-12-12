#!/bin/sh
ruby -ryaml -rjson -e 'puts JSON.pretty_generate(YAML.load(ARGF))' < swagger.yaml > swagger.json
