#!/bin/sh

if [ -z "$(ls -A $TYPEDAEMON_CONFIG)" ]; then
   td init "$TYPEDAEMON_CONFIG"
fi

td run
