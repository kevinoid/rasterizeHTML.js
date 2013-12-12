"use strict";

var requireExternalDependencyWorkaround = require('./requireExternalDependencyWorkaround'),
    xmlserializer = requireExternalDependencyWorkaround('xmlserializer'),
    util = require('./util');

var supportsBlobBuilding = function () {
    // Newer Safari (under PhantomJS) seems to support blob building, but loading an image with the blob fails
    if (window.navigator.userAgent.indexOf("WebKit") >= 0 && window.navigator.userAgent.indexOf("Chrome") < 0) {
        return false;
    }
    if (window.BlobBuilder || window.MozBlobBuilder || window.WebKitBlobBuilder) {
        // Deprecated interface
        return true;
    } else {
        if (window.Blob) {
            // Available as constructor only in newer builds for all Browsers
            try {
                new window.Blob(['<b></b>'], { "type" : "text\/xml" });
                return true;
            } catch (err) {
                return false;
            }
        }
    }
    return false;
};

var getBlob = function (data) {
   var imageType = "image/svg+xml;charset=utf-8",
       BLOBBUILDER = window.BlobBuilder || window.MozBlobBuilder || window.WebKitBlobBuilder,
       svg;
   if (BLOBBUILDER) {
       svg = new BLOBBUILDER();
       svg.append(data);
       return svg.getBlob(imageType);
   } else {
       return new window.Blob([data], {"type": imageType});
   }
};

var buildImageUrl = function (svg) {
    var DOMURL = window.URL || window.webkitURL || window;
    if (supportsBlobBuilding()) {
        return DOMURL.createObjectURL(getBlob(svg));
    } else {
        return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    }
};

var cleanUpUrl = function (url) {
    var DOMURL = window.URL || window.webkitURL || window;
    if (supportsBlobBuilding()) {
        DOMURL.revokeObjectURL(url);
    }
};

var WORKAROUND_ID = "rasterizeHTML_js_FirefoxWorkaround";

var needsBackgroundImageWorkaround = function () {
    var firefoxMatch = window.navigator.userAgent.match(/Firefox\/(\d+).0/);
    return !firefoxMatch || !firefoxMatch[1] || parseInt(firefoxMatch[1], 10) < 17;
};

var getOrCreateHiddenDivWithId = function (doc, id) {
    var div = doc.getElementById(id);
    if (! div) {
        div = util.createHiddenElement(doc, "div");
        div.id = id;
    }

    return div;
};

var workAroundBrowserBugForBackgroundImages = function (svg, canvas) {
    // Firefox < 17, Chrome & Safari will (sometimes) not show an inlined background-image until the svg is
    // connected to the DOM it seems.
    var uniqueId = util.getConstantUniqueIdFor(svg),
        doc = canvas ? canvas.ownerDocument : window.document,
        workaroundDiv;

    if (needsBackgroundImageWorkaround()) {
        workaroundDiv = getOrCreateHiddenDivWithId(doc, WORKAROUND_ID + uniqueId);
        workaroundDiv.innerHTML = svg;
        workaroundDiv.className = WORKAROUND_ID; // Make if findable for debugging & testing purposes
    }
};

var workAroundWebkitBugIgnoringTheFirstRuleInCSS = function (doc) {
    // Works around bug with webkit ignoring the first rule in each style declaration when rendering the SVG to the
    // DOM. While this does not directly affect the process when rastering to canvas, this is needed for the
    // workaround found in workAroundBrowserBugForBackgroundImages();
    if (window.navigator.userAgent.indexOf("WebKit") >= 0) {
        Array.prototype.forEach.call(doc.getElementsByTagName("style"), function (style) {
            style.textContent = "span {}\n" + style.textContent;
        });
    }
};

var cleanUpAfterWorkAroundForBackgroundImages = function (svg, canvas) {
    var uniqueId = util.getConstantUniqueIdFor(svg),
        doc = canvas ? canvas.ownerDocument : window.document,
        div = doc.getElementById(WORKAROUND_ID + uniqueId);
    if (div) {
        div.parentNode.removeChild(div);
    }
};

module.exports.getSvgForDocument = function (doc, width, height) {
    var xhtml;

    workAroundWebkitBugIgnoringTheFirstRuleInCSS(doc);
    xhtml = xmlserializer.serializeToString(doc);

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
            '<foreignObject width="100%" height="100%">' +
                xhtml +
            '</foreignObject>' +
        '</svg>'
    );
};

module.exports.renderSvg = function (svg, canvas, successCallback, errorCallback) {
    var url, image,
        resetEventHandlers = function () {
            image.onload = null;
            image.onerror = null;
        },
        cleanUp = function () {
            if (url) {
                cleanUpUrl(url);
            }
            cleanUpAfterWorkAroundForBackgroundImages(svg, canvas);
        };

    workAroundBrowserBugForBackgroundImages(svg, canvas);

    url = buildImageUrl(svg);

    image = new window.Image();
    image.onload = function() {
        resetEventHandlers();
        cleanUp();
        successCallback(image);
    };
    image.onerror = function () {
        cleanUp();

        // Webkit calls the onerror handler if the SVG is faulty
        errorCallback();
    };
    image.src = url;
};

module.exports.drawImageOnCanvas = function (image, canvas) {
    try {
        canvas.getContext("2d").drawImage(image, 0, 0);
    } catch (e) {
        // Firefox throws a 'NS_ERROR_NOT_AVAILABLE' if the SVG is faulty
        return false;
    }

    return true;
};

var getViewportSize = function (canvas, options) {
    var defaultWidth = 300,
        defaultHeight = 200,
        fallbackWidth = canvas ? canvas.width : defaultWidth,
        fallbackHeight = canvas ? canvas.height : defaultHeight,
        width = options.width !== undefined ? options.width : fallbackWidth,
        height = options.height !== undefined ? options.height : fallbackHeight;

    return {
        width: width,
        height: height
    };
};

module.exports.drawDocumentImage = function (doc, canvas, options, successCallback, errorCallback) {
    var viewportSize = getViewportSize(canvas, options);

    if (options.hover) {
        util.fakeHover(doc, options.hover);
    }
    if (options.active) {
        util.fakeActive(doc, options.active);
    }

    util.calculateDocumentContentSize(doc, viewportSize.width, viewportSize.height, function (width, height) {
        var svg = module.exports.getSvgForDocument(doc, width, height);

        module.exports.renderSvg(svg, canvas, function (image) {
            successCallback(image);
        }, errorCallback);
    });
};
