/*! rasterizeHTML.js - v0.6.0 - 2013-12-12
* http://www.github.com/cburgmer/rasterizeHTML.js
* Copyright (c) 2013 Christoph Burgmer; Licensed  */
!function(e){"object"==typeof exports?module.exports=e():"function"==typeof define&&define.amd?define(e):"undefined"!=typeof window?window.rasterizeHTML=e():"undefined"!=typeof global?global.rasterizeHTML=e():"undefined"!=typeof self&&(self.rasterizeHTML=e())}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

},{"./inlineCss":2,"./inlineUtil":3}],2:[function(require,module,exports){
"use strict";

var requireExternalDependencyWorkaround = require('./requireExternalDependencyWorkaround'),
    cssom = requireExternalDependencyWorkaround('cssom'),
    util = require('./inlineUtil');

var rulesForCssTextFromBrowser = function (styleContent) {
    var doc = document.implementation.createHTMLDocument(""),
        styleElement = document.createElement("style"),
        rules;

    styleElement.textContent = styleContent;
    // the style will only be parsed once it is added to a document
    doc.body.appendChild(styleElement);
    rules = styleElement.sheet.cssRules;

    return Array.prototype.slice.call(rules);
};

var browserHasBackgroundImageUrlIssue = (function () {
    // Checks for http://code.google.com/p/chromium/issues/detail?id=161644
    var rules = rulesForCssTextFromBrowser('a{background:url(i)}');
    return !rules.length || rules[0].cssText.indexOf('url()') >= 0;
}());

module.exports.rulesForCssText = function (styleContent) {
    if (browserHasBackgroundImageUrlIssue && cssom.parse) {
        return cssom.parse(styleContent).cssRules;
    } else {
        return rulesForCssTextFromBrowser(styleContent);
    }
};

var findBackgroundImageRules = function (cssRules) {
    return cssRules.filter(function (rule) {
        return rule.type === window.CSSRule.STYLE_RULE && (rule.style.getPropertyValue('background-image') || rule.style.getPropertyValue('background'));
    });
};

var findFontFaceRules = function (cssRules) {
    return cssRules.filter(function (rule) {
        return rule.type === window.CSSRule.FONT_FACE_RULE && rule.style.getPropertyValue("src");
    });
};

module.exports.cssRulesToText = function (cssRules) {
    return cssRules.reduce(function (cssText, rule) {
        return cssText + rule.cssText;
    }, '');
};

var unquoteString = function (quotedUrl) {
    var doubleQuoteRegex = /^"(.*)"$/,
        singleQuoteRegex = /^'(.*)'$/;

    if (doubleQuoteRegex.test(quotedUrl)) {
        return quotedUrl.replace(doubleQuoteRegex, "$1");
    } else {
        if (singleQuoteRegex.test(quotedUrl)) {
            return quotedUrl.replace(singleQuoteRegex, "$1");
        } else {
            return quotedUrl;
        }
    }
};

var trimCSSWhitespace = function (url) {
    var whitespaceRegex = /^[\t\r\f\n ]*(.+?)[\t\r\f\n ]*$/;

    return url.replace(whitespaceRegex, "$1");
};

module.exports.extractCssUrl = function (cssUrl) {
    var urlRegex = /^url\(([^\)]+)\)/,
        quotedUrl;

    if (!urlRegex.test(cssUrl)) {
        throw new Error("Invalid url");
    }

    quotedUrl = urlRegex.exec(cssUrl)[1];
    return unquoteString(trimCSSWhitespace(quotedUrl));
};

var findFontFaceFormat = function (value) {
    var fontFaceFormatRegex = /^format\(([^\)]+)\)/,
        quotedFormat;

    if (!fontFaceFormatRegex.test(value)) {
        return null;
    }

    quotedFormat = fontFaceFormatRegex.exec(value)[1];
    return unquoteString(quotedFormat);
};

var extractFontFaceSrcUrl = function (reference) {
    var url, format = null;

    try {
        url = module.exports.extractCssUrl(reference[0]);
        if (reference[1]) {
            format = findFontFaceFormat(reference[1]);
        }
        return {
            url: url,
            format: format
        };
    } catch (e) {}
};

var exchangeRule = function (cssRules, rule, newRuleText) {
    var ruleIdx = cssRules.indexOf(rule),
        styleSheet = rule.parentStyleSheet;

    // Generate a new rule
    styleSheet.insertRule(newRuleText, ruleIdx+1);
    styleSheet.deleteRule(ruleIdx);
    // Exchange with the new
    cssRules[ruleIdx] = styleSheet.cssRules[ruleIdx];
};

// Workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=443978
var changeFontFaceRuleSrc = function (cssRules, rule, newSrc) {
    var newRuleText = '@font-face { font-family: ' + rule.style.getPropertyValue("font-family") + '; ';

    if (rule.style.getPropertyValue("font-style")) {
        newRuleText += 'font-style: ' + rule.style.getPropertyValue("font-style") + '; ';
    }

    if (rule.style.getPropertyValue("font-weight")) {
        newRuleText += 'font-weight: ' + rule.style.getPropertyValue("font-weight") + '; ';
    }

    newRuleText += 'src: ' + newSrc + '}';
    exchangeRule(cssRules, rule, newRuleText);
};

var findCSSImportRules = function (cssRules) {
    return cssRules.filter(function (rule) {
        return rule.type === window.CSSRule.IMPORT_RULE && rule.href;
    });
};

var joinBackgroundDeclarations = function (valuesList) {
    var backgroundDeclarations = valuesList.map(function (values) {
        return values.join(' ');
    });
    return backgroundDeclarations.join(', ');
};

var sliceFontFaceSrcReferences = function (fontFaceSrc) {
    var functionParamRegexS = "\\s*(?:\"[^\"]*\"|'[^']*'|[^\\(]+)\\s*",
        referenceRegexS = "(local\\(" + functionParamRegexS + "\\))" + "|" +
                          "(url\\(" + functionParamRegexS + "\\))" + "(?:\\s+(format\\(" + functionParamRegexS + "\\)))?",
        simpleFontFaceSrcRegexS = "^\\s*(" + referenceRegexS + ")" +
                                  "(?:\\s*,\\s*(" + referenceRegexS + "))*" +
                                  "\\s*$",
        referenceRegex = new RegExp(referenceRegexS, "g"),
        repeatedMatch,
        fontFaceSrcReferences = [],
        getReferences = function (match) {
            var references = [];
            match.slice(1).forEach(function (elem) {
                if (elem) {
                    references.push(elem);
                }
            });
            return references;
        };

    if (fontFaceSrc.match(new RegExp(simpleFontFaceSrcRegexS))) {
        repeatedMatch = referenceRegex.exec(fontFaceSrc);
        while (repeatedMatch) {
            fontFaceSrcReferences.push(getReferences(repeatedMatch));
            repeatedMatch = referenceRegex.exec(fontFaceSrc);
        }
        return fontFaceSrcReferences;
    }
    return [];
};

var joinFontFaceSrcReferences = function (references) {
    var fontFaceReferences = [];
    references.forEach(function (reference) {
        fontFaceReferences.push(reference.join(' '));
    });
    return fontFaceReferences.join(', ');
};

var sliceBackgroundDeclarations = function (backgroundDeclarationText) {
    var functionParamRegexS = "\\s*(?:\"[^\"]*\"|'[^']*'|[^\\(]+)\\s*",
        valueRegexS = "(" + "url\\(" + functionParamRegexS + "\\)" + "|" + "[^,\\s]+" + ")",
        simpleSingularBackgroundRegexS = "(?:\\s*" + valueRegexS + ")+",
        simpleBackgroundRegexS = "^\\s*(" + simpleSingularBackgroundRegexS + ")" +
                                  "(?:\\s*,\\s*(" + simpleSingularBackgroundRegexS + "))*" +
                                  "\\s*$",
        simpleSingularBackgroundRegex = new RegExp(simpleSingularBackgroundRegexS, "g"),
        outerRepeatedMatch,
        backgroundDeclarations = [],
        getValues = function (singularBackgroundDeclaration) {
            var valueRegex = new RegExp(valueRegexS, "g"),
                backgroundValues = [],
                repeatedMatch;

            repeatedMatch = valueRegex.exec(singularBackgroundDeclaration);
            while (repeatedMatch) {
                backgroundValues.push(repeatedMatch[1]);
                repeatedMatch = valueRegex.exec(singularBackgroundDeclaration);
            }
            return backgroundValues;
        };

    if (backgroundDeclarationText.match(new RegExp(simpleBackgroundRegexS))) {
        outerRepeatedMatch = simpleSingularBackgroundRegex.exec(backgroundDeclarationText);
        while (outerRepeatedMatch) {
            backgroundDeclarations.push(getValues(outerRepeatedMatch[0]));
            outerRepeatedMatch = simpleSingularBackgroundRegex.exec(backgroundDeclarationText);
        }

        return backgroundDeclarations;
    }
    return [];
};

var findBackgroundImageUrlInValues = function (values) {
    var i, url;

    for(i = 0; i < values.length; i++) {
        try {
            url = module.exports.extractCssUrl(values[i]);
            return {
                url: url,
                idx: i
            };
        } catch (e) {}
    }
};

module.exports.adjustPathsOfCssResources = function (baseUrl, cssRules) {
    var change = false,
        joinedBackgroundDeclarations;

    findBackgroundImageRules(cssRules).forEach(function (rule) {
        var backgroundValue = rule.style.getPropertyValue('background-image') || rule.style.getPropertyValue('background'),
            backgroundDeclarations = sliceBackgroundDeclarations(backgroundValue),
            declarationChanged = false;

        backgroundDeclarations.forEach(function (singleBackgroundValues) {
            var bgUrl = findBackgroundImageUrlInValues(singleBackgroundValues),
                url;

            if (bgUrl && !util.isDataUri(bgUrl.url)) {
                url = util.joinUrl(baseUrl, bgUrl.url);
                singleBackgroundValues[bgUrl.idx] = 'url("' + url + '")';
                declarationChanged = true;
            }
        });

        joinedBackgroundDeclarations = joinBackgroundDeclarations(backgroundDeclarations);
        if (rule.style.getPropertyValue('background-image')) {
            rule.style.setProperty('background-image', joinedBackgroundDeclarations);
        } else {
            rule.style.setProperty('background', joinedBackgroundDeclarations);
        }
        change = change || declarationChanged;
    });
    findFontFaceRules(cssRules).forEach(function (rule) {
        var fontReferences = sliceFontFaceSrcReferences(rule.style.getPropertyValue("src")),
            declarationChanged = false;

        fontReferences.forEach(function (reference) {
            var fontSrc = extractFontFaceSrcUrl(reference),
                url;

            if (fontSrc && !util.isDataUri(fontSrc.url)) {
                url = util.joinUrl(baseUrl, fontSrc.url);
                reference[0] = 'url("' + url + '")';
                declarationChanged = true;
            }
        });

        if (declarationChanged) {
            changeFontFaceRuleSrc(cssRules, rule, joinFontFaceSrcReferences(fontReferences));
        }
        change = change || declarationChanged;
    });
    findCSSImportRules(cssRules).forEach(function (rule) {
        var cssUrl = rule.href,
            url = util.joinUrl(baseUrl, cssUrl);

        exchangeRule(cssRules, rule, "@import url(" + url + ");");

        change = true;
    });

    return change;
};

/* CSS import inlining */

var substituteRule = function (cssRules, rule, newCssRules) {
    var position = cssRules.indexOf(rule);

    cssRules.splice(position, 1);

    newCssRules.forEach(function (newRule, i) {
        cssRules.splice(position + i, 0, newRule);
    });
};

var isQuotedString = function (string) {
    var doubleQuoteRegex = /^"(.*)"$/,
        singleQuoteRegex = /^'(.*)'$/;

    return doubleQuoteRegex.test(string) || singleQuoteRegex.test(string);
};

var loadAndInlineCSSImport = function (cssRules, rule, alreadyLoadedCssUrls, options, successCallback, errorCallback) {
    var url = rule.href,
        cssHrefRelativeToDoc;

    if (isQuotedString(url)) {
        url = unquoteString(url);
    }

    cssHrefRelativeToDoc = util.joinUrl(options.baseUrl, url);

    if (alreadyLoadedCssUrls.indexOf(cssHrefRelativeToDoc) >= 0) {
        // Remove URL by adding empty string
        substituteRule(cssRules, rule, []);
        successCallback([]);
        return;
    } else {
        alreadyLoadedCssUrls.push(cssHrefRelativeToDoc);
    }

    util.ajax(url, options, function (cssText) {
        var externalCssRules = module.exports.rulesForCssText(cssText);

        // Recursively follow @import statements
        module.exports.loadCSSImportsForRules(externalCssRules, alreadyLoadedCssUrls, options, function (hasChanges, errors) {
            module.exports.adjustPathsOfCssResources(url, externalCssRules);

            substituteRule(cssRules, rule, externalCssRules);

            successCallback(errors);
        });
    }, function () {
        errorCallback(cssHrefRelativeToDoc);
    });
};

module.exports.loadCSSImportsForRules = function (cssRules, alreadyLoadedCssUrls, options, callback) {
    var errors = [],
        rulesToInline;

    rulesToInline = findCSSImportRules(cssRules);

    util.map(rulesToInline, function (rule, finish) {
        loadAndInlineCSSImport(cssRules, rule, alreadyLoadedCssUrls, options, function (moreErrors) {
            errors = errors.concat(moreErrors);

            finish(true);
        }, function (url) {
            errors.push({
                resourceType: "stylesheet",
                url: url,
                msg: "Unable to load stylesheet " + url
            });

            finish(false);
        });
    }, function (changeStatus) {
        var hasChanges = changeStatus.indexOf(true) >= 0;

        callback(hasChanges, errors);
    });
};

/* CSS linked resource inlining */

var loadAndInlineBackgroundImage = function (rule, options, callback) {
    var errorUrls = [],
        backgroundDeclarations,
        backgroundValue = rule.style.getPropertyValue('background-image') || rule.style.getPropertyValue('background'),
        joinedBackgroundDeclarations;

    backgroundDeclarations = sliceBackgroundDeclarations(backgroundValue);

    util.map(backgroundDeclarations, function (singleBackgroundValues, finish) {
        var bgUrl = findBackgroundImageUrlInValues(singleBackgroundValues);

        if (!bgUrl || util.isDataUri(bgUrl.url)) {
            finish(false);
            return;
        }

        util.getDataURIForImageURL(bgUrl.url, options, function (dataURI) {
            singleBackgroundValues[bgUrl.idx] = 'url("' + dataURI + '")';

            finish(true);
        }, function () {
            errorUrls.push(util.joinUrl(options.baseUrl, bgUrl.url));
            finish(false);
        });
    }, function (changedStates) {
        var changed = changedStates.indexOf(true) >= 0;

        if (changed) {
            joinedBackgroundDeclarations = joinBackgroundDeclarations(backgroundDeclarations);
            if (rule.style.getPropertyValue('background-image')) {
                rule.style.setProperty('background-image', joinedBackgroundDeclarations);
            } else {
                rule.style.setProperty('background', joinedBackgroundDeclarations);
            }
        }

        callback(changed, errorUrls);
    });
};

var iterateOverRulesAndInlineBackgroundImage = function (cssRules, options, callback) {
    var rulesToInline = findBackgroundImageRules(cssRules),
        errors = [],
        cssHasChanges;

    util.map(rulesToInline, function (rule, finish) {
        loadAndInlineBackgroundImage(rule, options, function (changed, errorUrls) {
            errorUrls.forEach(function (url) {
                errors.push({
                    resourceType: "backgroundImage",
                    url: url,
                    msg: "Unable to load background-image " + url
                });
            });
            finish(changed);
        });

    }, function (changedStates) {
        cssHasChanges = changedStates.indexOf(true) >= 0;
        callback(cssHasChanges, errors);
    });
};

var loadAndInlineFontFace = function (cssRules, rule, options, successCallback) {
    var fontReferences, fontSrc, format, base64Content,
        errors = [];

    fontReferences = sliceFontFaceSrcReferences(rule.style.getPropertyValue("src"));
    util.map(fontReferences, function (reference, finish) {
        fontSrc = extractFontFaceSrcUrl(reference);

        if (!fontSrc || util.isDataUri(fontSrc.url)) {
            finish(false);
            return;
        }

        format = fontSrc.format || "woff";

        util.binaryAjax(fontSrc.url, options, function (content) {
            base64Content = btoa(content);
            reference[0] = 'url("data:font/' + format + ';base64,' + base64Content + '")';

            finish(true);
        }, function () {
            errors.push(util.joinUrl(options.baseUrl, fontSrc.url));
            finish(false);
        });
    }, function (changedStates) {
        var changed = changedStates.indexOf(true) >= 0;

        if (changed) {
            changeFontFaceRuleSrc(cssRules, rule, joinFontFaceSrcReferences(fontReferences));
        }

        successCallback(changed, errors);
    });
};

var iterateOverRulesAndInlineFontFace = function (cssRules, options, callback) {
    var rulesToInline = findFontFaceRules(cssRules),
        errors = [],
        cssHasChanges;

    util.map(rulesToInline, function (rule, finish) {
        loadAndInlineFontFace(cssRules, rule, options, function (changed, errorUrls) {
            errorUrls.forEach(function (url) {
                errors.push({
                    resourceType: "fontFace",
                    url: url,
                    msg: "Unable to load font-face " + url
                });
            });
            finish(changed);
        });

    }, function (changedStates) {
        cssHasChanges = changedStates.indexOf(true) >= 0;
        callback(cssHasChanges, errors);
    });
};

module.exports.loadAndInlineCSSResourcesForRules = function (cssRules, options, callback) {
    iterateOverRulesAndInlineBackgroundImage(cssRules, options, function (bgImagesHaveChanges, bgImageErrors) {
        iterateOverRulesAndInlineFontFace(cssRules, options, function (fontsHaveChanges, fontFaceErrors) {
            var hasChanges = bgImagesHaveChanges || fontsHaveChanges;

            callback(hasChanges, bgImageErrors.concat(fontFaceErrors));
        });
    });
};

},{"./inlineUtil":3,"./requireExternalDependencyWorkaround":6}],3:[function(require,module,exports){
"use strict";

var requireExternalDependencyWorkaround = require('./requireExternalDependencyWorkaround'),
    url = requireExternalDependencyWorkaround('url');

module.exports.getDocumentBaseUrl = function (doc) {
    if (doc.baseURI !== 'about:blank') {
        return doc.baseURI;
    }

    return null;
};

module.exports.clone = function (object) {
    var theClone = {},
        i;
    for (i in object) {
        if (object.hasOwnProperty(i)) {
           theClone[i] = object[i];
        }
    }
    return theClone;
};

module.exports.cloneArray = function (nodeList) {
    return Array.prototype.slice.apply(nodeList, [0]);
};

module.exports.joinUrl = function (baseUrl, relUrl) {
    return url.resolve(baseUrl, relUrl);
};

module.exports.isDataUri = function (url) {
    return (/^data:/).test(url);
};

module.exports.map = function (list, func, callback) {
    var completedCount = 0,
        // Operating inline on array-like structures like document.getElementByTagName() (e.g. deleting a node),
        // will change the original list
        clonedList = module.exports.cloneArray(list),
        results = [],
        i;

    if (clonedList.length === 0) {
        callback(results);
    }

    var callForItem = function (idx) {
        function funcFinishCallback(result) {
            completedCount += 1;

            results[idx] = result;

            if (completedCount === clonedList.length) {
                callback(results);
            }
        }

        func(clonedList[idx], funcFinishCallback);
    };

    for(i = 0; i < clonedList.length; i++) {
        callForItem(i);
    }
};

var lastCacheDate = null;

var getUncachableURL = function (url, cache) {
    if (cache === false || cache === 'none' || cache === 'repeated') {
        if (lastCacheDate === null || cache !== 'repeated') {
            lastCacheDate = Date.now();
        }
        return url + "?_=" + lastCacheDate;
    } else {
        return url;
    }
};

module.exports.ajax = function (url, options, successCallback, errorCallback) {
    var ajaxRequest = new window.XMLHttpRequest(),
        joinedUrl = module.exports.joinUrl(options.baseUrl, url),
        augmentedUrl;

    augmentedUrl = getUncachableURL(joinedUrl, options.cache);

    ajaxRequest.addEventListener("load", function () {
        if (ajaxRequest.status === 200 || ajaxRequest.status === 0) {
            successCallback(ajaxRequest.response);
        } else {
            errorCallback();
        }
    }, false);

    ajaxRequest.addEventListener("error", function () {
        errorCallback();
    }, false);

    try {
        ajaxRequest.open('GET', augmentedUrl, true);
        ajaxRequest.overrideMimeType(options.mimeType);
        ajaxRequest.send(null);
    } catch (err) {
        errorCallback();
    }
};

module.exports.binaryAjax = function (url, options, successCallback, errorCallback) {
    var binaryContent = "",
        ajaxOptions = module.exports.clone(options);

    ajaxOptions.mimeType = 'text/plain; charset=x-user-defined';

    module.exports.ajax(url, ajaxOptions, function (content) {
        for (var i = 0; i < content.length; i++) {
            binaryContent += String.fromCharCode(content.charCodeAt(i) & 0xFF);
        }
        successCallback(binaryContent);
    }, errorCallback);
};

var detectMimeType = function (content) {
    var startsWith = function (string, substring) {
        return string.substring(0, substring.length) === substring;
    };

    if (startsWith(content, '<?xml') || startsWith(content, '<svg')) {
        return 'image/svg+xml';
    }
    return 'image/png';
};

module.exports.getDataURIForImageURL = function (url, options, successCallback, errorCallback) {
    var base64Content, mimeType;

    module.exports.binaryAjax(url, options, function (content) {
        base64Content = btoa(content);

        mimeType = detectMimeType(content);

        successCallback('data:' + mimeType + ';base64,' + base64Content);
    }, function () {
        errorCallback();
    });
};

var uniqueIdList = [];

var constantUniqueIdFor = function (element) {
    // HACK, using a list results in O(n), but how do we hash a function?
    if (uniqueIdList.indexOf(element) < 0) {
        uniqueIdList.push(element);
    }
    return uniqueIdList.indexOf(element);
};

module.exports.memoize = function (func, hasher, memo) {
    if (typeof memo !== "object") {
        throw new Error("cacheBucket is not an object");
    }

    return function () {
        var args = Array.prototype.slice.call(arguments),
            successCallback, errorCallback;

        if (args.length > 2 && typeof args[args.length-2] === 'function') {
             errorCallback = args.pop();
             successCallback = args.pop();
        } else {
            successCallback = args.pop();
        }

        var argumentHash = hasher(args),
            funcHash = constantUniqueIdFor(func),
            allArgs;

        if (memo[funcHash] && memo[funcHash][argumentHash]) {
            successCallback.apply(null, memo[funcHash][argumentHash]);
        } else {
            allArgs = args.concat(function () {
                memo[funcHash] = memo[funcHash] || {};
                memo[funcHash][argumentHash] = arguments;
                successCallback.apply(null, arguments);
            });
            if (errorCallback) {
                allArgs = allArgs.concat(errorCallback);
            }
            func.apply(null, allArgs);
        }
    };
};

var cloneObject = function(object) {
    var newObject = {},
        i;
    for (i in object) {
        if (object.hasOwnProperty(i)) {
            newObject[i] = object[i];
        }
    }
    return newObject;
};

var isFunction = function (func) {
    return typeof func === "function";
};

module.exports.parseOptionalParameters = function () { // args: options, callback
    var parameters = {
        options: {},
        callback: null
    };

    if (isFunction(arguments[0])) {
        parameters.callback = arguments[0];
    } else {
        parameters.options = cloneObject(arguments[0]);
        parameters.callback = arguments[1] || null;
    }

    return parameters;
};

},{"./requireExternalDependencyWorkaround":6}],4:[function(require,module,exports){
"use strict";

var render = require('../src/render'),
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

},{"../src/render":5,"./inline":1,"./inlineUtil":3,"./util":7}],5:[function(require,module,exports){
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

},{"./requireExternalDependencyWorkaround":6,"./util":7}],6:[function(require,module,exports){
// Work around https://github.com/ForbesLindesay/umd/issues/10
module.exports = function (name) {
    try {
        // Repetetive case by case import, to help browserify catching these imports
        if (name === 'cssom') {
            return require('cssom');
        }
        if (name === 'url') {
            return require('url');
        }
        if (name === 'xmlserializer') {
            return require('xmlserializer');
        }
    } catch (e) {
        if (typeof window !== 'undefined' && (window[name] || window[name.toUpperCase()])) {
            return window[name] || window[name.toUpperCase()];
        } else {
            throw e;
        }
    }
};

},{"cssom":false,"url":false,"xmlserializer":false}],7:[function(require,module,exports){
"use strict";

var util = require('./inlineUtil');

var uniqueIdList = [];

module.exports.getConstantUniqueIdFor = function (element) {
    // HACK, using a list results in O(n), but how do we hash e.g. a DOM node?
    if (uniqueIdList.indexOf(element) < 0) {
        uniqueIdList.push(element);
    }
    return uniqueIdList.indexOf(element);
};

var cloneObject = function(object) {
    var newObject = {},
        i;
    for (i in object) {
        if (object.hasOwnProperty(i)) {
            newObject[i] = object[i];
        }
    }
    return newObject;
};

var isObject = function (obj) {
    return typeof obj === "object" && obj !== null;
};

var isCanvas = function (obj) {
    return isObject(obj) &&
        Object.prototype.toString.apply(obj).match(/\[object (Canvas|HTMLCanvasElement)\]/i);
};

var isFunction = function (func) {
    return typeof func === "function";
};

module.exports.parseOptionalParameters = function (args) { // args: canvas, options, callback
    var parameters = {
        canvas: null,
        options: {},
        callback: null
    };

    if (isFunction(args[0])) {
        parameters.callback = args[0];
    } else {
        if (args[0] == null || isCanvas(args[0])) {
            parameters.canvas = args[0] || null;

            if (isFunction(args[1])) {
                parameters.callback = args[1];
            } else {
                parameters.options = cloneObject(args[1]);
                parameters.callback = args[2] || null;
            }

        } else {
            parameters.options = cloneObject(args[0]);
            parameters.callback = args[1] || null;
        }
    }

    return parameters;
};

var baseUrlRespectingXMLHttpRequestProxy = function (XHRObject, baseUrl) {
    return function () {
        var xhr = new XHRObject(),
            open = xhr.open;

        xhr.open = function () {
            var args = Array.prototype.slice.call(arguments),
                method = args.shift(),
                url = args.shift(),
                // TODO remove reference to rasterizeHTMLInline.util
                joinedUrl = util.joinUrl(baseUrl, url);

            return open.apply(this, [method, joinedUrl].concat(args));
        };

        return xhr;
    };
};

module.exports.createHiddenElement = function (doc, tagName) {
    var element = doc.createElement(tagName);
    // 'display: none' doesn't cut it, as browsers seem to be lazy loading CSS
    element.style.visibility = "hidden";
    element.style.width = "0px";
    element.style.height = "0px";
    element.style.position = "absolute";
    element.style.top = "-10000px";
    element.style.left = "-10000px";
    // We need to add the element to the document so that its content gets loaded
    doc.getElementsByTagName("body")[0].appendChild(element);
    return element;
};

module.exports.executeJavascript = function (doc, baseUrl, timeout, callback) {
    var iframe = module.exports.createHiddenElement(window.document, "iframe"),
        html = doc.documentElement.outerHTML,
        iframeErrorsMessages = [],
        doCallback = function () {
            var doc = iframe.contentDocument;
            window.document.getElementsByTagName("body")[0].removeChild(iframe);
            callback(doc, iframeErrorsMessages);
        };

    if (timeout > 0) {
        iframe.onload = function () {
            setTimeout(doCallback, timeout);
        };
    } else {
        iframe.onload = doCallback;
    }

    iframe.contentDocument.open();
    iframe.contentWindow.XMLHttpRequest = baseUrlRespectingXMLHttpRequestProxy(iframe.contentWindow.XMLHttpRequest, baseUrl);
    iframe.contentWindow.onerror = function (msg) {
        iframeErrorsMessages.push({
            resourceType: "scriptExecution",
            msg: msg
        });
    };

    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
};

var createHiddenSandboxedIFrame = function (doc, width, height) {
    var iframe = doc.createElement('iframe');
    iframe.style.width = width + "px";
    iframe.style.height = height + "px";
    // 'display: none' doesn't cut it, as browsers seem to be lazy loading content
    iframe.style.visibility = "hidden";
    iframe.style.position = "absolute";
    iframe.style.top = (-10000 - height) + "px";
    iframe.style.left = (-10000 - width) + "px";
    // Don't execute JS, all we need from sandboxing is access to the iframe's document
    iframe.sandbox = 'allow-same-origin';
    // We need to add the element to the document so that its content gets loaded
    doc.getElementsByTagName("body")[0].appendChild(iframe);
    return iframe;
};

module.exports.calculateDocumentContentSize = function (doc, viewportWidth, viewportHeight, callback) {
    var html = doc.documentElement.outerHTML,
        iframe = createHiddenSandboxedIFrame(window.document, viewportWidth, viewportHeight);

    iframe.onload = function () {
        var doc = iframe.contentDocument,
            // clientWidth/clientHeight needed for PhantomJS
            canvasWidth = Math.max(doc.documentElement.scrollWidth, doc.body.clientWidth),
            canvasHeight = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, doc.body.clientHeight);

        window.document.getElementsByTagName("body")[0].removeChild(iframe);
        callback(canvasWidth, canvasHeight);
    };

    // srcdoc doesn't work in PhantomJS yet
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
};

var addHTMLTagAttributes = function (doc, html) {
    var attributeMatch = /<html((?:\s+[^>]*)?)>/im.exec(html),
        helperDoc = window.document.implementation.createHTMLDocument(''),
        htmlTagSubstitute,
        i, elementSubstitute, attribute;

    if (!attributeMatch) {
        return;
    }

    htmlTagSubstitute = '<div' + attributeMatch[1] + '></div>';
    helperDoc.documentElement.innerHTML = htmlTagSubstitute;
    elementSubstitute = helperDoc.querySelector('div');

    for (i = 0; i < elementSubstitute.attributes.length; i++) {
        attribute = elementSubstitute.attributes[i];
        doc.documentElement.setAttribute(attribute.name, attribute.value);
    }
};

module.exports.parseHTML = function (html) {
    var doc;
    if ((new DOMParser()).parseFromString('<a></a>', 'text/html')) {
        doc = (new DOMParser()).parseFromString(html, 'text/html');
    } else {
        doc = window.document.implementation.createHTMLDocument('');
        doc.documentElement.innerHTML = html;

        addHTMLTagAttributes(doc, html);
    }
    return doc;
};

var lastCacheDate = null;

var getUncachableURL = function (url, cache) {
    if (cache === false || cache === 'none' || cache === 'repeated') {
        if (lastCacheDate === null || cache !== 'repeated') {
            lastCacheDate = Date.now();
        }
        return url + "?_=" + lastCacheDate;
    } else {
        return url;
    }
};

module.exports.loadDocument = function (url, options, successCallback, errorCallback) {
    var ajaxRequest = new window.XMLHttpRequest(),
        // TODO remove reference to rasterizeHTMLInline.util
        joinedUrl = util.joinUrl(options.baseUrl, url),
        augmentedUrl = getUncachableURL(joinedUrl, options.cache);

    ajaxRequest.addEventListener("load", function () {
        if (ajaxRequest.status === 200 || ajaxRequest.status === 0) {
            successCallback(ajaxRequest.responseXML);
        } else {
            errorCallback();
        }
    }, false);

    ajaxRequest.addEventListener("error", function () {
        errorCallback();
    }, false);

    try {
        ajaxRequest.open('GET', augmentedUrl, true);
        ajaxRequest.responseType = "document";
        ajaxRequest.send(null);
    } catch (err) {
        errorCallback();
    }
};

module.exports.addClassNameRecursively = function (element, className) {
    element.className += ' ' + className;

    if (element.parentNode !== element.ownerDocument) {
        module.exports.addClassNameRecursively(element.parentNode, className);
    }
};

var changeCssRule = function (rule, newRuleText) {
    var styleSheet = rule.parentStyleSheet,
        ruleIdx = Array.prototype.indexOf.call(styleSheet.cssRules, rule);

    // Exchange rule with the new text
    styleSheet.insertRule(newRuleText, ruleIdx+1);
    styleSheet.deleteRule(ruleIdx);
};

var updateRuleSelector = function (rule, updatedSelector) {
    var styleDefinitions = rule.cssText.replace(/^[^\{]+/, ''),
        newRule = updatedSelector + ' ' + styleDefinitions;

    changeCssRule(rule, newRule);
};

var cssRulesToText = function (cssRules) {
    return Array.prototype.reduce.call(cssRules, function (cssText, rule) {
        return cssText + rule.cssText;
    }, '');
};

var rewriteStyleContent = function (styleElement) {
    styleElement.textContent = cssRulesToText(styleElement.sheet.cssRules);
};

module.exports.rewriteStyleRuleSelector = function (doc, oldSelector, newSelector) {
    // Assume that oldSelector is always prepended with a ':' or '.' for now, so no special handling needed
    var oldSelectorRegExp = new RegExp(oldSelector + '(?=\\W|$)', 'g');

    Array.prototype.forEach.call(doc.querySelectorAll('style'), function (styleElement) {
        var matchingRules = Array.prototype.filter.call(styleElement.sheet.cssRules, function (rule) {
                return rule.selectorText && oldSelectorRegExp.test(rule.selectorText);
            });

        if (matchingRules.length) {
            matchingRules.forEach(function (rule) {
                var selector = rule.selectorText.replace(oldSelectorRegExp, newSelector);

                updateRuleSelector(rule, selector);
            });

            rewriteStyleContent(styleElement);
        }
    });
};

module.exports.fakeHover = function (doc, hoverSelector) {
    var elem = doc.querySelector(hoverSelector),
        fakeHoverClass = 'rasterizehtmlhover';
    if (! elem) {
        return;
    }

    module.exports.addClassNameRecursively(elem, fakeHoverClass);
    module.exports.rewriteStyleRuleSelector(doc, ':hover', '.' + fakeHoverClass);
};

module.exports.fakeActive = function (doc, activeSelector) {
    var elem = doc.querySelector(activeSelector),
        fakeActiveClass = 'rasterizehtmlactive';
    if (! elem) {
        return;
    }

    module.exports.addClassNameRecursively(elem, fakeActiveClass);
    module.exports.rewriteStyleRuleSelector(doc, ':active', '.' + fakeActiveClass);
};

module.exports.persistInputValues = function (doc) {
    var inputs = Array.prototype.slice.call(doc.querySelectorAll('input')),
        textareas = Array.prototype.slice.call(doc.querySelectorAll('textarea')),
        isCheckable = function (input) {
            return input.type === 'checkbox' || input.type === 'radio';
        };

    inputs.filter(isCheckable)
        .forEach(function (input) {
            if (input.checked) {
                input.setAttribute('checked', '');
            } else {
                input.removeAttribute('checked');
            }
        });

    inputs.filter(function (input) { return !isCheckable(input); })
        .forEach(function (input) {
            input.setAttribute('value', input.value);
        });

    textareas
        .forEach(function (textarea) {
            textarea.textContent = textarea.value;
        });
};

},{"./inlineUtil":3}]},{},[4])
(4)
});
;