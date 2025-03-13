#!/bin/sh

mkdir -p $TYPEDAEMON_CONFIG

td init --automated "$TYPEDAEMON_CONFIG"
td dev_env --fast

exec td run
