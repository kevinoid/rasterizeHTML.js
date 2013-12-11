"use strict";

var requireExternalDependencyWorkaround = require('./requireExternalDependencyWorkaround'),
    xmlserializer = requireExternalDependencyWorkaround('xmlserializer'),
    util = require('./inlineUtil'),
    rasterizeHTMLInline = require('./inline');

/* Utilities */

var uniqueIdList = [];

module.exports.util = {};

module.exports.util.getConstantUniqueIdFor = function (element) {
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

module.exports.util.parseOptionalParameters = function (args) { // args: canvas, options, callback
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

var createHiddenElement = function (doc, tagName) {
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

var getOrCreateHiddenDivWithId = function (doc, id) {
    var div = doc.getElementById(id);
    if (! div) {
        div = createHiddenElement(doc, "div");
        div.id = id;
    }

    return div;
};

module.exports.util.executeJavascript = function (doc, baseUrl, timeout, callback) {
    var iframe = createHiddenElement(window.document, "iframe"),
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

module.exports.util.calculateDocumentContentSize = function (doc, viewportWidth, viewportHeight, callback) {
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

module.exports.util.parseHTML = function (html) {
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

module.exports.util.loadDocument = function (url, options, successCallback, errorCallback) {
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

/* Rendering */

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

var workAroundBrowserBugForBackgroundImages = function (svg, canvas) {
    // Firefox < 17, Chrome & Safari will (sometimes) not show an inlined background-image until the svg is
    // connected to the DOM it seems.
    var uniqueId = module.exports.util.getConstantUniqueIdFor(svg),
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
    var uniqueId = module.exports.util.getConstantUniqueIdFor(svg),
        doc = canvas ? canvas.ownerDocument : window.document,
        div = doc.getElementById(WORKAROUND_ID + uniqueId);
    if (div) {
        div.parentNode.removeChild(div);
    }
};

module.exports.util.addClassNameRecursively = function (element, className) {
    element.className += ' ' + className;

    if (element.parentNode !== element.ownerDocument) {
        module.exports.util.addClassNameRecursively(element.parentNode, className);
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

module.exports.util.rewriteStyleRuleSelector = function (doc, oldSelector, newSelector) {
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

module.exports.util.fakeHover = function (doc, hoverSelector) {
    var elem = doc.querySelector(hoverSelector),
        fakeHoverClass = 'rasterizehtmlhover';
    if (! elem) {
        return;
    }

    module.exports.util.addClassNameRecursively(elem, fakeHoverClass);
    module.exports.util.rewriteStyleRuleSelector(doc, ':hover', '.' + fakeHoverClass);
};

module.exports.util.fakeActive = function (doc, activeSelector) {
    var elem = doc.querySelector(activeSelector),
        fakeActiveClass = 'rasterizehtmlactive';
    if (! elem) {
        return;
    }

    module.exports.util.addClassNameRecursively(elem, fakeActiveClass);
    module.exports.util.rewriteStyleRuleSelector(doc, ':active', '.' + fakeActiveClass);
};

module.exports.util.persistInputValues = function (doc) {
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
        module.exports.util.fakeHover(doc, options.hover);
    }
    if (options.active) {
        module.exports.util.fakeActive(doc, options.active);
    }

    module.exports.util.calculateDocumentContentSize(doc, viewportSize.width, viewportSize.height, function (width, height) {
        var svg = module.exports.getSvgForDocument(doc, width, height);

        module.exports.renderSvg(svg, canvas, function (image) {
            successCallback(image);
        }, errorCallback);
    });
};

/* "Public" API */

var doDraw = function (doc, canvas, options, callback, allErrors) {
    var handleInternalError = function (errors) {
            errors.push({
                resourceType: "document",
                msg: "Error rendering page"
            });
        };

    module.exports.drawDocumentImage(doc, canvas, options, function (image) {
        var successful;

        if (canvas) {
            successful = module.exports.drawImageOnCanvas(image, canvas);

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

    inlineOptions = util.clone(options);
    inlineOptions.inlineScripts = options.executeJs === true;

    rasterizeHTMLInline.inlineReferences(doc, inlineOptions, function (allErrors) {
        if (options.executeJs) {
            module.exports.util.executeJavascript(doc, options.baseUrl, executeJsTimeout, function (doc, errors) {
                module.exports.util.persistInputValues(doc);

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
        params = module.exports.util.parseOptionalParameters(optionalArguments);

    drawDocument(doc, params.canvas, params.options, params.callback);
};

var drawHTML = function (html, canvas, options, callback) {
    var doc = module.exports.util.parseHTML(html);

    module.exports.drawDocument(doc, canvas, options, callback);
};

/**
 * Draws a HTML string to the canvas.
 * rasterizeHTML.drawHTML( html [, canvas] [, options] [, callback] );
 */
module.exports.drawHTML = function () {
    var html = arguments[0],
        optionalArguments = Array.prototype.slice.call(arguments, 1),
        params = module.exports.util.parseOptionalParameters(optionalArguments);

    drawHTML(html, params.canvas, params.options, params.callback);
};

var drawURL = function (url, canvas, options, callback) {
    module.exports.util.loadDocument(url, options, function (doc) {
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
        params = module.exports.util.parseOptionalParameters(optionalArguments);

    drawURL(url, params.canvas, params.options, params.callback);
};
