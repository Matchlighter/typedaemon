# TypeDaemon

Typescript-based application environment for Home Assistant. Similar in principle to AppDAemon, but swaps Python for Javascript/Typescript.

Aims to "include the batteries", providing simple, clean APIs for writing automations.

## Installation

Recommended installation is via Hassio:

1. Add the https://github.com/Matchlighter/typedaemon-hassio repository by:
    1. Navigating to Home Assistant Settings > Addons > Add-on Store
    2. Access the kebab menu in the upper right, and select "Repositories"
    3. Paste `https://github.com/Matchlighter/typedaemon-hassio` in the "Add" field, then click "ADD".
2. Reload the page
3. Find the TypeDaemon section and select the TypeDaemon addon
4. Install it

## Getting Started

Upon startup, TypeDaemon will create a template configuration (at `/config/typedaemon` for Hassio, or in the directory mounted to `/config` for Docker/Compose).

### CLI Basics
TypeDaemon has a smiple CLI for doing some basic tasks. Execution will very depending on installation method, but for Hassio installs, you can run `bin/td` from the `typedaemon` config directory.

### Syncing the Dev Environment
TypeDaemon tries to abstract the need for you to learn how JS packaging and NPM work. It does this by generating the appropriate configs and automagically downloading appropriate typings and support files.
This process is triggered via the `td dev_env` command. 

## LICENSE
Currently licensed under the terms of the AGPLv3. This is mostly due to the `@resumable` stuff, which I consider to be pretty neat tech, so I want to keep it under my control. If you're using this project personally, you probably don't need to worry much about this. If you're using it (or parts of it) commercially, the AGPLv3 is to apply in full and requires any derivative works to be released under the same license.
