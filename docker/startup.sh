#!/bin/sh

mkdir -p $TYPEDAEMON_CONFIG

if [ -z "$(ls -A $TYPEDAEMON_CONFIG)" ]; then
   td init "$TYPEDAEMON_CONFIG"
fi

td run
