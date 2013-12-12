// Wrap helper in UMD as it is loaded both in test cases and inside a PhantomJS window
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(factory);
    } else if (typeof exports === 'object') {
        module.exports = factory();
    } else {
        root.diffHelper = factory();
    }
}(this, function () {
    var module = {};

    // Work around https://github.com/HumbleSoftware/js-imagediff/issues/18
    module.imageEquals = function (a, b, tolerancePercentage) {
        var aData = imagediff.toImageData(a).data,
            bData = imagediff.toImageData(b).data,
            length = aData.length,
            sumDifferences = 0,
            i;

        tolerancePercentage = tolerancePercentage || 0;

        for (i = 0; i < length; i++) {
            sumDifferences += Math.abs(aData[i] - bData[i]);
        };

        return sumDifferences / (255 * length) <= tolerancePercentage / 100;
    };

    module.matcher = {
        toEqualImage: function (expected, tolerancePercentage) {
            return module.imageEquals(this.actual, expected, tolerancePercentage);
        }
    };

    return module;
}));
