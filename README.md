<p align="center">
<img src="./rustplusplus.png" width="500"></a>
</p>

<p align="center">
<a href="https://discord.gg/vcrKbKVAbc"><img src="https://img.shields.io/badge/Discord-Alexemanuel-%237289DA?style=flat&logo=discord" alt="discord"/></a>
<a href="https://www.reddit.com/user/Alexemanuelol"><img src="https://img.shields.io/badge/Reddit-Alexemanuelol-FF4500?style=flat&logo=reddit" alt="reddit"/></a>
<a href="https://ko-fi.com/alexemanuelol"><img src="https://img.shields.io/badge/Donate%20a%20Coffee-alexemanuelol-yellow?style=flat&logo=buy-me-a-coffee" alt="donate on ko-fi"/></a>

<p align="center">
<a href="https://crowdin.com/project/rustplusplus"><img src="https://badges.crowdin.net/rustplusplus/localized.svg" alt="donate on ko-fi"/></a>
</p>

<p align="center">
    <a href="https://discord.gg/vcrKbKVAbc">
        <img src="./join_discord.png" width="250">
    </a>
</p>

<h1 align="center"><em><b>rustplusplus</b> ~ Rust+ Discord Bot</em></h1>
</p>

A NodeJS Discord Bot that uses the [rustplus.js](https://github.com/liamcottle/rustplus.js) library to utilize the power of the [Rust+ Companion App](https://rust.facepunch.com/companion) with additional Quality-of-Life features.

## **Versions during development**

- NodeJS v22.13.1
- NPM 10.9.2


## **How-to Setup Video**

[![Image of setup video](https://www.youtube.com/s/desktop/4a88d8c6/img/favicon_144x144.png)](https://youtu.be/GX03brJiMZg)

## **Features**

* Receive notifications for [In-Game Events](docs/discord_text_channels.md#events-channel) (Patrol Helicopter, Cargo Ship, Chinook 47, Oil Rigs triggered).
* Control [Smart Switches](docs/smart_devices.md#smart-switches) or Groups of Smart Switches via Discord or In-Game Team Chat.
* Setup [Smart Alarms](docs/smart_devices.md#smart-alarms) to notify in Discord or In-Game Team Chat whenever they are triggered.
* Use [Storage Monitors](docs/smart_devices.md#storage-monitors) to keep track of Tool Cupboard Upkeep or Large Wooden Box/Vending Machine content.
* Head over to the [Information Text Channel](docs/images/information_channel.png) to see all sorts of information about the server, ongoing events and team member status.
* Communicate with teammates from [Discord to In-Game](docs/discord_text_channels.md#teamchat-channel) and vice versa.
* Keep track of other teams on the server with the [Battlemetrics Player Tracker](docs/discord_text_channels.md#trackers-channel).
* Alot of [QoL Commands](docs/commands.md) that can be used In-Game or from Discord.
* View the [Full list of features](docs/full_list_features.md).


## **Documentation**

> Documentation can be found [here](docs/documentation.md). The documentation explains the features as well as `how to setup the bot`, so make sure to take a look at it 😉

## **Credentials**

> You can get your credentials by running the `rustplusplus credential application`. Download it [here](https://github.com/alexemanuelol/rustplusplus-credential-application/releases/download/v1.4.0/rustplusplus-1.4.0-win-x64.exe)


## **How to run the bot**

Use Node.js 22.13 or later in the 22.x series. Configure the Discord client ID and token as described in the [setup guide](docs/discord_bot_setup.md).

```sh
npm ci
npm run build
npm start
```

On first start, the bot creates a project-root `.env` if Discord credentials are missing. Fill in `RPP_DISCORD_CLIENT_ID` and `RPP_DISCORD_TOKEN`, save the file and run the same start command again. Deployments that supply both values through the process environment can start directly.

The build type-checks and compiles the bot and its local Rust+ library, then copies the runtime assets. Production starts directly from `dist/index.js`. For development, run `npm run dev` to start from TypeScript. Credentials, guild instances, logs and maps are stored in the project root in both modes.

## **How to update the repository**

```sh
git pull --ff-only
npm ci
npm run build
npm start
```

## **Running via Docker**

Set the Discord credentials in the Compose environment and build the local image.

```sh
docker compose up -d --build
```

## **Thanks to**

**liamcottle**@GitHub - for the [rustplus.js](https://github.com/liamcottle/rustplus.js) library.
<br>
**.Vegas.#4844**@Discord - for the awesome icons!
