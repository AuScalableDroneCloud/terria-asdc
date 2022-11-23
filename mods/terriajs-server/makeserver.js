/* jshint node: true */
'use strict';

var express = require('express');
var compression = require('compression');
var path = require('path');
var cors = require('cors');
var exists = require('terriajs-server/lib/exists');
var basicAuth = require('basic-auth');
var fs = require('fs');
var ExpressBrute = require('express-brute');
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const Cesium = require("cesium");
Cesium.Ion.defaultAccessToken =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI1NWZkNGFlZS1iNzVhLTRmNTAtOThmYi1kMTI1MjlmOTVlNjciLCJpZCI6NzIyNTQsImlhdCI6MTYzNTkwNDI4OX0.EXVvJZa8yaugMmQNkc9pjWfrjqeOpZ8Jg7_0Hdwnb1A";
const JSON5 = require("json5")

if (!process.env.baseURL) {
    const dotenv = require("dotenv");
    dotenv.config();
}
const baseURL = process.env.baseURL ?? "https://asdc.cloud.edu.au";

/* Creates and returns a single express server. */
module.exports = function (options) {
    function endpoint(path, router) {
        if (options.verbose) {
            console.log('http://' + options.hostName + ':' + options.port + '/api/v1' + path, true);
        }
        if (path !== 'proxyabledomains') {
            // deprecated endpoint that isn't part of V1
            app.use('/api/v1' + path, router);
        }
        // deprecated endpoint at `/`
        app.use(path, router);
    }

    // eventually this mime type configuration will need to change
    // https://github.com/visionmedia/send/commit/d2cb54658ce65948b0ed6e5fb5de69d022bef941
    var mime = express.static.mime;
    mime.define({
        'application/json': ['czml', 'json', 'geojson'],
        'text/plain': ['glsl']
    });

    // initialise app with standard middlewares
    var app = express();
    app.use(compression());
    app.use(cors());
    app.disable('etag');
    if (options.verbose) {
        app.use(require('morgan')('dev'));
    }

    app.get("/test", (req, res) => {
        res.send("test");
    })

    //WebODM endpoints
    app.get("/terriaCatalog/projects", (req, res) => {
        var catalog = [];
        fetch(`${baseURL}/api/projects/?ordering=-created_at`, {
            headers: { Cookie: req.headers.cookie },
        })
            .then((response) => {
                if (response.status === 200) {
                    return response.json();
                }
            })
            .then((odmProjects) => {
                if (!odmProjects) {
                    res.status(404).json("No projects were found");
                    return;
                }
                if (Array.isArray(odmProjects)) {
                    odmProjects.map((project, projectIndex) => {
                        var projectMember = {
                            type: "terria-reference",
                            name: project.name,
                            isGroup: true,
                            url: `/terriaCatalog/projects/${project.id}`,
                            itemProperties: {
                                permissions: project.permissions,
                            },
                        };
                        catalog.push(projectMember);
                    });

                    res.status(200).json({ catalog: catalog });
                }
            })
            .catch((e) => {
                res
                    .status(500)
                    .json(
                        "An error occurred while getting projects from webODM: " + e.code
                    );
            });
    });

    app.get("/terriaCatalog/projects/:projectId", (req, res) => {
        var project = req.params.projectId;

        var catalog = [];

        fetch(`${baseURL}/api/projects/${project}/tasks/?ordering=-created_at`, {
            headers: { Cookie: req.headers.cookie },
        })
            .then((response) => {
                if (response.status === 200) {
                    return response.json();
                }
            })
            .then((odmTasks) => {
                odmTasks.map((task) => {
                    if (task.available_assets.length > 0) {
                        var taskMember = {
                            type: "terria-reference",
                            name: task.name,
                            isGroup: true,
                            url: `/terriaCatalog/projects/${project}/tasks/${task.id}`,
                        };
                        catalog.push(taskMember);
                    }
                });

                res.status(200).json({ catalog: catalog });
            })
            .catch(() => {
                res
                    .status(500)
                    .json("An error occurred while getting tasks from webODM");
            });
    });

    app.get(
        "/terriaCatalog/projects/:projectId/tasks/:taskId",
        (req, res) => {
            var projectId = req.params.projectId;
            var taskId = req.params.taskId;

            var catalog = [];
            var metaDataPromises = [];

            var url = new URL(baseURL);
            const eptServer = `${url.protocol}//ept.${url.host}`;

            fetch(`${baseURL}/api/projects/${projectId}/tasks/${taskId}`, {
                headers: { Cookie: req.headers.cookie },
            })
                .then((response) => {
                    if (response.status === 200) {
                        return response.json();
                    }
                })
                .then((task) => {
                    var assetFiles = [
                        "georeferenced_model.laz",
                        "orthophoto.tif",
                        "dsm.tif",
                        "dtm.tif",
                    ];
                    assetFiles.map((typeFile) => {
                        if (task.available_assets.includes(typeFile)) {
                            var fileURL;
                            if (typeFile === "georeferenced_model.laz") {
                                fileURL = `${baseURL}/api/projects/${projectId}/tasks/${taskId}/assets/entwine_pointcloud/ept.json`;
                            } else {
                                fileURL = `${baseURL}/api/projects/${projectId}/tasks/${taskId}/${typeFile.slice(
                                    0,
                                    -4
                                )}/metadata`;
                            }
                            metaDataPromises.push(
                                fetch(fileURL, {
                                    headers: { Cookie: req.headers.cookie },
                                })
                                    .then((response) => {
                                        if (response.status === 200) {
                                            return response.json();
                                        }
                                    })
                                    .catch((e) => {
                                        //res send?
                                        console.log(e)
                                        console.log("error while getting metadata");
                                    })
                            );
                        }
                    });

                    Promise.all(metaDataPromises)
                        .then((metadata) => {
                            var metadataIndex = 0;
                            var samplePromises = [];
                            var terrainProvider = Cesium.createWorldTerrain();

                            if (metadata[metadataIndex]) {
                                var truncate = true;
                                if (!metadata[metadataIndex].schema) return;
                                metadata[metadataIndex].schema.map((s) => {
                                    if (
                                        s.name === "Red" ||
                                        s.name === "Green" ||
                                        s.name === "Blue"
                                    ) {
                                        if (s.maximum && s.maximum <= 255) {
                                            truncate = false;
                                        }
                                    }
                                });
                                catalog.push({
                                    type: "3d-tiles",
                                    name: task.name + " - Point Cloud",
                                    url: `${eptServer}/tileset.json?ept=${`${baseURL}/api/projects/${projectId}/tasks/${taskId}/assets/entwine_pointcloud/ept.json`}&${truncate ? "truncate" : null
                                        }`,
                                    info: [
                                        {
                                            name: "webODM Properties",
                                            content: "",
                                            contentAsObject: {
                                                public: task.public,
                                            },
                                            show: false,
                                        },
                                    ],
                                });
                            }
                            metadataIndex++;

                            var imageryTypes = ["Orthophoto", "DSM", "DTM"];
                            imageryTypes.map((imageryType) => {
                                if (metadata[metadataIndex]) {
                                    var rectangle = new Cesium.Rectangle.fromDegrees(
                                        metadata[metadataIndex].bounds.value[0],
                                        metadata[metadataIndex].bounds.value[1],
                                        metadata[metadataIndex].bounds.value[2],
                                        metadata[metadataIndex].bounds.value[3]
                                    );
                                    const cartographics = [
                                        Cesium.Rectangle.center(rectangle),
                                        Cesium.Rectangle.southeast(rectangle),
                                        Cesium.Rectangle.southwest(rectangle),
                                        Cesium.Rectangle.northeast(rectangle),
                                        Cesium.Rectangle.northwest(rectangle),
                                    ];

                                    samplePromises.push(
                                        Cesium.sampleTerrainMostDetailed(
                                            terrainProvider,
                                            cartographics
                                        )
                                    );

                                    var tilesUrl;
                                    if (imageryType === "Orthophoto") {
                                        tilesUrl = `${baseURL}/api/projects/${projectId}/tasks/${taskId}/orthophoto/tiles?rescale=${metadata[metadataIndex].statistics[1].min},${metadata[metadataIndex].statistics[1].max}`;
                                    } else if (imageryType === "DSM") {
                                        tilesUrl = `${baseURL}/api/projects/${projectId}/tasks/${taskId}/dsm/tiles?color_map=viridis&rescale=${metadata[metadataIndex].statistics[1].min},${metadata[metadataIndex].statistics[1].max}&hillshade=6`;
                                    } else if (imageryType === "DTM") {
                                        tilesUrl = `${baseURL}/api/projects/${projectId}/tasks/${taskId}/dtm/tiles?color_map=viridis&rescale=${metadata[metadataIndex].statistics[1].min},${metadata[metadataIndex].statistics[1].max}&hillshade=6`;
                                    }

                                    catalog.push({
                                        type: "open-street-map",
                                        name: `${task.name} - ${imageryType}`,
                                        url: tilesUrl,
                                        maximumLevel: metadata[metadataIndex].maxzoom,
                                        rectangle: {
                                            west: metadata[metadataIndex].bounds.value[0],
                                            south: metadata[metadataIndex].bounds.value[1],
                                            east: metadata[metadataIndex].bounds.value[2],
                                            north: metadata[metadataIndex].bounds.value[3],
                                        },
                                        idealZoom: {
                                            lookAt: {
                                                targetLongitude: metadata[metadataIndex].center[0],
                                                targetLatitude: metadata[metadataIndex].center[1],
                                            },
                                        },
                                        info: [
                                            {
                                                name: "webODM Properties",
                                                content: "",
                                                contentAsObject: {
                                                    public: task.public,
                                                },
                                                show: false,
                                            },
                                        ],
                                    });
                                }
                                metadataIndex++;
                            });

                            Promise.all(samplePromises)
                                .then((heights) => {
                                    var heightIndex = 0;
                                    catalog.map((member) => {
                                        if (member.type != "3d-tiles") {
                                            var cartesians =
                                                Cesium.Ellipsoid.WGS84.cartographicArrayToCartesianArray(
                                                    heights[heightIndex]
                                                );
                                            var boundingSphere =
                                                Cesium.BoundingSphere.fromPoints(cartesians);
                                            member.idealZoom.lookAt.targetHeight =
                                                Cesium.Cartographic.fromCartesian(
                                                    boundingSphere.center
                                                ).height;
                                            member.idealZoom.lookAt.range = boundingSphere.radius;

                                            heightIndex++;
                                        }
                                    });

                                    res.header("Access-Control-Allow-Origin", req.headers.origin);
                                    res.header("Access-Control-Allow-Credentials", true);
                                    res.status(200).json({ catalog: catalog });
                                })
                                .catch((e) => {
                                    console.error(e);
                                    res
                                        .status(500)
                                        .json("An error occurred while sampling heights");
                                });
                        })
                        .catch((e) => {
                            console.error(e);
                            res
                                .status(500)
                                .json("An error occurred while getting all metadata");
                        });
                })
                .catch((e) => {
                    console.log("error while getting metadata");
                });
        }
    );

    app.get("/terria/publictask/:taskID.json", (req, res) => {
        var url = new URL(baseURL);
        const eptServer = `${url.protocol}//ept.${url.host}`;

        fetch(`${baseURL}/public/task/${req.params.taskID}/json`)
            .then((response) => response.json())
            .then((publicTask) => {
                var initUrlsFile = {
                    homeCamera: {
                        north: -8,
                        east: 158,
                        south: -45,
                        west: 109,
                    },
                    catalog: [
                        {
                            type: "group",
                            name: publicTask.name ?? "None",
                            members: [],
                        },
                    ],
                    baseMaps: {
                        defaultBaseMapId: "basemap-bing-aerial-with-labels",
                    },
                };
                var projectID = publicTask.project;
                var assetFiles = [
                    "georeferenced_model.laz",
                    "orthophoto.tif",
                    "dsm.tif",
                    "dtm.tif",
                ];
                var metaDataPromises = [];
                assetFiles.map((typeFile) => {
                    if (publicTask.available_assets.includes(typeFile)) {
                        var fileURL;
                        if (typeFile === "georeferenced_model.laz") {
                            fileURL = `${baseURL}/api/projects/${projectID}/tasks/${publicTask.id}/assets/entwine_pointcloud/ept.json`;
                        } else {
                            fileURL = `${baseURL}/api/projects/${projectID}/tasks/${publicTask.id
                                }/${typeFile.slice(0, -4)}/metadata`;
                        }
                        metaDataPromises.push(
                            fetch(fileURL, {
                                headers: { Cookie: req.headers.cookie },
                            })
                                .then((response) => {
                                    if (response.status === 200) {
                                        return response.json();
                                    }
                                })
                                .catch((e) => {
                                    // console.log(e);
                                })
                        );
                    }
                });
                Promise.all(metaDataPromises)
                    .then((metadata) => {
                        var metadataIndex = 0;
                        var samplePromises = [];
                        var terrainProvider = Cesium.createWorldTerrain();
                        if (
                            publicTask.available_assets.includes("georeferenced_model.laz")
                        ) {
                            if (metadata[metadataIndex]) {
                                var truncate = true;
                                if (!metadata[metadataIndex].schema) return;
                                metadata[metadataIndex].schema.map((s) => {
                                    if (
                                        s.name === "Red" ||
                                        s.name === "Green" ||
                                        s.name === "Blue"
                                    ) {
                                        if (s.maximum && s.maximum <= 255) {
                                            truncate = false;
                                        }
                                    }
                                });
                                initUrlsFile.catalog[0].members.push({
                                    type: "3d-tiles",
                                    name: publicTask.name + " - Point Cloud",
                                    url: `${eptServer}/tileset.json?ept=${`${baseURL}/api/projects/${projectID}/tasks/${publicTask.id}/assets/entwine_pointcloud/ept.json`}&${truncate ? "truncate" : null
                                        }`,
                                });
                            }
                            metadataIndex++;
                        }

                        var imageryTypes = ["Orthophoto", "DSM", "DTM"];
                        imageryTypes.map((imageryType) => {
                            if (
                                publicTask.available_assets.includes(
                                    `${imageryType.toLowerCase()}.tif`
                                )
                            ) {
                                if (metadata[metadataIndex]) {
                                    var rectangle = new Cesium.Rectangle.fromDegrees(
                                        metadata[metadataIndex].bounds.value[0],
                                        metadata[metadataIndex].bounds.value[1],
                                        metadata[metadataIndex].bounds.value[2],
                                        metadata[metadataIndex].bounds.value[3]
                                    );
                                    const cartographics = [
                                        Cesium.Rectangle.center(rectangle),
                                        Cesium.Rectangle.southeast(rectangle),
                                        Cesium.Rectangle.southwest(rectangle),
                                        Cesium.Rectangle.northeast(rectangle),
                                        Cesium.Rectangle.northwest(rectangle),
                                    ];

                                    samplePromises.push(
                                        Cesium.sampleTerrainMostDetailed(
                                            terrainProvider,
                                            cartographics
                                        )
                                    );

                                    var tilesUrl;
                                    if (imageryType === "Orthophoto") {
                                        tilesUrl = `${baseURL}/api/projects/${projectID}/tasks/${publicTask.id}/orthophoto/tiles?rescale=${metadata[metadataIndex].statistics[1].min},${metadata[metadataIndex].statistics[1].max}`;
                                    } else if (imageryType === "DSM") {
                                        tilesUrl = `${baseURL}/api/projects/${projectID}/tasks/${publicTask.id}/dsm/tiles?color_map=viridis&rescale=${metadata[metadataIndex].statistics[1].min},${metadata[metadataIndex].statistics[1].max}&hillshade=6`;
                                    } else if (imageryType === "DTM") {
                                        tilesUrl = `${baseURL}/api/projects/${projectID}/tasks/${publicTask.id}/dtm/tiles?color_map=viridis&rescale=${metadata[metadataIndex].statistics[1].min},${metadata[metadataIndex].statistics[1].max}&hillshade=6`;
                                    }

                                    initUrlsFile.catalog[0].members.push({
                                        type: "open-street-map",
                                        name: `${publicTask.name} - ${imageryType}`,
                                        url: tilesUrl,
                                        maximumLevel: metadata[metadataIndex].maxzoom,
                                        rectangle: {
                                            west: metadata[metadataIndex].bounds.value[0],
                                            south: metadata[metadataIndex].bounds.value[1],
                                            east: metadata[metadataIndex].bounds.value[2],
                                            north: metadata[metadataIndex].bounds.value[3],
                                        },
                                        idealZoom: {
                                            lookAt: {
                                                targetLongitude: metadata[metadataIndex].center[0],
                                                targetLatitude: metadata[metadataIndex].center[1],
                                            },
                                        },
                                    });
                                }
                                metadataIndex++;
                            }
                        });

                        Promise.all(samplePromises)
                            .then((heights) => {
                                var heightIndex = 0;

                                initUrlsFile.catalog[0].members.map((member) => {
                                    if (member.type != "3d-tiles") {
                                        var cartesians =
                                            Cesium.Ellipsoid.WGS84.cartographicArrayToCartesianArray(
                                                heights[heightIndex]
                                            );
                                        var boundingSphere =
                                            Cesium.BoundingSphere.fromPoints(cartesians);
                                        member.idealZoom.lookAt.targetHeight =
                                            Cesium.Cartographic.fromCartesian(
                                                boundingSphere.center
                                            ).height;
                                        member.idealZoom.lookAt.range = boundingSphere.radius;

                                        heightIndex++;
                                    }
                                });

                                // catalogJson.catalog.splice(catalogJson.catalog.length-1, 0 , webODMgroup);
                                res.header("Access-Control-Allow-Origin", req.headers.origin);
                                res.header("Access-Control-Allow-Credentials", true);
                                res.status(200).json(initUrlsFile);
                            })
                            .catch((e) => {
                                console.error(e);
                                res
                                    .status(500)
                                    .json("An error occurred while getting the catalog file");
                            });
                    })
                    .catch((e) => {
                        console.error(e);
                        res
                            .status(500)
                            .json("An error occurred while getting the catalog file");
                    });
            })
            .catch((e) => {
                console.error(e);
                res
                    .status(500)
                    .json("An error occurred while getting the catalog file");
            });
    });

    app.patch("/makeWebODMTaskPublic/:project/:taskID", (req, res) => {
        var project = req.params.project;
        var task = req.params.taskID;
        if (req.headers.cookie) {
            var cookies = req.headers.cookie
                .split(";")
                .map((v) => v.split("="))
                .reduce((acc, v) => {
                    if (v[0] && v[1]) {
                        acc[decodeURIComponent(v[0].trim())] = decodeURIComponent(
                            v[1].trim()
                        );
                    }
                    return acc;
                }, {});
            fetch(`${baseURL}/api/projects/${project}/tasks/${task}/`, {
                headers: {
                    "content-type": "application/json",
                    Cookie: req.headers.cookie,
                    Referer: `${baseURL}/`,
                    "x-csrftoken": cookies["csrftoken"],
                },
                body: '{"public":true}',
                method: "PATCH",
            })
                .then((response) => {
                    if (response.status === 200) {
                        return response.json();
                    } else {
                        res.status(response.status).send(response.statusText);
                    }
                })
                .then((json) => {
                    res.status(200).send(json);
                })
                .catch((e) => {
                    res.status(500).send("Error");
                });
        } else {
            res.status(401).send("Unauthorized");
        }
    });

    app.get("/publicCatalogs.json", (req, res) => {
        var urls = [
            "https://terria-catalogs-public.storage.googleapis.com/nationalmap/prod.json",
            "https://raw.githubusercontent.com/GeoscienceAustralia/dea-config/master/dev/terria/dea-maps-v8.json",
            "https://terria-catalogs-public.storage.googleapis.com/de-australia/water-regulations-data/prod.json",
            "https://nsw.digitaltwin.terria.io/api/v0/registry/records/map-config?aspect=terria-config&aspect=terria-init&aspect=group&optionalAspect=terria&dereference=true",
            "https://vic.digitaltwin.terria.io/api/v0/registry/records/map-config?aspect=terria-config&aspect=terria-init&aspect=group&optionalAspect=terria&dereference=true",
        ];
        var promises = [];

        urls.map((url) => {
            promises.push(
                fetch(url)
                    .then((response) => response.text())
                    .then((text) => JSON5.parse(text))
            );
        });

        var catalogJson = {
            catalog: [],
        };

        Promise.all(promises)
            .then((responses) => {
                catalogJson.catalog.push({
                    type: "group",
                    name: "NationalMap Catalog",
                    members: responses[0].catalog,
                    description:
                        "Please note that data from the NationalMap Catalog is subject to Terms & Conditions: https://nationalmap.gov.au/about.html#data-attribution",
                });

                catalogJson.catalog.push({
                    type: "group",
                    name: "Digital Earth Catalog",
                    members: responses[1].catalog,
                    description:
                        "Please note that data from the Digital Earth Catalog is subject to Terms & Conditions: https://maps.dea.ga.gov.au/about#data-attribution",
                });
                catalogJson.catalog.push({
                    type: "group",
                    name: "Digital Earth Catalog",
                    members: responses[2].catalog,
                    description:
                        "Please note that data from the Digital Earth Catalog is subject to Terms & Conditions: https://maps.dea.ga.gov.au/about#data-attribution",
                });

                var nswMembers = responses[3].aspects.group.members;
                var vicMembers = responses[4].aspects.group.members;
                var statePromises = [];

                const checkProxyUrlAndType = (json, state) => {
                    return new Promise((resolve, reject) => {
                        if (json.aspects && json.aspects.terria) {
                            if (json.aspects.terria.definition) {
                                if (json.aspects.terria.definition.url) {
                                    if (state == "nsw") {
                                        if (
                                            json.aspects.terria.definition.url.startsWith(
                                                "https://api.transport.nsw.gov.au"
                                            )
                                        ) {
                                            json.aspects.terria.definition.url =
                                                json.aspects.terria.definition.url.replace(
                                                    "https://api.transport.nsw.gov.au",
                                                    "https://nsw.digitaltwin.terria.io/proxy/https://api.transport.nsw.gov.au"
                                                );
                                        }

                                        if (
                                            json.aspects.terria.definition.url.startsWith(
                                                "https://nsw-digital-twin-data.terria.io/geoserver/ows"
                                            )
                                        ) {
                                            json.aspects.terria.definition.url =
                                                json.aspects.terria.definition.url.replace(
                                                    "https://nsw-digital-twin-data.terria.io/geoserver/ows",
                                                    "https://nsw.digitaltwin.terria.io/proxy/https://nsw-digital-twin-data.terria.io/geoserver/ows"
                                                );
                                        }

                                        if (json.aspects.terria.definition.url.startsWith("/")) {
                                            json.aspects.terria.definition.url =
                                                "https://nsw.digitaltwin.terria.io" +
                                                json.aspects.terria.definition.url;
                                        }
                                    } else if (state == "vic") {
                                        if (json.aspects.terria.definition.url.startsWith("/")) {
                                            json.aspects.terria.definition.url =
                                                "https://vic.digitaltwin.terria.io" +
                                                json.aspects.terria.definition.url;
                                        }
                                        if (
                                            json.aspects.terria.definition.url.startsWith(
                                                "https://map.aurin.org.au/geoserver/ows"
                                            )
                                        ) {
                                            json.aspects.terria.definition.url =
                                                json.aspects.terria.definition.url.replace(
                                                    "https://map.aurin.org.au/geoserver/ows",
                                                    "https://vic.digitaltwin.terria.io/proxy/_1d/https://map.aurin.org.au/geoserver/ows"
                                                );
                                        }
                                    }
                                }
                            }
                            if (state == "nsw") {
                                if (json.aspects.terria.type) {
                                    var filterTypes = [
                                        "nsw-fuel-price",
                                        "air-quality-json",
                                        "nsw-rfs",
                                        "nsw-traffic",
                                    ];
                                    if (filterTypes.includes(json.aspects.terria.type)) {
                                        Object.keys(json).map((k) => delete json[k]);
                                        resolve();
                                    }
                                }
                            }
                        }
                        if (
                            json.aspects &&
                            json.aspects.group &&
                            json.aspects.group.members &&
                            json.aspects.group.members.length > 0
                        ) {
                            if (
                                json.aspects.group.members.every((jm) => typeof jm == "string")
                            ) {
                                fetch(
                                    `https://${state}.digitaltwin.terria.io/api/v0/registry/records/${json.id}?optionalAspect=terria&optionalAspect=group&optionalAspect=dcat-dataset-strings&optionalAspect=dcat-distribution-strings&optionalAspect=dataset-distributions&optionalAspect=dataset-format&dereference=true`
                                )
                                    .then((response) => response.text())
                                    .then((text) => JSON5.parse(text))
                                    .then((expandedJson) => {
                                        json.aspects.group.members =
                                            expandedJson.aspects.group.members;

                                        var promises = [];
                                        for (
                                            var i = 0;
                                            i < json.aspects.group.members.length;
                                            i++
                                        ) {
                                            promises.push(
                                                checkProxyUrlAndType(
                                                    json.aspects.group.members[i],
                                                    state
                                                )
                                            );
                                        }
                                        Promise.all(promises).then(() => {
                                            resolve();
                                        });
                                    });
                            } else {
                                var promises = [];
                                for (var i = 0; i < json.aspects.group.members.length; i++) {
                                    promises.push(
                                        checkProxyUrlAndType(json.aspects.group.members[i], state)
                                    );
                                }

                                Promise.all(promises).then(() => {
                                    resolve();
                                });
                            }
                        } else {
                            resolve();
                        }
                    });
                };

                nswMembers.map((m) => {
                    delete m.aspects;
                    delete m.authnReadPolicyId;
                    m.url = "https://nsw.digitaltwin.terria.io";
                    m.type = "magda";
                    m.recordId = m.id;

                    statePromises.push(
                        new Promise((resolve, reject) => {
                            fetch(
                                `https://nsw.digitaltwin.terria.io/api/v0/registry/records/${m.id}?optionalAspect=terria&optionalAspect=group&optionalAspect=dcat-dataset-strings&optionalAspect=dcat-distribution-strings&optionalAspect=dataset-distributions&optionalAspect=dataset-format&dereference=true`
                            )
                                .then((response) => response.text())
                                .then((text) => JSON5.parse(text))
                                .then((json) => {
                                    checkProxyUrlAndType(json, "nsw").then(() => {
                                        m.magdaRecord = json;
                                        if (
                                            (json.aspects &&
                                                json.aspects.group &&
                                                json.aspects.group.members &&
                                                Array.isArray(json.aspects.group.members)) ||
                                            (json.aspects &&
                                                json.aspects.terria &&
                                                json.aspects.terria.definition &&
                                                json.aspects.terria.definition.isGroup)
                                        ) {
                                            m.isGroup = true;
                                        }

                                        resolve();
                                    });
                                });
                        })
                    );
                });

                vicMembers.map((m) => {
                    delete m.aspects;
                    delete m.authnReadPolicyId;
                    m.url = "https://vic.digitaltwin.terria.io";
                    m.type = "magda";
                    m.recordId = m.id;

                    statePromises.push(
                        new Promise((resolve, reject) => {
                            fetch(
                                `https://vic.digitaltwin.terria.io/api/v0/registry/records/${m.id}?optionalAspect=terria&optionalAspect=group&optionalAspect=dcat-dataset-strings&optionalAspect=dcat-distribution-strings&optionalAspect=dataset-distributions&optionalAspect=dataset-format&dereference=true`
                            )
                                .then((response) => response.text())
                                .then((text) => JSON5.parse(text))
                                .then((json) => {
                                    checkProxyUrlAndType(json, "vic").then(() => {
                                        m.magdaRecord = json;
                                        if (
                                            (json.aspects &&
                                                json.aspects.group &&
                                                json.aspects.group.members &&
                                                Array.isArray(json.aspects.group.members)) ||
                                            (json.aspects &&
                                                json.aspects.terria &&
                                                json.aspects.terria.definition &&
                                                json.aspects.terria.definition.isGroup)
                                        ) {
                                            m.isGroup = true;
                                        }

                                        resolve();
                                    });
                                });
                        })
                    );
                });

                Promise.all(statePromises).then(() => {
                    catalogJson.catalog.push({
                        type: "group",
                        name: "NSW Spatial Digital Twin Catalog",
                        members: nswMembers,
                        description:
                            "Please note that data from the NSW Spatial Digital Twin Catalog is subject to Terms & Conditions: https://nsw.digitaltwin.terria.io/about.html#data-attribution",
                    });

                    catalogJson.catalog.push({
                        type: "group",
                        name: "Digital Twin Victoria Catalog",
                        members: vicMembers,
                        description:
                            "Please note that data from the Digital Twin Victoria Catalog is subject to Terms & Conditions: https://www.land.vic.gov.au/maps-and-spatial/digital-twin-victoria/dtv-platform/data-and-terms#heading-4",
                    });

                    res.status(200).json(catalogJson);
                });
            })
            .catch((e) => {
                console.log(e);
            });
    });

    if (typeof options.settings.trustProxy !== 'undefined') {
        app.set('trust proxy', options.settings.trustProxy);
    }

    if (options.verbose) {
        console.log('Listening on these endpoints:', true);
    }
    endpoint('/ping', function (req, res) {
        res.status(200).send('OK');
    });

    // We do this after the /ping service above so that ping can be used unauthenticated and without TLS for health checks.

    if (options.settings.redirectToHttps) {
        var httpAllowedHosts = options.settings.httpAllowedHosts || ["localhost"];
        app.use(function (req, res, next) {
            if (httpAllowedHosts.indexOf(req.hostname) >= 0) {
                return next();
            }

            if (req.protocol !== 'https') {
                var url = 'https://' + req.hostname + req.url;
                res.redirect(301, url);
            } else {
                if (options.settings.strictTransportSecurity) {
                    res.setHeader('Strict-Transport-Security', options.settings.strictTransportSecurity);
                }
                next();
            }
        });
    }

    //unused
    app.get("/terriaCatalog.json", (req, res) => {
        const eptServer = `${baseURL}/ept`;
        var catalogJson = {
            catalog: [],
        };
        var webODMgroup = {
            type: "group",
            name: "WebODM Projects",
            members: [],
        };
        fetch(`${baseURL}/api/projects/?ordering=-created_at`, {
            headers: { Cookie: req.headers.cookie },
        })
            .then((response) => {
                if (response.status === 200) {
                    return response.json();
                }
            })
            .then((odmProjects) => {
                if (!odmProjects) {
                    res.status(404).json("No projects were found");
                    return;
                }
                var taskInfoPromises = [];
                var metaDataPromises = [];
                if (Array.isArray(odmProjects)) {
                    odmProjects.map((project) => {
                        taskInfoPromises.push(
                            fetch(
                                `${baseURL}/api/projects/${project.id}/tasks/?ordering=-created_at`,
                                {
                                    headers: { Cookie: req.headers.cookie },
                                }
                            )
                                .then((response) => {
                                    return response.json();
                                })
                                .catch(() => {
                                    res
                                        .status(500)
                                        .json(
                                            "An error occurred while getting projects from webODM"
                                        );
                                })
                        );
                    });
                    Promise.all(taskInfoPromises).then((taskInfos, taskIndex) => {
                        if (Array.isArray(odmProjects)) {
                            odmProjects.map((project, projectIndex) => {
                                taskInfos[projectIndex].map((task) => {
                                    var assetFiles = [
                                        "georeferenced_model.laz",
                                        "orthophoto.tif",
                                        "dsm.tif",
                                        "dtm.tif",
                                    ];
                                    assetFiles.map((typeFile) => {
                                        if (task.available_assets.includes(typeFile)) {
                                            var fileURL;
                                            if (typeFile === "georeferenced_model.laz") {
                                                fileURL = `${baseURL}/api/projects/${project.id}/tasks/${task.id}/assets/entwine_pointcloud/ept.json`;
                                            } else {
                                                fileURL = `${baseURL}/api/projects/${project.id
                                                    }/tasks/${task.id}/${typeFile.slice(0, -4)}/metadata`;
                                            }
                                            metaDataPromises.push(
                                                fetch(fileURL, {
                                                    headers: { Cookie: req.headers.cookie },
                                                })
                                                    .then((response) => {
                                                        if (response.status === 200) {
                                                            return response.json();
                                                        }
                                                    })
                                                    .catch((e) => {
                                                        console.log("error while getting metadata");
                                                    })
                                            );
                                        }
                                    });
                                });
                            });
                        }

                        Promise.all(metaDataPromises)
                            .then((metadata) => {
                                var metadataIndex = 0;
                                var samplePromises = [];
                                var terrainProvider = Cesium.createWorldTerrain();
                                if (Array.isArray(odmProjects)) {
                                    odmProjects.map((project, projectIndex) => {
                                        var projectMember = {
                                            type: "group",
                                            name: project.name,
                                            members: [],
                                        };

                                        taskInfos[projectIndex].map((task, taskIndex) => {
                                            var taskMember = {
                                                type: "group",
                                                name: task.name,
                                                members: [],
                                            };

                                            if (
                                                task.available_assets.includes(
                                                    "georeferenced_model.laz"
                                                )
                                            ) {
                                                if (metadata[metadataIndex]) {
                                                    var truncate = true;
                                                    if (!metadata[metadataIndex].schema) return;
                                                    metadata[metadataIndex].schema.map((s) => {
                                                        if (
                                                            s.name === "Red" ||
                                                            s.name === "Green" ||
                                                            s.name === "Blue"
                                                        ) {
                                                            if (s.maximum && s.maximum <= 255) {
                                                                truncate = false;
                                                            }
                                                        }
                                                    });
                                                    taskMember.members.push({
                                                        type: "3d-tiles",
                                                        name: task.name + " - Point Cloud",
                                                        url: `${eptServer}/tileset.json?ept=${`${baseURL}/api/projects/${project.id}/tasks/${task.id}/assets/entwine_pointcloud/ept.json`}&${truncate ? "truncate" : null
                                                            }`,
                                                    });
                                                }
                                                metadataIndex++;
                                            }

                                            var imageryTypes = ["Orthophoto", "DSM", "DTM"];
                                            imageryTypes.map((imageryType) => {
                                                if (
                                                    task.available_assets.includes(
                                                        `${imageryType.toLowerCase()}.tif`
                                                    )
                                                ) {
                                                    if (metadata[metadataIndex]) {
                                                        var rectangle = new Cesium.Rectangle.fromDegrees(
                                                            metadata[metadataIndex].bounds.value[0],
                                                            metadata[metadataIndex].bounds.value[1],
                                                            metadata[metadataIndex].bounds.value[2],
                                                            metadata[metadataIndex].bounds.value[3]
                                                        );
                                                        const cartographics = [
                                                            Cesium.Rectangle.center(rectangle),
                                                            Cesium.Rectangle.southeast(rectangle),
                                                            Cesium.Rectangle.southwest(rectangle),
                                                            Cesium.Rectangle.northeast(rectangle),
                                                            Cesium.Rectangle.northwest(rectangle),
                                                        ];

                                                        samplePromises.push(
                                                            Cesium.sampleTerrainMostDetailed(
                                                                terrainProvider,
                                                                cartographics
                                                            )
                                                        );

                                                        var tilesUrl;
                                                        if (imageryType === "Orthophoto") {
                                                            tilesUrl = `${baseURL}/api/projects/${project.id}/tasks/${task.id}/orthophoto/tiles?rescale=${metadata[metadataIndex].statistics[1].min},${metadata[metadataIndex].statistics[1].max}`;
                                                        } else if (imageryType === "DSM") {
                                                            tilesUrl = `${baseURL}/api/projects/${project.id}/tasks/${task.id}/dsm/tiles?color_map=viridis&rescale=${metadata[metadataIndex].statistics[1].min},${metadata[metadataIndex].statistics[1].max}&hillshade=6`;
                                                        } else if (imageryType === "DTM") {
                                                            tilesUrl = `${baseURL}/api/projects/${project.id}/tasks/${task.id}/dtm/tiles?color_map=viridis&rescale=${metadata[metadataIndex].statistics[1].min},${metadata[metadataIndex].statistics[1].max}&hillshade=6`;
                                                        }

                                                        taskMember.members.push({
                                                            type: "open-street-map",
                                                            name: `${task.name} - ${imageryType}`,
                                                            url: tilesUrl,
                                                            maximumLevel: metadata[metadataIndex].maxzoom,
                                                            rectangle: {
                                                                west: metadata[metadataIndex].bounds.value[0],
                                                                south: metadata[metadataIndex].bounds.value[1],
                                                                east: metadata[metadataIndex].bounds.value[2],
                                                                north: metadata[metadataIndex].bounds.value[3],
                                                            },
                                                            idealZoom: {
                                                                lookAt: {
                                                                    targetLongitude:
                                                                        metadata[metadataIndex].center[0],
                                                                    targetLatitude:
                                                                        metadata[metadataIndex].center[1],
                                                                },
                                                            },
                                                        });
                                                    }
                                                    metadataIndex++;
                                                }
                                            });

                                            if (taskMember.members.length > 0) {
                                                projectMember.members.push(taskMember);
                                            }
                                        });

                                        if (projectMember.members.length > 0) {
                                            webODMgroup.members.push(projectMember);
                                        }
                                    });
                                }

                                Promise.all(samplePromises)
                                    .then((heights) => {
                                        var heightIndex = 0;
                                        if (Array.isArray(odmProjects)) {
                                            odmProjects.map((project, projectIndex) => {
                                                taskInfos[projectIndex].map((task, taskIndex) => {
                                                    webODMgroup.members[projectIndex]?.members[
                                                        taskIndex
                                                    ]?.members.map((member) => {
                                                        if (member.type != "3d-tiles") {
                                                            var cartesians =
                                                                Cesium.Ellipsoid.WGS84.cartographicArrayToCartesianArray(
                                                                    heights[heightIndex]
                                                                );
                                                            var boundingSphere =
                                                                Cesium.BoundingSphere.fromPoints(cartesians);
                                                            member.idealZoom.lookAt.targetHeight =
                                                                Cesium.Cartographic.fromCartesian(
                                                                    boundingSphere.center
                                                                ).height;
                                                            member.idealZoom.lookAt.range =
                                                                boundingSphere.radius;

                                                            heightIndex++;
                                                        }
                                                    });
                                                });
                                            });
                                        }

                                        catalogJson.catalog.push(webODMgroup);
                                        res.header(
                                            "Access-Control-Allow-Origin",
                                            req.headers.origin
                                        );
                                        res.header("Access-Control-Allow-Credentials", true);
                                        res.status(200).json(catalogJson);
                                    })
                                    .catch((e) => {
                                        console.error(e);
                                        res
                                            .status(500)
                                            .json("An error occurred while sampling heights");
                                    });
                            })
                            .catch((e) => {
                                console.error(e);
                                res
                                    .status(500)
                                    .json("An error occurred while getting all metadata");
                            });
                    });
                }
            })
            .catch(() => {
                res
                    .status(500)
                    .json("An error occurred while getting the projects from webodm");
            });
    });

    var auth = options.settings.basicAuthentication;
    if (auth && auth.username && auth.password) {
        var store = new ExpressBrute.MemoryStore();
        var rateLimitOptions = {
            freeRetries: 2,
            minWait: 200,
            maxWait: 60000,
        };
        if (options.settings.rateLimit && options.settings.rateLimit.freeRetries !== undefined) {
            rateLimitOptions.freeRetries = options.settings.rateLimit.freeRetries;
            rateLimitOptions.minWait = options.settings.rateLimit.minWait;
            rateLimitOptions.maxWait = options.settings.rateLimit.maxWait;
        }
        var bruteforce = new ExpressBrute(store, rateLimitOptions);
        app.use(bruteforce.prevent, function (req, res, next) {
            var user = basicAuth(req);
            if (user && user.name === auth.username && user.pass === auth.password) {
                // Successful authentication, reset rate limiting.
                req.brute.reset(next);
            } else {
                res.statusCode = 401;
                res.setHeader('WWW-Authenticate', 'Basic realm="terriajs-server"');
                res.end('Unauthorized');
            }
        });
    }

    // Serve the bulk of our application as a static web directory.
    var serveWwwRoot = exists(options.wwwroot + '/index.html')
        || (options.settings.singlePageRouting && exists(options.wwwroot + options.settings.singlePageRouting.resolvePathRelativeToWwwroot));
    if (serveWwwRoot) {
        app.use(express.static(options.wwwroot));
    }

    // Proxy for servers that don't support CORS
    var bypassUpstreamProxyHostsMap = (options.settings.bypassUpstreamProxyHosts || []).reduce(function (map, host) {
        if (host !== '') {
            map[host.toLowerCase()] = true;
        }
        return map;
    }, {});

    endpoint('/proxy', require('terriajs-server/lib/controllers/proxy')({
        proxyableDomains: options.settings.allowProxyFor,
        proxyAllDomains: options.settings.proxyAllDomains,
        proxyAuth: options.proxyAuth,
        proxyPostSizeLimit: options.settings.proxyPostSizeLimit,
        upstreamProxy: options.settings.upstreamProxy,
        bypassUpstreamProxyHosts: bypassUpstreamProxyHostsMap,
        basicAuthentication: options.settings.basicAuthentication,
        blacklistedAddresses: options.settings.blacklistedAddresses,
        appendParamToQueryString: options.settings.appendParamToQueryString
    }));

    var esriTokenAuth = require('terriajs-server/lib/controllers/esri-token-auth')(options.settings.esriTokenAuth);
    if (esriTokenAuth) {
        endpoint('/esri-token-auth', esriTokenAuth);
    }

    endpoint('/proj4def', require('terriajs-server/lib/controllers/proj4lookup'));            // Proj4def lookup service, to avoid downloading all definitions into the client.
    endpoint('/convert', require('terriajs-server/lib/controllers/convert')(options).router); // OGR2OGR wrapper to allow supporting file types like Shapefile.
    endpoint('/proxyabledomains', require('terriajs-server/lib/controllers/proxydomains')({   // Returns JSON list of domains we're willing to proxy for
        proxyableDomains: options.settings.allowProxyFor,
        proxyAllDomains: !!options.settings.proxyAllDomains,
    }));
    endpoint('/serverconfig', require('terriajs-server/lib/controllers/serverconfig')(options));

    var errorPage = require('terriajs-server/lib/errorpage');
    var show404 = serveWwwRoot && exists(options.wwwroot + '/404.html');
    var error404 = errorPage.error404(show404, options.wwwroot, serveWwwRoot);
    var show500 = serveWwwRoot && exists(options.wwwroot + '/500.html');
    var error500 = errorPage.error500(show500, options.wwwroot);
    var initPaths = options.settings.initPaths || [];

    if (serveWwwRoot) {
        initPaths.push(path.join(options.wwwroot, 'init'));
    }

    app.use('/init', require('terriajs-server/lib/controllers/initfile')(initPaths, error404, options.configDir));

    var feedbackService = require('terriajs-server/lib/controllers/feedback')(options.settings.feedback);
    if (feedbackService) {
        endpoint('/feedback', feedbackService);
    }
    var shareService = require("terriajs-server/lib/controllers/share")(
        options.hostName,
        options.port,
        {
            shareUrlPrefixes: options.settings.shareUrlPrefixes,
            newShareUrlPrefix: options.settings.newShareUrlPrefix,
            shareMaxRequestSize: options.settings.shareMaxRequestSize
        }
    );
    if (shareService) {
        endpoint('/share', shareService);
    }

    if (options.settings && options.settings.singlePageRouting) {
        var singlePageRoutingService = require('terriajs-server/lib/controllers/single-page-routing')(options, options.settings.singlePageRouting);
        if (singlePageRoutingService) {
            endpoint('*', singlePageRoutingService);
        }
    }


    app.use(error404);
    app.use(error500);
    var server = app;
    var osh = options.settings.https;
    if (osh && osh.key && osh.cert) {
        console.log('Launching in HTTPS mode.');
        var https = require('https');
        server = https.createServer({
            key: fs.readFileSync(osh.key),
            cert: fs.readFileSync(osh.cert)
        }, app);
    }

    return server;
};
