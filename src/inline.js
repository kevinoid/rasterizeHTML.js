"use strict";

var util = require('./inlineUtil'),
    css = require('./inlineCss');

var getUrlBasePath = function (url) {
    return util.joinUrl(url, '.');
};

var parameterHashFunction = function (params) {
    // HACK JSON.stringify is poor man's hashing;
    // same objects might not receive same result as key order is not guaranteed
    var a = params.map(function (param, idx) {
        // Only include options relevant for method
        if (idx === (params.length - 1)) {
            param = {
                // Two different HTML pages on the same path level have the same base path, but a different URL
                baseUrl: getUrlBasePath(param.baseUrl)
            };
        }
        return JSON.stringify(param);
    });
    return a;
};

var memoizeFunctionOnCaching = function (func, options) {
    if ((options.cache !== false && options.cache !== 'none') && options.cacheBucket) {
        return util.memoize(func, parameterHashFunction, options.cacheBucket);
    } else {
        return func;
    }
};

/* Img Inlining */

var encodeImageAsDataURI = function (image, options, successCallback, errorCallback) {
    var url = image.attributes.src ? image.attributes.src.nodeValue : null,
        documentBase = util.getDocumentBaseUrl(image.ownerDocument),
        ajaxOptions = util.clone(options);

    if (url === null || util.isDataUri(url)) {
        successCallback();
        return;
    }

    if (!ajaxOptions.baseUrl && documentBase) {
        ajaxOptions.baseUrl = documentBase;
    }

    util.getDataURIForImageURL(url, ajaxOptions, function (dataURI) {
        image.attributes.src.nodeValue = dataURI;
        successCallback();
    }, function () {
        errorCallback(util.joinUrl(ajaxOptions.baseUrl, url));
    });
};

var filterInputsForImageType = function (inputs) {
    return Array.prototype.filter.call(inputs, function (input) {
        return input.type === "image";
    });
};

module.exports.loadAndInlineImages = function (doc, options, callback) {
    var params = util.parseOptionalParameters(options, callback),
        images = doc.getElementsByTagName("img"),
        inputs = doc.getElementsByTagName("input"),
        imageLike = [],
        errors = [];

    imageLike = Array.prototype.slice.call(images);
    imageLike = imageLike.concat(filterInputsForImageType(inputs));

    util.map(imageLike, function (image, finish) {
        encodeImageAsDataURI(image, params.options, finish, function (url) {
            errors.push({
                resourceType: "image",
                url: url,
                msg: "Unable to load image " + url
            });
            finish();
        });
    }, function () {
        if (params.callback) {
            params.callback(errors);
        }
    });
};

/* Style inlining */

var requestExternalsForStylesheet = function (styleContent, alreadyLoadedCssUrls, options, callback) {
    var cssRules = css.rulesForCssText(styleContent);

    css.loadCSSImportsForRules(cssRules, alreadyLoadedCssUrls, options, function (changedFromImports, importErrors) {
        css.loadAndInlineCSSResourcesForRules(cssRules, options, function (changedFromResources, resourceErrors) {
            var errors = importErrors.concat(resourceErrors),
                hasChanges = changedFromImports || changedFromResources;

            if (hasChanges) {
                styleContent = css.cssRulesToText(cssRules);
            }

            callback(hasChanges, styleContent, errors);
        });
    });
};

var loadAndInlineCssForStyle = function (style, options, alreadyLoadedCssUrls, callback) {
    var styleContent = style.textContent,
        processExternals = memoizeFunctionOnCaching(requestExternalsForStylesheet, options);

    processExternals(styleContent, alreadyLoadedCssUrls, options, function (hasChanges, inlinedStyleContent, errors) {
        errors = util.cloneArray(errors);
        if (hasChanges) {
            style.childNodes[0].nodeValue = inlinedStyleContent;
        }

        callback(errors);
    });
};

var getCssStyleElements = function (doc) {
    var styles = doc.getElementsByTagName("style");

    return Array.prototype.filter.call(styles, function (style) {
        return !style.attributes.type || style.attributes.type.nodeValue === "text/css";
    });
};

module.exports.loadAndInlineStyles = function (doc, options, callback) {
    var params = util.parseOptionalParameters(options, callback),
        styles = getCssStyleElements(doc),
        allErrors = [],
        alreadyLoadedCssUrls = [],
        inlineOptions;

    inlineOptions = util.clone(params.options);
    inlineOptions.baseUrl = inlineOptions.baseUrl || util.getDocumentBaseUrl(doc);

    util.map(styles, function (style, finish) {
        loadAndInlineCssForStyle(style, inlineOptions, alreadyLoadedCssUrls, function (errors) {
            allErrors = allErrors.concat(errors);

            finish();
        });
    }, function () {
        params.callback(allErrors);
    });
};

/* CSS link inlining */

var substituteLinkWithInlineStyle = function (oldLinkNode, styleContent) {
    var parent = oldLinkNode.parentNode,
        styleNode;

    styleContent = styleContent.trim();
    if (styleContent) {
        styleNode = oldLinkNode.ownerDocument.createElement("style");
        styleNode.type = "text/css";
        styleNode.appendChild(oldLinkNode.ownerDocument.createTextNode(styleContent));

        parent.insertBefore(styleNode, oldLinkNode);
    }

    parent.removeChild(oldLinkNode);
};

var requestStylesheetAndInlineResources = function (url, options, successCallback, errorCallback) {
    util.ajax(url, options, function (content) {
        var cssRules = css.rulesForCssText(content),
            changedFromPathAdjustment;

        changedFromPathAdjustment = css.adjustPathsOfCssResources(url, cssRules);
        css.loadCSSImportsForRules(cssRules, [], options, function (changedFromImports, importErrors) {
            css.loadAndInlineCSSResourcesForRules(cssRules, options, function (changedFromResources, resourceErrors) {
                var errors = importErrors.concat(resourceErrors);

                if (changedFromPathAdjustment || changedFromImports || changedFromResources) {
                    content = css.cssRulesToText(cssRules);
                }

                successCallback(content, errors);
            });
        });
    }, errorCallback);
};

var loadLinkedCSS = function (link, options, successCallback, errorCallback) {
    var cssHref = link.attributes.href.nodeValue,
        documentBaseUrl = util.getDocumentBaseUrl(link.ownerDocument),
        ajaxOptions = util.clone(options);

    if (!ajaxOptions.baseUrl && documentBaseUrl) {
        ajaxOptions.baseUrl = documentBaseUrl;
    }

    var processStylesheet = memoizeFunctionOnCaching(requestStylesheetAndInlineResources, options);

    processStylesheet(cssHref, ajaxOptions, function (content, errors) {
        errors = util.cloneArray(errors);

        successCallback(content, errors);
    }, function () {
        errorCallback(util.joinUrl(ajaxOptions.baseUrl, cssHref));
    });
};

var getCssStylesheetLinks = function (doc) {
    var links = doc.getElementsByTagName("link");

    return Array.prototype.filter.call(links, function (link) {
        return link.attributes.rel && link.attributes.rel.nodeValue === "stylesheet" &&
            (!link.attributes.type || link.attributes.type.nodeValue === "text/css");
    });
};

module.exports.loadAndInlineCssLinks = function (doc, options, callback) {
    var params = util.parseOptionalParameters(options, callback),
        links = getCssStylesheetLinks(doc),
        errors = [];

    util.map(links, function (link, finish) {
        loadLinkedCSS(link, params.options, function(css, moreErrors) {
            substituteLinkWithInlineStyle(link, css + "\n");

            errors = errors.concat(moreErrors);
            finish();
        }, function (url) {
            errors.push({
                resourceType: "stylesheet",
                url: url,
                msg: "Unable to load stylesheet " + url
            });

            finish();
        });
    }, function () {
        if (params.callback) {
            params.callback(errors);
        }
    });
};

/* Script inlining */

var loadLinkedScript = function (script, options, successCallback, errorCallback) {
    var src = script.attributes.src.nodeValue,
        documentBase = util.getDocumentBaseUrl(script.ownerDocument),
        ajaxOptions = util.clone(options);

    if (!ajaxOptions.baseUrl && documentBase) {
        ajaxOptions.baseUrl = documentBase;
    }

    util.ajax(src, ajaxOptions, successCallback, function () {
        errorCallback(util.joinUrl(ajaxOptions.baseUrl, src));
    });
};

var escapeClosingTags = function (text) {
    // http://stackoverflow.com/questions/9246382/escaping-script-tag-inside-javascript
    return text.replace(/<\//g, '<\\/');
};

var substituteExternalScriptWithInline = function (scriptNode, jsCode) {
    scriptNode.attributes.removeNamedItem('src');
    scriptNode.textContent = escapeClosingTags(jsCode);
};

var getScripts = function (doc) {
    var scripts = doc.getElementsByTagName("script");

    return Array.prototype.filter.call(scripts, function (script) {
        return !!script.attributes.src;
    });
};

module.exports.loadAndInlineScript = function (doc, options, callback) {
    var params = util.parseOptionalParameters(options, callback),
        scripts = getScripts(doc),
        errors = [];

    util.map(scripts, function (script, finish) {
        loadLinkedScript(script, params.options, function (jsCode) {
            substituteExternalScriptWithInline(script, jsCode);

            finish();
        }, function (url) {
            errors.push({
                resourceType: "script",
                url: url,
                msg: "Unable to load script " + url
            });

            finish();
        });
    }, function () {
        if (params.callback) {
            params.callback(errors);
        }
    });
};

/* Main */

module.exports.inlineReferences = function (doc, options, callback) {
    var allErrors = [];

    module.exports.loadAndInlineImages(doc, options, function (errors) {
        allErrors = allErrors.concat(errors);
        module.exports.loadAndInlineStyles(doc, options, function (errors) {
            allErrors = allErrors.concat(errors);
            module.exports.loadAndInlineCssLinks(doc, options, function (errors) {
                allErrors = allErrors.concat(errors);

                if (options.inlineScripts === false) {
                    callback(allErrors);
                } else {
                    module.exports.loadAndInlineScript(doc, options, function (errors) {
                        allErrors = allErrors.concat(errors);

                        callback(allErrors);
                    });
                }
            });
        });
    });
};
