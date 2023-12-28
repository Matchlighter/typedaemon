#!/usr/bin/env python3
import re
import os
import argparse
import datetime
import json

CHANNEL_DEV = "dev"
CHANNEL_BETA = "beta"
CHANNEL_RELEASE = "release"

parser = argparse.ArgumentParser()
parser.add_argument(
    "--suffix",
    type=str,
    required=False,
    help="The suffix of the tag.",
)


def main():
    args = parser.parse_args()

    channel = CHANNEL_DEV
    version = ""
    major_minor_version = None
    tags_to_push = []
    if os.environ.get("GITHUB_EVENT_NAME", None) == "release":
        version = os.environ.get("GITHUB_REF").replace("refs/tags/", "")
        tags_to_push.append(version)

        # detect channel from tag
        match = re.match(r"^(\d+\.\d+)(?:\.\d+)?(b\d+)?$", version)
        major_minor_version = None
        if match is None:
            channel = CHANNEL_DEV
        elif match.group(2) is None:
            major_minor_version = match.group(1)
            channel = CHANNEL_RELEASE
        else:
            channel = CHANNEL_BETA
    else:
        branch = os.environ.get("GITHUB_REF", "arbitrary").replace("refs/heads/", "")
        sha = os.environ.get("GITHUB_SHA", "")
        datecode = datetime.datetime.now().isoformat()
        version = f"{branch}-{sha}-{datecode}"
        if branch == "master":
            tags_to_push.append("edge")
        else:
            tags_to_push.append(f"branch-{branch}")

    if channel == CHANNEL_BETA:
        tags_to_push.append("beta")
    elif channel == CHANNEL_RELEASE:
        # Additionally push to beta
        tags_to_push.append("beta")
        tags_to_push.append("latest")

        if major_minor_version:
            tags_to_push.append("stable")
            tags_to_push.append(major_minor_version)

    suffix = f"-{args.suffix}" if args.suffix else ""

    with open(os.environ["GITHUB_OUTPUT"], "w") as f:
        print(f"version={version}", file=f)
        print(f"channel={channel}", file=f)
        print(f"image=matchlighter/typedaemon{suffix}", file=f)
        full_tags = []

        for tag in tags_to_push:
            full_tags += [f"ghcr.io/matchlighter/typedaemon{suffix}:{tag}"]
            # full_tags += [f"matchlighter/typedaemon{suffix}:{tag}"]
        print(f"tags={','.join(full_tags)}", file=f)


if __name__ == "__main__":
    main()
