"use strict";

/*
Copied from old stix2viz code: define additional graph edge types from
STIX embedded relationships.  (And convert to a proper Map object.)

keys are the name of the _ref/s property, values are the name of the
relationship and whether the object with that property should be the
source_ref in the relationship
*/
let refsMapping = new Map(Object.entries({
    created_by_ref: ["created-by", true],
    object_marking_refs: ["applies-to", false],
    object_refs: ["refers-to", true],
    sighting_of_ref: ["sighting-of", true],
    observed_data_refs: ["observed", true],
    where_sighted_refs: ["saw", false],
    object_ref: ["applies-to", true],
    sample_refs: ["sample-of", false],
    analysis_sco_refs: ["captured-by", false],
    contains_refs: ["contains", true],
    resolves_to_refs: ["resolves-to", true],
    belongs_to_ref: ["belongs-to", true],
    from_ref: ["from", true],
    sender_ref: ["sent-by", true],
    to_refs: ["to", true],
    cc_refs: ["cc", true],
    bcc_refs: ["bcc", true],
    raw_email_ref: ["raw-binary-of", false],
    parent_directory_ref: ["parent-of", false],
    content_ref: ["contents-of", false],
    src_ref: ["source-of", false],
    dst_ref: ["destination-of", false],
    src_payload_ref: ["source-payload-of", false],
    dst_payload_ref: ["destination-payload-of", false],
    encapsulates_refs: ["encapsulated-by", false],
    encapsulated_by_ref: ["encapsulated-by", true],
    opened_connection_refs: ["opened-by", false],
    creator_user_ref: ["created-by", true],
    image_ref: ["image-of", false],
    parent_ref: ["parent-of", false]
}));


/**
 * Instances represent general invalid STIX content passed into the visualizer.
 */
class STIXContentError extends Error
{
    constructor(message=null, opts=null)
    {
        // Use a default generic message.
        if (!message)
            message = "Invalid STIX content: expected a non-empty mapping"
            + " (object or Map) which is a single STIX object or bundle with"
            + " at least one object, or a non-empty array of objects.";

        super(message, opts);
    }
}


/**
 * Instances represent a particular invalid STIX object.
 */
class InvalidSTIXObjectError extends STIXContentError
{
    constructor(stixObject, opts=null)
    {
        let message = "Invalid STIX object: requires at least type and id"
        + " properties";

        // May as well give some extra info if we know it.  It may seem
        // silly to say we require an id property... and them give the value
        // of the id property!  I think users will get the idea.
        let stixId = stixObject.get("id");
        if (stixId)
            message += ": " + stixId;

        super(message, opts);

        this.stixObject = stixObject;
    }
}


/**
 * Instances represent an invalid configuration value.
 */
class InvalidConfigError extends Error
{
    constructor(message=null, opts=null)
    {
        if (!message)
            message = "Invalid configuration value: must be a JSON or"
                      + " Javascript object.";

        super(message, opts);
    }
}


/**
 * Determine whether the given value is a plain javascript object.  E.g. one
 * which was given as an object literal.
 */
function isPlainObject(value)
{
    let result = false;

    // null/undefined would cause errors in Object.getPrototypeOf(), and
    // {} and [] are actually truthy in javascript!  I don't think anything
    // falsey could be a plain object.
    if (value)
        // https://stackoverflow.com/questions/52001739/what-is-considered-a-plain-object
        result = Object.getPrototypeOf(value) === Object.prototype;

    return result;
}


/**
 * A JSON.parse() "reviver" function which may be used to cause JSON.parse()
 * to produce a Map instead of a plain javascript object (from a JSON object).
 */
function mapReviver(key, value)
{
    if (isPlainObject(value))
        return new Map(Object.entries(value));
    else
        return value;
}


/**
 * Recursively search through the given value and convert all plain objects
 * found into Map's.
 */
function recursiveObjectToMap(obj)
{
    let newValue;

    if (isPlainObject(obj))
    {
        let map = new Map();
        for (let [key, value] of Object.entries(obj))
            map.set(key, recursiveObjectToMap(value));

        newValue = map;
    }
    else if (Array.isArray(obj))
        newValue = obj.map(recursiveObjectToMap);
    else
        newValue = obj;

    return newValue;
}


/**
 * Convert the given content to a data structure which uses Maps.  E.g. for
 * strings, do the same thing as normal JSON.parse(), but translate JSON
 * objects into Javascript Maps instead of plain objects.  For plain objects,
 * convert them and their sub-objects to Maps.  That way we can use more sane
 * container types.
 *
 * @param stixContent A JSON string, plain object, or array
 * @return The converted content
 */
function parseToMap(jsonContent)
{
    let newValue;

    if (typeof jsonContent === "string" || jsonContent instanceof String)
        newValue = JSON.parse(jsonContent, mapReviver);
    else
        newValue = recursiveObjectToMap(jsonContent);

    return newValue;
}


/**
 * Somewhat the reverse of parseToMap: convert all maps within the given value
 * to plain objects.
 *
 * @param value Any value
 * @return A value without Maps
 */
function mapToObject(value)
{
    if (value instanceof Map)
    {
        let obj = {};
        for (let [subKey, subValue] of value)
            obj[subKey] = mapToObject(subValue);
        value = obj;
    }
    else if (Array.isArray(value))
        value = value.map(mapToObject);

    return value;
}


/**
 * Perform a simple sanity check on a STIX object to determine whether it's
 * valid.
 *
 * @param object The STIX object
 * @return true if the object is valid; false if not
 */
function isValidStixObject(stixObject)
{
    // assume we've gone through the normalization process such that we
    // can assume we have a Map object.  This is more about whether an object
    // has what we need, than whether we have an object in the first place.
    return stixObject.has("id") && stixObject.has("type");
}


/**
 * Given a name, modify it to make it unique: add a "(n)" suffix depending
 * on the content of nameCounts.  nameCounts contains the number of times the
 * name was previously seen.  nameCounts is updated as necessary.
 *
 * @param baseName A computed name, which may not be unique
 * @param nameCounts Bookkeeping to support uniquefication, mapping previously
 *      seen base names to counts
 * @return A uniquefied name
 */
function uniquefyName(baseName, nameCounts)
{
    let uniqueName;
    let nameCount = nameCounts.get(baseName) || 0;

    ++nameCount;
    nameCounts.set(baseName, nameCount);

    if (nameCount === 1)
        uniqueName = baseName;
    else
        uniqueName = baseName + "(" + nameCount.toString() + ")";

    return uniqueName;
}


/**
 * Find a name for the given STIX object.  This will be the label users see
 * in the graph.  If a name has already been computed for the object, it is
 * returned.  Otherwise, a new name is computed and data structures updated
 * (stixIdToName and nameCounts).
 *
 * @param stixObject a STIX object
 * @param stixIdToName A mapping from IDs of STIX objects to previously
 *      computed names.
 * @param nameCounts A mapping from names to counts, used to uniquefy new names.
 * @param config A config object containing preferences for naming objects;
 *      null to use defaults
 * @return A name
 */
function nameForStixObject(stixObject, stixIdToName, nameCounts, config=null)
{
    let stixId = stixObject.get("id");
    let stixType = stixObject.get("type");

    let name = stixIdToName.get(stixId);
    if (!name)
    {
        let baseName;
        let userLabels;

        // Look for an ID-specific label; if that fails, look for a
        // type-specific label; if that fails, use some hard-coded fallbacks,
        // which eventually just default to using the STIX type.
        if (config)
            userLabels = config.get("userLabels");
            if (userLabels)
                baseName = userLabels.get(stixId);

            if (!baseName)
            {
                let typeConfig = config.get(stixType);
                if (typeConfig)
                {
                    let labelPropName = typeConfig.get("display_property");
                    if (labelPropName)
                        baseName = stixObject.get(labelPropName);
                }
            }

        // Copied from old visualizer, fall back to some hard-coded properties
        if (!baseName)
            baseName = stixObject.get("name");
        if (!baseName)
            baseName = stixObject.get("value");
        if (!baseName)
            baseName = stixObject.get("path");
        if (!baseName)
            baseName = stixType;

        // Copied from old visualizer: ensure the name isn't too long.
        if (baseName.length > 100)
          baseName = baseName.substr(0,100) + '...';

        name = uniquefyName(baseName, nameCounts);
        stixIdToName.set(stixId, name);
    }

    return name;
}


/**
 * Create a URL to an icon file for the given STIX type.  This does not check
 * whether the icon file actually exists.
 *
 * @param stixType the STIX type to get a URL for
 * @param iconPath A path to prepend to an icon filename.  The path is
 *      prepended as <path>/<filename>, i.e. it is separated from the filename
 *      with a forward slash.  If null/undefined, don't prepend a path.
 * @param iconFileName An icon file name.  If falsey, a default is constructed
 *      from the given STIX type.
 * @return A URL of an icon for the given STIX type
 */
function stixTypeToIconURL(stixType, iconPath, iconFileName)
{
    let iconUrl;

    if (!iconFileName)
        iconFileName = "stix2_"
            + stixType.replaceAll("-", "_")
            + "_icon_tiny_round_v1.png";

    if (iconPath === null || iconPath === undefined)
        iconUrl = iconFileName;
    else
        iconUrl = iconPath + "/" + iconFileName;

    return iconUrl;
}


/**
 * Create an object representing a visjs network edge.  Any changes to edge
 * config settings can be made here.
 *
 * @param sourceRef STIX ID of the source object
 * @param targetRef STIX ID of the dest object
 * @param label A label to be associated with the edge
 * @return An edge object
 */
function makeEdgeObject(sourceRef, targetRef, label)
{
    let edge = {
        from: sourceRef,
        to: targetRef,
        label: label,
        arrows: "to"
    };

    return edge;
}


/**
 * Create an object representing an visjs network node.  Any changes to node
 * config settings can be made here.
 *
 * @param name A node name; will be used to label the node in the graph
 * @param stixObject The STIX object.  Provided in case any info from it is
 *      needed for configuring the node
 * @return A node object
 */
function makeNodeObject(name, stixObject)
{
    let node = {
        id: stixObject.get("id"),
        label: name,
        group: stixObject.get("type"),
        // we don't need to set any icon config here; it is inherited from the
        // group.

        // I don't know if this is frowned upon, but we can sneak in some
        // useful extra information for our click handlers.
        //
        // Sadly, we must convert back to a plain object, or visjs will
        // clobber it!
        _stixObject: mapToObject(stixObject)
    };

    return node;
}


/**
 * Create a visjs network edge object from the given STIX relationship object,
 * if possible.  If source or target_ref refers to an unknown object, the edge
 * can't be created and null is returned.
 *
 * @param stixRel a STIX relationship object
 * @param stixIdToObject A mapping from STIX ID to object, representing all of
 *      the objects we know about.
 * @return An visjs network edge object, or null if one could not be created
 */
function edgeForRelationship(stixRel, stixIdToObject)
{
    let sourceRef = stixRel.get("source_ref");
    let targetRef = stixRel.get("target_ref");
    let relType = stixRel.get("relationship_type");

    let edge = null;
    if (stixIdToObject.has(sourceRef) && stixIdToObject.has(targetRef))
        edge = makeEdgeObject(sourceRef, targetRef, relType);
    else
        console.warn(
            "Skipped relationship %s %s %s: missing endpoint object(s)",
            sourceRef, relType, targetRef
        );

    return edge;
}


/**
 * Search through the top-level properties of the given STIX object, and
 * create visjs network edges for embedded relationships.
 *
 * @param stixObject a STIX object
 * @param stixIdToObject A mapping from STIX ID to object, representing all of
 *      the objects we know about.
 * @return An array of edge objects
 */
function edgesForEmbeddedRelationships(stixObject, stixIdToObject)
{
    let edges = [];

    let sourceId = stixObject.get("id");

    for (let [propName, value] of stixObject)
    {
        let relInfo = refsMapping.get(propName);

        if (relInfo)
        {
            // "forward" edge direction is referrer->referent
            // "backward" is referent->referrer
            let [edgeLabel, forward] = relInfo;
            let refs;

            if (propName.endsWith("_ref"))
                refs = [value];
            else
                refs = value;

            for (let ref of refs)
            {
                if (stixIdToObject.has(ref))
                {
                    let edgeSrc, edgeDst;
                    if (forward)
                        [edgeSrc, edgeDst] = [sourceId, ref];
                    else
                        [edgeSrc, edgeDst] = [ref, sourceId];

                    let edge = makeEdgeObject(
                        edgeSrc, edgeDst, edgeLabel
                    );

                    edges.push(edge);
                }
                else
                    console.warn(
                        "Skipped embedded relationship %s %s %s: target object"
                        + " missing",
                        sourceId, propName, ref
                    );
            }
        }
    }

    return edges;
}


/**
 * Make the node and edge structures visjs-network requires, from the given
 * STIX bundle.
 *
 * @param stixObjects an array of STIX objects
 * @param config A config object containing preferences for naming objects;
 *      null to use defaults
 * @return nodes and edges structures in a 2-element array.
 */
function makeNodesAndEdges(stixObjects, config=null)
{
    // Create a different data structure for the objects: a mapping from ID
    // to object.  This makes object lookups by STIX ID fast.
    let stixIdToObject = new Map();

    for (let object of stixObjects)
        stixIdToObject.set(object.get("id"), object);

    // List of graph nodes, where each list element is whatever visjs needs
    // to represent the node.  This is a plain javascript object with an "id"
    // property at least, to identify the node.
    let nodes = [];

    // List of links/edges for the graph, where each list element is whatever
    // visjs needs to represent the edge.  This is a plain javascript object
    // with "from" and "to" properties at least, whose values are the IDs of
    // the linked nodes.
    let edges = [];

    // Used to uniquefy names.  E.g. first "foo" gets the name, then others
    // will be "foo(2)", "foo(3)", etc.  This map keeps track of those counts.
    // Maps the "base" name as computed for the STIX object, to a count.
    let nameCounts = new Map();

    // Map STIX IDs to the node names we use in the graph.
    let stixIdToName = new Map();

    for (let object of stixObjects)
    {
        if (object.get("type") === "relationship")
        {
            let edge = edgeForRelationship(object, stixIdToObject);

            if (edge)
                edges.push(edge);
        }
        else
        {
            let name = nameForStixObject(
                object, stixIdToName, nameCounts, config
            );
            let node = makeNodeObject(name, object);
            nodes.push(node);

            let embeddedRelEdges = edgesForEmbeddedRelationships(
                object, stixIdToObject
            );

            // Seems like there ought to be a better way to extend one array
            // with the contents of another.
            edges.push(...embeddedRelEdges);
        }
    }

    return [nodes, edges];
}


/**
 * Create a fallback icon URL to use any time the usual STIX type based
 * icon file is not found.  (Implied: this default is the same, regardless of
 * STIX type.)  Of course, this fallback *should* be known to always exist!
 *
 * @param iconPath The user-configured setting for the icon directory, in case
 *      it is relevant for the fallback; null if one was not configured.
 * @return A URL to an icon
 */
function getDefaultIconURL(iconPath=null)
{
    let defaultURL = stixTypeToIconURL('custom_object', iconPath, null);
    defaultURL = defaultURL.replace('.png', '.svg');

    return defaultURL;
}


/**
 * Create a visjs network groups structure.  There will be one group per
 * STIX type present in the data (except "relationship").
 *
 * @param stixObjects Iterable of STIX objects
 * @param config Config data used for finding icons for the graph nodes
 */
function makeGroups(stixObjects, config=null)
{
    let iconPath = null;
    if (config)
        iconPath = config.get("iconDir");

    let defaultIconURL = getDefaultIconURL(iconPath);

    let stixTypes = new Set();

    // collect our types
    for (let object of stixObjects)
        stixTypes.add(object.get("type"));

    // relationships don't correspond to node types...
    stixTypes.delete("relationship");

    let groups = {};
    for (let type of stixTypes)
    {
        // Choose an icon file according to config settings
        let iconFileName;

        if (config)
        {
            let typeConfig = config.get(type);
            if (typeConfig)
                iconFileName = typeConfig.get("display_icon");
        }

        let iconURL = stixTypeToIconURL(type, iconPath, iconFileName);

        groups[type] = {
            shape: "circularImage",
            image: iconURL,
            brokenImage: defaultIconURL
        };
    }

    return groups;
}


/**
 * Config can be given as JSON or an object.  Normalize whatever we are given
 * to an object.
 *
 * @param config configuration as given to the visualizer
 * @return A configuration object
 * @throw InvalidConfigError if the given config value is invalid
 */
function normalizeConfig(config)
{
    try
    {
        config = parseToMap(config)
    }
    catch(err)
    {
        throw new InvalidConfigError(null, {cause: err});
    }

    if (!(config instanceof Map))
        throw new InvalidConfigError();

    return config;
}


/**
 * STIX content input to the visualizer can take different forms.  This
 * function normalizes it to an array of objects, so subsequent code only
 * deals with a single form.  Each object is itself normalized to a Map
 * instance (as are all sub-objects).
 *
 * This function also does some simple sanity checks on the input to try to
 * ensure it is valid.
 *
 * @param stixContent STIX content as given to the visualizer
 * @return An array of objects
 * @throw STIXContentError if any errors are found in the input
 */
function normalizeContent(stixContent)
{
    let stixObjects;

    try
    {
        stixContent = parseToMap(stixContent);
    }
    catch (err)
    {
        throw new STIXContentError(null, {cause: err});
    }

    if (stixContent instanceof Map && stixContent.size > 0)
    {
        if (stixContent.get("type") === "bundle")
            stixObjects = stixContent.get("objects") || [];
        else
            // Assume we were given a single object
            stixObjects = [stixContent];
    }
    else if (Array.isArray(stixContent))
        stixObjects = stixContent;
    else
        throw new STIXContentError();

    if (!Array.isArray(stixObjects) || stixObjects.length <= 0)
        throw new STIXContentError();

    // Do a simple validity check on our individual STIX objects.
    for (let stixObject of stixObjects)
        if (!isValidStixObject(stixObject))
            throw new InvalidSTIXObjectError(stixObject);

    return stixObjects;
}


/**
 * Drag start handler: must ensure the node is not fixed on drag start, or
 * dragging won't work.
 *
 * @param event a visjs-network event object with info about the drag
 * @param nodeDataSet a visjs DataSet instance with the graph node data
 */
function dragStartHandler(event, nodeDataSet)
{
    // Ignore events not associated with a node (e.g. panning the canvas)
    if (event.nodes.length > 0)
    {
        let draggedNodeId = event.nodes[0];
        nodeDataSet.updateOnly({id: draggedNodeId, fixed: false});
    }
}


/**
 * Drag end handler: fix the node so it stays where the user dropped it.
 *
 * @param event a visjs-network event object with info about the drag
 * @param nodeDataSet a visjs DataSet instance with the graph node data
 */
function dragEndHandler(event, nodeDataSet)
{
    // Ignore events not associated with a node (e.g. panning the canvas)
    if (event.nodes.length > 0)
    {
        let draggedNodeId = event.nodes[0];
        nodeDataSet.updateOnly({id: draggedNodeId, fixed: true});
    }
}


/**
 * Double click handler: toggle whether the node is pinned/fixed.  This would
 * usually be used to un-pin a node.
 *
 * @param event a visjs-network event object with info about the double click
 * @param nodeDataSet a visjs DataSet instance with the graph node data
 */
function doubleClickHandler(event, nodeDataSet)
{
    // Ignore events not associated with a node (e.g. double-clicking the
    // canvas)
    if (event.nodes.length > 0)
    {
        let selectedNodeId = event.nodes[0];
        let selectedNode = nodeDataSet.get(selectedNodeId);
        nodeDataSet.updateOnly({id: selectedNodeId, fixed: !selectedNode.fixed});
    }
}


/**
 * The entrypoint for users of this module: create a graph which visualizes
 * the content in the given STIX bundle.  The content will be added to the
 * webpage DOM under the given element.
 *
 * @param visjs The visjs-network module
 * @param domElement the parent element where the graph is to be located in a
 *      web page
 * @param stixContent STIX content as a JSON string, object, or array of
 *      objects.
 * @param config A config object containing preferences for naming objects;
 *      null to use defaults
 * @return The graph object.  May be used perform certain options on the
 *      graph, e.g. dispose of it.
 */
function makeGraph(visjs, domElement, stixContent, config=null)
{
    if (config !== null)
        config = normalizeConfig(config);

    let stixObjects = normalizeContent(stixContent);

    let groups = makeGroups(stixObjects, config);

    let [nodes, edges] = makeNodesAndEdges(stixObjects, config);

    let nodeDataSet = new visjs.DataSet(nodes);
    let edgeDataSet = new visjs.DataSet(edges);

    let graphData = {
        nodes: nodeDataSet,
        edges: edgeDataSet
    };

    let graphOpts = {
        groups: groups
    };

    let network = new visjs.Network(domElement, graphData, graphOpts);

    // Add some handlers to enable some hard-coded behavior.
    network.on("dragStart", e => dragStartHandler(e, nodeDataSet));
    network.on("dragEnd", e => dragEndHandler(e, nodeDataSet));
    network.on("doubleClick", e => doubleClickHandler(e, nodeDataSet));

    return network;
}


/**
 * Create and return an object which is this file's module.
 */
function makeModule(visjs)
{
    let module = {
        makeGraph: (domElement, stixContent, config=null) =>
            makeGraph(visjs, domElement, stixContent, config)
    };

    return module;
}


define(["nbextensions/stix2viz/vis-network"], makeModule);
