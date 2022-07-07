"use strict";
import { uniq } from "lodash-es";
import { runInAction, toJS } from "mobx";
import Ellipsoid from "terriajs-cesium/Source/Core/Ellipsoid";
import CesiumMath from "terriajs-cesium/Source/Core/Math";
import URI from "urijs";
import hashEntity from "terriajs/lib/Core/hashEntity";
import isDefined from "terriajs/lib/Core/isDefined";
import TerriaError from "terriajs/lib/Core/TerriaError";
import ReferenceMixin from "terriajs/lib/ModelMixins/ReferenceMixin";
import CommonStrata from "terriajs/lib/Models/Definition/CommonStrata";
import { BaseModel } from "terriajs/lib/Models/Definition/Model";
import saveStratumToJson from "terriajs/lib/Models/Definition/saveStratumToJson";
import GlobeOrMap from "terriajs/lib/Models/GlobeOrMap";
import HasLocalData from "terriajs/lib/Models/HasLocalData";
/** User properties (generated from URL hash parameters) to add to share link URL in PRODUCTION environment.
 * If in Dev, we add all user properties.
 */
const userPropsToShare = ["hideExplorerPanel", "activeTabId"];
export const SHARE_VERSION = "8.0.0";
/** Create base share link URL - with `hashParameters` applied on top.
 * This will copy over some `userProperties` - see `userPropsToShare`
 */
function buildBaseShareUrl(terria, hashParams) {
    const uri = new URI(window.location).fragment("").search("");
    if (terria.developmentEnv) {
        uri.addSearch(toJS(terria.userProperties));
    }
    else {
        userPropsToShare.forEach(key => uri.addSearch({ [key]: terria.userProperties.get(key) }));
    }
    uri.addSearch(hashParams);
    return uri
        .fragment(uri.query())
        .query("")
        .toString();
}
/**
 * Builds a share link that reflects the state of the passed Terria instance.
 *
 * @param terria The terria instance to serialize.
 * @param {ViewState} [viewState] The viewState to read whether we're viewing the catalog or not
 * @param {Object} [options] Options for building the share link.
 * @param {Boolean} [options.includeStories=true] True to include stories in the share link, false to exclude them.
 * @returns {String} A URI that will rebuild the current state when viewed in a browser.
 */
export function buildShareLink(terria, viewState, options = { includeStories: true }) {
    return buildBaseShareUrl(terria, {
        start: JSON.stringify(getShareData(terria, viewState, options))
    });
}
/**
 * Like {@link buildShareLink}, but shortens the result using {@link Terria#urlShortener}.
 *
 * @returns {Promise<String>} A promise that will return the shortened url when complete.
 */
export async function buildShortShareLink(terria, viewState, options = { includeStories: true }) {
    var _a;
    if (!isDefined(terria.shareDataService))
        throw TerriaError.from("Could not generate share token - `shareDataService` is `undefined`");
    const token = await ((_a = terria.shareDataService) === null || _a === void 0 ? void 0 : _a.getShareToken(getShareData(terria, viewState, options)));
    if (typeof token === "string") {
        return buildBaseShareUrl(terria, {
            share: token
        });
    }
    throw TerriaError.from("Could not generate share token");
}
/**
 * Returns just the JSON that defines the current view.
 * @param  {Terria} terria The Terria object.
 * @param  {ViewState} [viewState] Current viewState.
 * @return {Object}
 */
export function getShareData(terria, viewState, options = { includeStories: true }) {
    return runInAction(() => {
        const { includeStories } = options;
        const initSource = {};
        const initSources = [initSource];
        addStratum(terria, CommonStrata.user, initSource);
        addWorkbench(terria, initSource);
        addTimelineItems(terria, initSource);
        addViewSettings(terria, viewState, initSource);
        addFeaturePicking(terria, initSource);

        initSource.catalog = []

        var newModels = {}
        Object.keys(initSource.models).map(m=>{
            if (!m.startsWith("//WebODM Projects") && !m.startsWith("//Shared WebODM Datasets")){
                newModels[m] = initSource.models[m];
            }
        })

        initSource.workbench.map((w,i)=>{
            if (w.startsWith("//WebODM Projects") || w.startsWith("//Shared WebODM Datasets")){
                if (!initSource.catalog.find(m=>m.name=="Shared WebODM Datasets")){
                    initSource.catalog.push({
                        type: "group",
                        name: "Shared WebODM Datasets",
                        members: []
                    })
                }
            }

            if (w.startsWith("//WebODM Projects")){
                if(!newModels["//Shared WebODM Datasets"]){
                    newModels["//Shared WebODM Datasets"]={
                        "isOpen": true,
                        "knownContainerUniqueIds": [
                            "/"
                        ],
                        "type": "group"
                    }
                }
                const model = terria.getModelById(BaseModel, w);
                newModels[`//Shared WebODM Datasets/${model.name}`] = initSource.models[w];

                newModels[`//Shared WebODM Datasets/${model.name}`].knownContainerUniqueIds[0] = "//Shared WebODM Datasets";

                initSource.workbench[i] = `//Shared WebODM Datasets/${model.name}`;
                var defStratum = model.strata.get("definition");
                var modelJson = saveStratumToJson(model.traits, defStratum);
                modelJson.type = model.type;
                initSource.catalog[0].members.push(modelJson);
            }
            //
            if (w.startsWith("//Shared WebODM Datasets")){
                const model = terria.getModelById(BaseModel, w);
                var userStratum = model.strata.get("user");
                var modelJson = saveStratumToJson(model.traits, userStratum);
                modelJson.type = model.type;
                initSource.catalog[0].members.push(modelJson);
            }
        })

        // initSource.models=newModels;

        if (includeStories) {
            // info that are not needed in scene share data
            // addStories(terria, initSource);

            var stories = JSON.parse(JSON.stringify(terria.stories.slice()));

            stories.map(story=>{
                story.shareData.initSources.map(is=>{
                    is.workbench.map((w,i)=>{
                        if (w.startsWith("//WebODM Projects") || w.startsWith("//Shared WebODM Datasets")){
                            if (!initSource.catalog.find(m=>m.name=="Shared WebODM Datasets")){
                                initSource.catalog.push({
                                    type: "group",
                                    name: "Shared WebODM Datasets",
                                    members: []
                                })
                            }
                        }              
                        if (w.startsWith("//WebODM Projects")){
                            if(!newModels["//Shared WebODM Datasets"]){
                                newModels["//Shared WebODM Datasets"]={
                                    "isOpen": true,
                                    "knownContainerUniqueIds": [
                                        "/"
                                    ],
                                    "type": "group"
                                }
                            }
                            const model = terria.getModelById(BaseModel, w);

                            if (!newModels[`//Shared WebODM Datasets/${model.name}`] && is.models[w]){
                                newModels[`//Shared WebODM Datasets/${model.name}`] = is.models[w];
                                newModels[`//Shared WebODM Datasets/${model.name}`].knownContainerUniqueIds[0] = "//Shared WebODM Datasets";
                            }
                            var defStratum = model.strata.get("definition");
                            var modelJson = saveStratumToJson(model.traits, defStratum);
                            modelJson.type = model.type;
                            if (!initSource.catalog[0].members.includes(modelJson)){
                                initSource.catalog[0].members.push(modelJson);
                            }
                            
                            is.workbench[i] = `//Shared WebODM Datasets/${model.name}`;
                        }
                    })
                    is.models={};
                })
            })
            initSource.stories = stories;
        }
        initSource.models=newModels;

        return {
            version: SHARE_VERSION,
            initSources: initSources
        };
    });
}

//for story replay before share
export function getShareDataForStories(terria, viewState, options = { includeStories: true }) {
    return runInAction(() => {
        const { includeStories } = options;
        const initSource = {};
        const initSources = [initSource];
        addStratum(terria, CommonStrata.user, initSource);
        addWorkbench(terria, initSource);
        addTimelineItems(terria, initSource);
        addViewSettings(terria, viewState, initSource);
        addFeaturePicking(terria, initSource);
        if (includeStories) {
            // info that are not needed in scene share data
            addStories(terria, initSource);
        }

        return {
            version: SHARE_VERSION,
            initSources: initSources
        };
    });
}

/**
 * Serialise all model data from a given stratum except feature highlight
 * and serialise all ancestors of any models serialised
 * @param {Terria} terria
 * @param {CommonStrata} stratumId
 * @param {Object} initSource
 */
function addStratum(terria, stratumId, initSource) {
    initSource.stratum = stratumId;
    initSource.models = {};
    terria.modelValues.forEach(model => {
        if (model.uniqueId === GlobeOrMap.featureHighlightID)
            return;
        const force = terria.workbench.contains(model);
        addModelStratum(terria, model, stratumId, force, initSource);
    });
    // Go through knownContainerUniqueIds and make sure they exist in models
    Object.keys(initSource.models).forEach(modelId => {
        const model = terria.getModelById(BaseModel, modelId);
        if (model)
            model.completeKnownContainerUniqueIds.forEach(containerId => {
                var _a;
                if (!((_a = initSource.models) === null || _a === void 0 ? void 0 : _a[containerId])) {
                    const containerModel = terria.getModelById(BaseModel, containerId);
                    if (containerModel)
                        addModelStratum(terria, containerModel, stratumId, true, initSource);
                }
            });
    });
}
function addWorkbench(terria, initSource) {
    initSource.workbench = terria.workbench.itemIds.filter(isShareable(terria));
}
function addTimelineItems(terria, initSources) {
    initSources.timeline = terria.timelineStack.itemIds.filter(isShareable(terria));
}
function addModelStratum(terria, model, stratumId, force, initSource) {
    var _a;
    const models = initSource.models;
    const id = model.uniqueId;
    if (!id || !models || (models === null || models === void 0 ? void 0 : models[id]) !== undefined) {
        return;
    }
    
    const stratum = model.strata.get(stratumId);

    const dereferenced = ReferenceMixin.isMixedInto(model)
        ? model.target
        : undefined;
    const dereferencedStratum = dereferenced
        ? dereferenced.strata.get(stratumId)
        : undefined;
    if (!force && stratum === undefined && dereferencedStratum === undefined) {
        return;
    }

    if (!isShareable(terria)(id)) {
        return;
    }

    models[id] = stratum ? saveStratumToJson(model.traits, stratum) : {};

    if (dereferenced && dereferencedStratum) {
        models[id].dereferenced = saveStratumToJson(dereferenced.traits, dereferencedStratum);
    }

    if (model.knownContainerUniqueIds &&
        model.knownContainerUniqueIds.length > 0) {
        models[id].knownContainerUniqueIds = model.knownContainerUniqueIds.slice();
    }
    const members = toJS(models[id].members);
    if (Array.isArray(members)) {
        models[id].members = uniq((_a = models[id].members) === null || _a === void 0 ? void 0 : _a.filter(member => typeof member === "string" ? isShareable(terria)(member) : false));
    }
    models[id].type = model.type;
}
/**
 * Returns a function which determines whether a modelId represents a model that can be shared
 * @param  {Object} terria The Terria object.
 * @return {Function} The function which determines whether a modelId can be shared
 */
export function isShareable(terria) {
    return function (modelId) {
        const model = terria.getModelById(BaseModel, modelId);
        return (model &&
            ((HasLocalData.is(model) && !model.hasLocalData) ||
                !HasLocalData.is(model)));
    };
}
/**
 * Is it currently possible to generate short URLs?
 * @param  {Object} terria The Terria object.
 * @return {Boolean}
 */
export function canShorten(terria) {
    return terria.shareDataService && terria.shareDataService.isUsable;
}
/**
 * Adds the details of the current view to the init sources.
 * @private
 */
function addViewSettings(terria, viewState, initSource = {}) {
    var _a;
    const viewer = terria.mainViewer;
    // const time = {
    //   dayNumber: terria.timelineClock.currentTime.dayNumber,
    //   secondsOfDay: terria.timelineClock.currentTime.secondsOfDay
    // };
    let viewerMode;
    if (terria.mainViewer.viewerMode === "cesium") {
        if (terria.mainViewer.viewerOptions.useTerrain) {
            viewerMode = "3d";
        }
        else {
            viewerMode = "3dSmooth";
        }
    }
    else {
        viewerMode = "2d";
    }
    initSource.initialCamera = terria.currentViewer
        .getCurrentCameraView()
        .toJson();
    initSource.homeCamera = terria.mainViewer.homeCamera.toJson();
    initSource.viewerMode = viewerMode;
    initSource.showSplitter = terria.showSplitter;
    initSource.splitPosition = terria.splitPosition;
    initSource.settings = {
        baseMaximumScreenSpaceError: terria.baseMaximumScreenSpaceError,
        useNativeResolution: terria.useNativeResolution,
        alwaysShowTimeline: terria.timelineStack.alwaysShowingTimeline,
        baseMapId: (_a = viewer.baseMap) === null || _a === void 0 ? void 0 : _a.uniqueId,
        terrainSplitDirection: terria.terrainSplitDirection,
        depthTestAgainstTerrainEnabled: terria.depthTestAgainstTerrainEnabled
    };
    if (isDefined(viewState)) {
        const itemIdToUse = viewState.viewingUserData()
            ? isDefined(viewState.userDataPreviewedItem) &&
                viewState.userDataPreviewedItem.uniqueId
            : isDefined(viewState.previewedItem) && viewState.previewedItem.uniqueId;
        // don't persist the not-visible-to-user previewed id in the case of sharing from outside the catalog
        if (viewState.explorerPanelIsVisible && itemIdToUse) {
            initSource.previewedItemId = itemIdToUse;
        }
    }
}
/**
 * Add details of currently picked features.
 * @private
 */
function addFeaturePicking(terria, initSource) {
    if (isDefined(terria.pickedFeatures) &&
        terria.pickedFeatures.features.length > 0 &&
        terria.pickedFeatures.pickPosition) {
        const positionInRadians = Ellipsoid.WGS84.cartesianToCartographic(terria.pickedFeatures.pickPosition);
        const pickedFeatures = {
            providerCoords: terria.pickedFeatures.providerCoords,
            pickCoords: {
                lat: CesiumMath.toDegrees(positionInRadians.latitude),
                lng: CesiumMath.toDegrees(positionInRadians.longitude),
                height: positionInRadians.height
            }
        };
        if (isDefined(terria.selectedFeature)) {
            // Sometimes features have stable ids and sometimes they're randomly generated every time, so include both
            // id and name as a fallback.
            pickedFeatures.current = {
                name: terria.selectedFeature.name,
                hash: hashEntity(terria.selectedFeature, terria.timelineClock)
            };
        }
        // Remember the ids of vector features only, the raster ones we can reconstruct from providerCoords.
        pickedFeatures.entities = terria.pickedFeatures.features
            .filter(feature => !isDefined(feature.imageryLayer))
            .map(entity => {
            return {
                name: entity.name,
                hash: hashEntity(entity, terria.timelineClock)
            };
        });
        initSource.pickedFeatures = pickedFeatures;
    }
}
function addStories(terria, initSource) {
    if (isDefined(terria.stories)) {
        initSource.stories = terria.stories.slice();
    }
}
//# sourceMappingURL=BuildShareLink.js.map