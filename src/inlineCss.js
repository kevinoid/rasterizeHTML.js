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
