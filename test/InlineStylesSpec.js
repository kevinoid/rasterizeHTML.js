var rasterizeHTMLInline = require('../src/inline'),
    inlineCss = require('../src/inlineCss'),
    inlineUtil = require('../src/inlineUtil'),
    testHelper = require('./testHelper');

describe("Import styles", function () {
    var doc, loadCSSImportsForRulesSpy, loadAndInlineCSSResourcesForRulesSpy, callback;

    beforeEach(function () {
        doc = document.implementation.createHTMLDocument("");

        loadCSSImportsForRulesSpy = spyOn(inlineCss, 'loadCSSImportsForRules').andCallFake(function (cssRules, alreadyLoadedCssUrls, options, callback) {
            callback(false, []);
        });
        loadAndInlineCSSResourcesForRulesSpy = spyOn(inlineCss, 'loadAndInlineCSSResourcesForRules').andCallFake(function (cssRules, options, callback) {
            callback(false, []);
        });
        spyOn(inlineUtil, 'clone').andCallFake(function (object) {
            return object;
        });

        callback = jasmine.createSpy("callback");
    });

    it("should do nothing if no CSS is found", function () {
        rasterizeHTMLInline.loadAndInlineStyles(doc, callback);

        expect(callback).toHaveBeenCalled();

        expect(loadCSSImportsForRulesSpy).not.toHaveBeenCalled();
    });

    it("should not touch unrelated CSS", function () {
        testHelper.addStyleToDocument(doc, "span { padding-left: 0; }");

        loadCSSImportsForRulesSpy.andCallFake(function(rules, includedList, options, callback) {
            rules[0] = "fake rule";
            callback(false, []);
        });
        loadAndInlineCSSResourcesForRulesSpy.andCallFake(function(rules, options, callback) {
            rules[0] = "something else";
            callback(false, []);
        });

        rasterizeHTMLInline.loadAndInlineStyles(doc, callback);

        expect(callback).toHaveBeenCalled();

        expect(doc.head.getElementsByTagName("style")[0].textContent).toEqual("span { padding-left: 0; }");
    });

    it("should replace an import with the content of the given URL", function () {
        testHelper.addStyleToDocument(doc, '@import url("that.css");');

        rasterizeHTMLInline.loadAndInlineStyles(doc, callback);

        expect(loadCSSImportsForRulesSpy).toHaveBeenCalled();
        expect(loadCSSImportsForRulesSpy.mostRecentCall.args[0][0].cssText).toMatch(/@import url\("?that.css"?\)\s*;/);
    });

    it("should inline css resources", function () {
        testHelper.addStyleToDocument(doc, 'span { background-image: url("anImage.png"); }');

        rasterizeHTMLInline.loadAndInlineStyles(doc, callback);

        expect(loadAndInlineCSSResourcesForRulesSpy).toHaveBeenCalled();
        expect(loadAndInlineCSSResourcesForRulesSpy.mostRecentCall.args[0][0].cssText).toMatch(/span \{\s*background-image: url\("?anImage.png"?\)\s*;\s*\}/);
    });

    it("should accept a style element without a type", function () {
        var styleNode = doc.createElement("style");

        styleNode.appendChild(doc.createTextNode('@import url("imported.css");'));
        doc.head.appendChild(styleNode);

        rasterizeHTMLInline.loadAndInlineStyles(doc, callback);

        expect(loadCSSImportsForRulesSpy).toHaveBeenCalled();
        expect(loadAndInlineCSSResourcesForRulesSpy).toHaveBeenCalled();
    });

    it("should ignore a style element with a non CSS type", function () {
        var styleNode = doc.createElement("style");
        styleNode.type = "text/plain";

        styleNode.appendChild(doc.createTextNode('@import url("imported.css");'));
        doc.head.appendChild(styleNode);

        rasterizeHTMLInline.loadAndInlineStyles(doc, callback);

        expect(loadCSSImportsForRulesSpy).not.toHaveBeenCalled();
        expect(loadAndInlineCSSResourcesForRulesSpy).not.toHaveBeenCalled();
    });

    it("should respect the document's baseURI", function () {
        var getDocumentBaseUrlSpy = spyOn(inlineUtil, 'getDocumentBaseUrl').andCallThrough();
        doc = testHelper.readDocumentFixture("importCss.html");

        rasterizeHTMLInline.loadAndInlineStyles(doc, callback);

        expect(loadCSSImportsForRulesSpy).toHaveBeenCalledWith(jasmine.any(Object), [], {baseUrl: doc.baseURI}, jasmine.any(Function));
        expect(loadAndInlineCSSResourcesForRulesSpy).toHaveBeenCalledWith(jasmine.any(Object), {baseUrl: doc.baseURI}, jasmine.any(Function));
        expect(getDocumentBaseUrlSpy).toHaveBeenCalledWith(doc);
    });

    it("should favour explicit baseUrl over document.baseURI", function () {
        var baseUrl = "aBaseURI";

        doc = testHelper.readDocumentFixture("importCss.html");

        expect(doc.baseURI).not.toBeNull();
        expect(doc.baseURI).not.toEqual("about:blank");
        expect(doc.baseURI).not.toEqual(baseUrl);

        rasterizeHTMLInline.loadAndInlineStyles(doc, {baseUrl: baseUrl}, callback);

        expect(loadCSSImportsForRulesSpy).toHaveBeenCalledWith(jasmine.any(Object), [], {baseUrl: baseUrl}, jasmine.any(Function));
        expect(loadAndInlineCSSResourcesForRulesSpy).toHaveBeenCalledWith(jasmine.any(Object), {baseUrl: baseUrl}, jasmine.any(Function));
    });

    it("should circumvent caching if requested", function () {
        testHelper.addStyleToDocument(doc, '@import url("that.css");');

        rasterizeHTMLInline.loadAndInlineStyles(doc, {cache: 'none'}, callback);

        expect(loadCSSImportsForRulesSpy).toHaveBeenCalled();
        expect(loadCSSImportsForRulesSpy.mostRecentCall.args[2].cache).toEqual('none');
        expect(loadAndInlineCSSResourcesForRulesSpy).toHaveBeenCalled();
        expect(loadAndInlineCSSResourcesForRulesSpy.mostRecentCall.args[1].cache).toEqual('none');
    });

    it("should not circumvent caching by default", function () {
        testHelper.addStyleToDocument(doc, '@import url("that.css");');

        rasterizeHTMLInline.loadAndInlineStyles(doc, callback);

        expect(loadCSSImportsForRulesSpy).toHaveBeenCalled();
        expect(loadCSSImportsForRulesSpy.mostRecentCall.args[2]).toBeTruthy();
        expect(loadAndInlineCSSResourcesForRulesSpy).toHaveBeenCalled();
        expect(loadAndInlineCSSResourcesForRulesSpy.mostRecentCall.args[1].cache).not.toBe(false);
    });

    it("should cache inlined content if a cache bucket is given", function () {
        var cacheBucket = {};

        loadAndInlineCSSResourcesForRulesSpy.andCallFake(function (cssRules, options, callback) {
            callback(true, [{
                cssText: 'background-image { }'
            }]);
        });

        // first call
        doc = document.implementation.createHTMLDocument("");
        testHelper.addStyleToDocument(doc, 'background-image { url(anImage.png); }');

        rasterizeHTMLInline.loadAndInlineStyles(doc, {cacheBucket: cacheBucket}, callback);
        expect(loadCSSImportsForRulesSpy).toHaveBeenCalled();

        loadCSSImportsForRulesSpy.reset();
        loadAndInlineCSSResourcesForRulesSpy.reset();

        // second call
        doc = document.implementation.createHTMLDocument("");
        testHelper.addStyleToDocument(doc, 'background-image { url(anImage.png); }');

        rasterizeHTMLInline.loadAndInlineStyles(doc, {cacheBucket: cacheBucket}, callback);

        expect(loadCSSImportsForRulesSpy).not.toHaveBeenCalled();
        expect(loadAndInlineCSSResourcesForRulesSpy).not.toHaveBeenCalled();

        expect(doc.getElementsByTagName("style")[0].textContent).toMatch(/background-image\s*{\s*}/);
    });

    it("should not use cache inlined content if the documents' URLs don't match", function () {
        var cacheBucket = {};

        loadAndInlineCSSResourcesForRulesSpy.andCallFake(function (cssRules, options, callback) {
            callback(true, [{
                cssText: 'background-image { }'
            }]);
        });

        // first call
        doc = document.implementation.createHTMLDocument("");
        testHelper.addStyleToDocument(doc, 'background-image { url(anImage.png); }');

        rasterizeHTMLInline.loadAndInlineStyles(doc, {cacheBucket: cacheBucket}, callback);
        expect(loadCSSImportsForRulesSpy).toHaveBeenCalled();

        loadCSSImportsForRulesSpy.reset();
        loadAndInlineCSSResourcesForRulesSpy.reset();

        // second call
        doc = testHelper.readDocumentFixture("image.html"); // use a document with different baseUrl
        testHelper.addStyleToDocument(doc, 'background-image { url(anImage.png); }');

        rasterizeHTMLInline.loadAndInlineStyles(doc, {cacheBucket: cacheBucket}, callback);

        expect(loadCSSImportsForRulesSpy).toHaveBeenCalled();
        expect(loadAndInlineCSSResourcesForRulesSpy).toHaveBeenCalled();
    });

    it("should not cache inlined content if caching turned off", function () {
        var cacheBucket = {};

        // first call
        doc = document.implementation.createHTMLDocument("");
        testHelper.addStyleToDocument(doc, 'background-image { url(anImage.png); }');

        rasterizeHTMLInline.loadAndInlineStyles(doc, {cacheBucket: cacheBucket, cache: 'none'}, callback);
        expect(loadCSSImportsForRulesSpy).toHaveBeenCalled();

        loadCSSImportsForRulesSpy.reset();

        // second call
        doc = document.implementation.createHTMLDocument("");
        testHelper.addStyleToDocument(doc, 'background-image { url(anImage.png); }');

        rasterizeHTMLInline.loadAndInlineStyles(doc, {cacheBucket: cacheBucket, cache: 'none'}, callback);

        expect(loadCSSImportsForRulesSpy).toHaveBeenCalled();
    });

    describe("error handling", function () {

        it("should report errors", function () {
            loadCSSImportsForRulesSpy.andCallFake(function(rules, includedList, options, callback) {
                callback(false, ['import error']);
            });
            loadAndInlineCSSResourcesForRulesSpy.andCallFake(function (cssRules, options, callback) {
                callback(false, ['resource error']);
            });

            testHelper.addStyleToDocument(doc, '@import url("that.css");');

            rasterizeHTMLInline.loadAndInlineStyles(doc, callback);

            expect(callback).toHaveBeenCalledWith(['import error', 'resource error']);
        });

        it("should cache errors alongside if a cache bucket is given", function () {
            var cacheBucket = {};

            loadCSSImportsForRulesSpy.andCallFake(function(rules, includedList, options, callback) {
                callback(false, ['import error']);
            });

            // first call
            doc = document.implementation.createHTMLDocument("");
            testHelper.addStyleToDocument(doc, '@import url("that.css");');

            rasterizeHTMLInline.loadAndInlineStyles(doc, {cacheBucket: cacheBucket}, function () {});

            // second call
            doc = document.implementation.createHTMLDocument("");
            testHelper.addStyleToDocument(doc, '@import url("that.css");');

            rasterizeHTMLInline.loadAndInlineStyles(doc, {cacheBucket: cacheBucket}, callback);

            expect(callback).toHaveBeenCalledWith(["import error"]);
        });
    });
});
