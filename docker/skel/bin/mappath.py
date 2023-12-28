#!/bin/python3

import os
import sys

if __name__ == "__main__":
    root_dir = sys.argv[1]
    tdir = sys.argv[2]
    print(os.path.relpath(tdir, root_dir))
