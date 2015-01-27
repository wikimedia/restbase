#!/bin/sh

pandoc -s -f markdown -t slidy -o index.html README.md
