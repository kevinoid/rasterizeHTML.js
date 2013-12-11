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
