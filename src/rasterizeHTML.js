"use strict";

var render = require('./render'),
    util = require('./util'),
    inlineUtil = require('./inlineUtil'),
    rasterizeHTMLInline = require('./inline');

var doDraw = function (doc, canvas, options, callback, allErrors) {
    var handleInternalError = function (errors) {
            errors.push({
                resourceType: "document",
                msg: "Error rendering page"
            });
        };

    render.drawDocumentImage(doc, canvas, options, function (image) {
        var successful;

        if (canvas) {
            successful = render.drawImageOnCanvas(image, canvas);

            if (!successful) {
                handleInternalError(allErrors);
                image = null;   // Set image to null so that Firefox behaves similar to Webkit
            }
        }

        if (callback) {
            callback(image, allErrors);
        }
    }, function () {
        handleInternalError(allErrors);

        if (callback) {
            callback(null, allErrors);
        }
    });
};

var drawDocument = function (doc, canvas, options, callback) {
    var executeJsTimeout = options.executeJsTimeout || 0,
        inlineOptions;

    inlineOptions = inlineUtil.clone(options);
    inlineOptions.inlineScripts = options.executeJs === true;

    rasterizeHTMLInline.inlineReferences(doc, inlineOptions, function (allErrors) {
        if (options.executeJs) {
            util.executeJavascript(doc, options.baseUrl, executeJsTimeout, function (doc, errors) {
                util.persistInputValues(doc);

                doDraw(doc, canvas, options, callback, allErrors.concat(errors));
            });
        } else {
            doDraw(doc, canvas, options, callback, allErrors);
        }
    });
};

/**
 * Draws a Document to the canvas.
 * rasterizeHTML.drawDocument( document [, canvas] [, options] [, callback] );
 */
module.exports.drawDocument = function () {
    var doc = arguments[0],
        optionalArguments = Array.prototype.slice.call(arguments, 1),
        params = util.parseOptionalParameters(optionalArguments);

    drawDocument(doc, params.canvas, params.options, params.callback);
};

var drawHTML = function (html, canvas, options, callback) {
    var doc = util.parseHTML(html);

    module.exports.drawDocument(doc, canvas, options, callback);
};

/**
 * Draws a HTML string to the canvas.
 * rasterizeHTML.drawHTML( html [, canvas] [, options] [, callback] );
 */
module.exports.drawHTML = function () {
    var html = arguments[0],
        optionalArguments = Array.prototype.slice.call(arguments, 1),
        params = util.parseOptionalParameters(optionalArguments);

    drawHTML(html, params.canvas, params.options, params.callback);
};

var drawURL = function (url, canvas, options, callback) {
    util.loadDocument(url, options, function (doc) {
        module.exports.drawDocument(doc, canvas, options, callback);
    }, function () {
        if (callback) {
            callback(null, [{
                resourceType: "page",
                url: url,
                msg: "Unable to load page " + url
            }]);
        }
    });
};

/**
 * Draws a page to the canvas.
 * rasterizeHTML.drawURL( url [, canvas] [, options] [, callback] );
 */
module.exports.drawURL = function () {
    var url = arguments[0],
        optionalArguments = Array.prototype.slice.call(arguments, 1),
        params = util.parseOptionalParameters(optionalArguments);

    drawURL(url, params.canvas, params.options, params.callback);
};
