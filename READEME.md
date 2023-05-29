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
