This repository is a modified version of Terria for ASDC. Contents of the ./mods folder contains the external changes. It contains the terria-server file which contains a server that includes endpoints for webODM files as well as the public catalogs in the application. The rest of the files are for terriajs module which are overwritten in ./index.js file. The rest of the changes have been mainly in the ./lib folder. There is also a copy of the catalog file in ./wwwroot/init/asdc_terria.json.

Terria Map
==========

# We have deprecated TerriaJS v7
What this means:
- [Our new main branch of TerriaMap](https://github.com/TerriaJS/TerriaMap/tree/main) now uses v8+ of TerriaJS
- [The terriajs7 branch of TerriaMap](https://github.com/TerriaJS/TerriaMap/tree/terriajs7) will use v7 TerriaJS
- We have a [migration guide](https://docs.terria.io/guide/contributing/migration-guide/) available for users of TerriaJS v7 to help them upgrade their applications to TerriaJS v8
- Please chat to us and the community in our [GitHub discussions forum](https://github.com/TerriaJS/terriajs/discussions)

-------------------

[![Build Status](https://github.com/TerriaJS/TerriaMap/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/TerriaJS/TerriaMap/actions/workflows/ci.yml) [![Docs](https://img.shields.io/badge/docs-online-blue.svg)](https://docs.terria.io/)

![Terria logo](terria-logo.png "Terria logo")

This is a complete website built using the TerriaJS library. See the [TerriaJS README](https://github.com/TerriaJS/TerriaJS) for information about TerriaJS, and getting started using this repository.



For instructions on how to deploy your map, see [the documentation here](doc/deploying/deploying-to-aws.md).
