#!/bin/sh
#
# This is a simple server for local testing.
#
# USAGE
#
# In restbase/test/simple.js, set specUrl to
# 'http://localhost:8000/v1/swagger.yaml'

python -m SimpleHTTPServer 8000
