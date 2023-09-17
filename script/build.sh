#!/bin/bash

set -e

copyfiles -u 1 src/**/*.js dist/

tsc
