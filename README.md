# TypeDaemon

Typescript-based application environment for Home Assistant. Similar in principle to AppDaemon, but swaps Python for Javascript/Typescript.

Aims to "include the batteries", providing simple, clean APIs for writing automations.

TypeDaemon is still a work in progress. It works to do what I do in my production Home Assistant and has been stable, but it is still beta software - there are probably bugs and things may change.

## Installation

### Hassio (Recommended)
1. Add the https://github.com/Matchlighter/typedaemon-hassio repository by:
    1. Navigating to Home Assistant Settings > Addons > Add-on Store
    2. Access the kebab menu in the upper right, and select "Repositories"
    3. Paste `https://github.com/Matchlighter/typedaemon-hassio` in the "Add" field, then click "ADD".
2. Reload the page
3. Find the TypeDaemon section and select the TypeDaemon addon
4. Install it

### Docker/Compose
Installation outside of Hassio is technically possible, but I've chosen not to allocate time figuring it out and writing docs. If you're going to go this direction, you should have an intermediate understanding of Linux and Docker, and be willing to spend some time digging and throwing stuff at the wall.

I'm happy to entertain a PR that fills in this section more.

## Getting Started

Upon startup, TypeDaemon will create a template configuration (at `/config/typedaemon` for Hassio, or in the directory mounted to `/config` for Docker/Compose).

Presently, the only API documentation that TypeDaemon provides is via Typescript and JSDoc comments, so it is highly recommended to use VS Code / Studio Code Server when writing TypeDaemon apps. All APIs and utilities provided by TypeDaemon can be imported from `@td`. Check out the example app templates to get a feel for things.

### CLI Basics
TypeDaemon has a simple CLI for doing some basic tasks. For Hassio installs, you can run `./td --help` from the `typedaemon` config directory.

TypeDaemon runs completely in Docker, but apps/config are expected to be edited outside of Docker. This split would normally require you to be highly aware of where you're executing commands, with some commands only working if you properly enter the Docker container before execution. The TypeDaemon CLI tries to simplify this and work some magic to automatically enter the container and map paths when necessarry.

You can execute an arbitrary command in-container with `./td exec CMD`. You can easily gain an in-container shell with `./td shell`.

### Syncing the Dev Environment
TypeDaemon tries to abstract the need for you to learn how JS packaging and NPM work. It does this by generating the appropriate configs and automagically downloading appropriate typings and support files.
This process is triggered via the `td dev_env` command. 

## Where thar be Dragons

### Using the edge/dev Version

The TypeDaemon edge/dev addon does not auto-update. To pull the latest version, run `docker pull ghcr.io/matchlighter/typedaemon:edge` and restart the addon. The edge image is built from the latest code pushed to the `master` branch of this repo.

## LICENSE
Currently licensed under the terms of the AGPLv3. This is mostly due to the `@resumable` stuff, which I consider to be pretty neat tech, so I want to keep it under my control. If you're using this project personally, you probably don't need to worry much about this. If you're using it (or parts of it) commercially, the AGPLv3 is to apply in full and requires any derivative works to be released under the same license.
