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
