#!/bin/sh

mkdir -p $TYPEDAEMON_CONFIG

if [ -z "$(ls -A $TYPEDAEMON_CONFIG)" ]; then
   td init "$TYPEDAEMON_CONFIG"
else
   td dev_env --fast
fi

exec td run
