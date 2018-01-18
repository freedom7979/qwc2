/**
 * Copyright 2017, Sourcepole AG.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

const ol = require('openlayers');
const assign = require('object-assign');
const deepmerge = require('deepmerge').default;
const isEmpty = require('lodash.isempty');
const fastXmlParser = require('fast-xml-parser');
const randomColor = require('randomcolor');

const owsNS = "http://www.opengis.net/ows";
const xlinkNS="http://www.w3.org/1999/xlink";

function strcmp(a, b) {
    let al = a.toLowerCase();
    let bl = b.toLowerCase();
    return al < bl ? -1 : al > bl ? 1 : 0;
}

function array(obj) {
    return Array.isArray(obj) ? obj : [obj];
}

const ServiceLayerUtils = {
    getDCPTypes(dcpTypes) {
        let result = {};
        for(let dcpType of dcpTypes) {
            result = deepmerge(result, dcpType);
        }
        return result;
    },
    getWMSLayers(capabilitiesXml) {
        let wmsFormat = new ol.format.WMSCapabilities();
        let capabilities = wmsFormat.read(capabilitiesXml);
        let infoFormats = null;
        try {
            infoFormats = capabilities.Capability.Request.GetFeatureInfo.Format;
        } catch(e) {
            infoFormats = ['text/plain'];
        }
        let topLayer = null;
        let serviceUrl = null;
        try {
            topLayer = capabilities.Capability.Layer;
            serviceUrl = ServiceLayerUtils.getDCPTypes(capabilities.Capability.Request.GetMap.DCPType)["HTTP"]["Get"]["OnlineResource"];
        } catch (e) {
            return [];
        }
        let featureInfoUrl = null;
        try {
            featureInfoUrl = ServiceLayerUtils.getDCPTypes(capabilities.Capability.Request.GetFeatureInfo.DCPType)["HTTP"]["Get"]["OnlineResource"];
        } catch (e) {
            featureInfoUrl = serviceUrl;
        }
        let version = capabilities.version;
        if(!topLayer.Layer) {
            return [this.getWMSLayerParams(topLayer, topLayer.CRS, serviceUrl, version, featureInfoUrl, infoFormats)];
        } else {
            let entries = topLayer.Layer.map(layer => this.getWMSLayerParams(layer, topLayer.CRS, serviceUrl, version, featureInfoUrl, infoFormats));
            return entries.sort((a, b) => strcmp(a.title, b.title));
        }
    },
    getWMSLayerParams(layer, parentCrs, serviceUrl, version, featureInfoUrl, infoFormats) {
        let supportedCrs = layer.CRS;
        if(isEmpty(supportedCrs)) {
            supportedCrs = [...parentCrs];
        } else {
            supportedCrs = [...parentCrs, ...supportedCrs];
        }
        let sublayers = [];
        if(!isEmpty(layer.Layer)) {
            sublayers = layer.Layer.map(sublayer => this.getWMSLayerParams(sublayer, supportedCrs, serviceUrl, version));
        }
        let bbox = {
            crs: layer.BoundingBox[0].crs,
            bounds: layer.BoundingBox[0].extent
        };
        let legendUrl = null;
        try {
            legendUrl = layer.Style[0].LegendURL[0].OnlineResource;
        } catch (e) {
        }
        return {
            type: "wms",
            name: layer.Name,
            title: layer.Title,
            abstract: layer.Abstract,
            attribution: layer.Attribution,
            legendUrl: legendUrl,
            url: serviceUrl,
            version: version,
            infoFormats: infoFormats,
            featureInfoUrl: featureInfoUrl,
            queryable: layer.queryable,
            sublayers: sublayers.sort((a, b) => strcmp(a.title, b.title)),
            expanded: false,
            boundingBox: bbox
        };
    },
    getWFSLayers(capabilitiesXml) {
        let options = {
            attrPrefix: "",
            ignoreNonTextNodeAttr: false,
            ignoreTextNodeAttr: false,
            textNodeConversion: true,
            textAttrConversion: true,
            ignoreNameSpace: true
        };
        var capabilities = fastXmlParser.convertToJson(fastXmlParser.getTraversalObj(capabilitiesXml, options));
        if(!capabilities || !capabilities.WFS_Capabilities || !capabilities.WFS_Capabilities.version) {
            return [];
        } else if(capabilities.WFS_Capabilities.version < "2.0.0") {
            return ServiceLayerUtils.getWFS1Layers(capabilities.WFS_Capabilities);
        } else {
            return ServiceLayerUtils.getWFS2Layers(capabilities.WFS_Capabilities);
        }
    },
    getWFS1Layers(capabilities) {
        let serviceUrl = null;
        let version = capabilities.version;
        let formats = null;
        try {
            serviceUrl = ServiceLayerUtils.getDCPTypes(array(capabilities.Capability.Request.GetFeature.DCPType))["HTTP"]["Get"]["onlineResource"];
            formats = Object.keys(capabilities.Capability.Request.GetFeature.ResultFormat);
        } catch(e) {
            return [];
        }

        let layers = [];
        for(let featureType of array(capabilities.FeatureTypeList.FeatureType)) {
            let name, bbox;
            try {
                name = featureType.Name;
                let llbbox = featureType.LatLongBoundingBox;
                bbox = {
                    crs: featureType.SRS,
                    bounds: [llbbox.minx, llbbox.miny, llbbox.maxx, llbbox.maxy]
                }
            } catch(e) {
                continue; // Name and bbox are required
            }
            let title = featureType.Title || name;
            let abstract = featureType.Abstract || "";

            layers.push({
                type: "wfs",
                name: name,
                title: title,
                abstract: abstract,
                boundingBox: bbox,
                url: serviceUrl,
                version: version,
                formats: formats,
                color: randomColor()
            });
        }
        return layers;
    },
    getWFS2Layers(capabilities) {
        let serviceUrl = null;
        let version = capabilities.version;
        let formats = null;
        try {
            let getFeatureOp = array(capabilities.OperationsMetadata.Operation).find(el => el.name === "GetFeature");
            serviceUrl = ServiceLayerUtils.getDCPTypes(array(getFeatureOp.DCP)).HTTP.Get.href;
            formats = array(getFeatureOp.Parameter).find(el => el.name === "outputFormat").AllowedValues.Value;
        } catch(e) {
            return [];
        }

        let layers = [];
        for(let featureType of array(capabilities.FeatureTypeList.FeatureType)) {
            let name, bbox;
            try {
                name = featureType.Name;
                let lc = featureType.WGS84BoundingBox.LowerCorner.split(/\s+/);
                let uc = featureType.WGS84BoundingBox.UpperCorner.split(/\s+/);
                bbox = {
                    crs: "EPSG:4326",
                    bounds: [lc[0], lc[1], uc[0], uc[1]]
                }
            } catch(e) {
                continue; // Name and bbox are required
            }
            let title = featureType.Title || name;
            let abstract = featureType.Abstract || "";

            layers.push({
                type: "wfs",
                name: name,
                title: title,
                abstract: abstract,
                bbox: bbox,
                service: serviceUrl,
                version: version,
                formats: formats,
                color: randomColor()
            });
        }
        return layers;
    }
};

module.exports = ServiceLayerUtils;
