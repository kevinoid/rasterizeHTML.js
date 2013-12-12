module.exports.readHTMLDocumentFixture = function (url, callback) {
    var fixtureUrl = jasmine.getFixtures().fixturesPath + url,
        xhr = new window.XMLHttpRequest();

    xhr.addEventListener("load", function () {
        if (xhr.status === 200 || xhr.status === 0) {
            callback(xhr.responseXML);
        }
    }, false);

    xhr.open('GET', fixtureUrl, true);
    xhr.responseType = "document";
    xhr.send(null);
};

module.exports.readDocumentFixture = function (url) {
    var doc,
        fixtureUrl = jasmine.getFixtures().fixturesPath + url;

    $.ajax({
        dataType: 'xml',
        mimeType: 'text/xml',
        url: fixtureUrl,
        async: false,
        cache: false,
        success: function (content) {
            doc = content;
        }
    });

    return doc;
};

module.exports.readFixturesOrFail = function (url) {
    var fixtureUrl = jasmine.getFixtures().fixturesPath + url,
        content;

    $.ajax({
        dataType: 'text',
        url: fixtureUrl,
        async: false,
        cache: false,
        success: function (theContent) {
            content = theContent;
        },
        error: function () {
            throw "unable to read fixture";
        }
    });

    return content;
};

module.exports.readDocumentFixtureWithoutBaseURI = function (url) {
    var html = readFixtures(url),
        doc = document.implementation.createHTMLDocument("");

    doc.documentElement.innerHTML = html;
    return doc;
};

module.exports.getLocalDocumentImage = function (image, finishHandler) {
    var img = new window.Image();

    img.onload = function () {
        finishHandler(img);
    };
    img.src = image.attributes.src.nodeValue; // Chrome 19 sets image.src to ""
};

module.exports.compareImageToReference = function (image, referenceImageId) {
    var localImg = null;

    // Gecko & Webkit won't allow direct comparison of images, need to get local first
    runs(function () {
        module.exports.getLocalDocumentImage(image, function (img) { localImg = img; });
    });

    waitsFor(function () {
        return localImg !== null;
    }, "Move of image to local", 200);

    runs(function () {
        expect(localImg).toImageDiffEqual(window.document.getElementById(referenceImageId));
    });
};

module.exports.getBaseUri = function () {
    // Strip of file part
    return document.baseURI.replace(/\/[^\/]*$/, "/");
};

module.exports.addStyleToDocument = function (doc, styleContent) {
    var styleNode = doc.createElement("style");

    styleNode.type = "text/css";
    styleNode.appendChild(doc.createTextNode(styleContent));

    doc.getElementsByTagName('head')[0].appendChild(styleNode);
};
