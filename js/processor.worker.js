/* NegaToPos image pipeline — runs off the main thread. */

'use strict';

function clamp8(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
}

function edgeMarginPx(w, h) {
    return Math.max(2, Math.floor(Math.min(w, h) * 0.05));
}

/** Histogram median of inverted edge pixels for one channel (0=R,1=G,2=B). */
function edgeInvertedMedian(src, w, h, channel) {
    const hist = new Uint32Array(256);
    let count = 0;
    const m = edgeMarginPx(w, h);

    const sample = (x, y) => {
        const idx = (y * w + x) * 4 + channel;
        hist[255 - src[idx]]++;
        count++;
    };

    for (let x = 0; x < w; x++) {
        for (let y = 0; y < m; y++) sample(x, y);
        for (let y = h - m; y < h; y++) sample(x, y);
    }
    for (let y = m; y < h - m; y++) {
        for (let x = 0; x < m; x++) sample(x, y);
        for (let x = w - m; x < w; x++) sample(x, y);
    }

    if (count === 0) return 128;
    const target = count / 2;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
        acc += hist[i];
        if (acc >= target) return i;
    }
    return 255;
}

function computeEdgeWB(src, w, h) {
    const edgeR = edgeInvertedMedian(src, w, h, 0);
    const edgeG = edgeInvertedMedian(src, w, h, 1);
    const edgeB = edgeInvertedMedian(src, w, h, 2);
    const edgeMax = Math.max(edgeR, edgeG, edgeB, 1);
    return {
        rScale: edgeMax / Math.max(edgeR, 1),
        gScale: edgeMax / Math.max(edgeG, 1),
        bScale: edgeMax / Math.max(edgeB, 1)
    };
}

function findPercentile(hist, total, percentile) {
    const target = Math.floor(total * percentile);
    let count = 0;
    for (let i = 0; i < 256; i++) {
        count += hist[i];
        if (count >= target) return i;
    }
    return 255;
}

function computeLevels(work, pixelCount, isColor) {
    const histR = new Uint32Array(256);
    const histG = new Uint32Array(256);
    const histB = new Uint32Array(256);
    const histL = new Uint32Array(256);

    for (let i = 0; i < work.length; i += 4) {
        const r = work[i];
        const g = work[i + 1];
        const b = work[i + 2];
        histR[r]++;
        histG[g]++;
        histB[b]++;
        const lum = clamp8(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
        histL[lum]++;
    }

    if (isColor) {
        return {
            rBlack: findPercentile(histR, pixelCount, 0.005),
            gBlack: findPercentile(histG, pixelCount, 0.005),
            bBlack: findPercentile(histB, pixelCount, 0.005),
            rWhite: findPercentile(histR, pixelCount, 0.995),
            gWhite: findPercentile(histG, pixelCount, 0.995),
            bWhite: findPercentile(histB, pixelCount, 0.995)
        };
    }

    const black = findPercentile(histL, pixelCount, 0.005);
    const white = findPercentile(histL, pixelCount, 0.995);
    return {
        rBlack: black,
        gBlack: black,
        bBlack: black,
        rWhite: white,
        gWhite: white,
        bWhite: white
    };
}

function stretch(v, black, white) {
    const range = Math.max(1, white - black);
    return ((v - black) / range) * 255;
}

/**
 * Pipeline:
 * 1) Invert
 * 2) Optional white-balance (color)
 * 3) Optional percentile levels (computed after WB — fixes prior LUT mismatch)
 * 4) User tone controls
 */
function processNegative(srcBuffer, width, height, options) {
    const src = new Uint8ClampedArray(srcBuffer);
    const pixelCount = width * height;
    const isColor = options.filmType === 'color';
    const autoCorrect = !!options.autoCorrect;
    const settings = options.settings || {};

    let wb = { rScale: 1, gScale: 1, bScale: 1 };
    if (autoCorrect && isColor) {
        wb = options.eyedropperWB || computeEdgeWB(src, width, height);
    }

    const work = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
        let r = 255 - src[i];
        let g = 255 - src[i + 1];
        let b = 255 - src[i + 2];

        if (autoCorrect && isColor) {
            r *= wb.rScale;
            g *= wb.gScale;
            b *= wb.bScale;
        }

        work[i] = clamp8(Math.round(r));
        work[i + 1] = clamp8(Math.round(g));
        work[i + 2] = clamp8(Math.round(b));
        work[i + 3] = src[i + 3];
    }

    const levels = autoCorrect
        ? computeLevels(work, pixelCount, isColor)
        : {
            rBlack: 0, gBlack: 0, bBlack: 0,
            rWhite: 255, gWhite: 255, bWhite: 255
        };

    const brightness = settings.brightness || 0;
    const contrast = (settings.contrast || 0) / 100;
    const contrastFactor = 1 + contrast;
    const saturation = 1 + (settings.saturation || 0) / 100;
    const temperature = settings.temperature || 0;
    const gamma = (settings.gamma || 100) / 100;
    const invGamma = gamma !== 1 ? 1 / gamma : 1;

    const out = new Uint8ClampedArray(src.length);

    for (let i = 0; i < work.length; i += 4) {
        let r = work[i];
        let g = work[i + 1];
        let b = work[i + 2];

        if (autoCorrect) {
            r = stretch(r, levels.rBlack, levels.rWhite);
            g = stretch(g, levels.gBlack, levels.gWhite);
            b = stretch(b, levels.bBlack, levels.bWhite);
        }

        if (gamma !== 1) {
            r = 255 * Math.pow(Math.max(0, r) / 255, invGamma);
            g = 255 * Math.pow(Math.max(0, g) / 255, invGamma);
            b = 255 * Math.pow(Math.max(0, b) / 255, invGamma);
        }

        if (brightness !== 0) {
            r += brightness;
            g += brightness;
            b += brightness;
        }

        if (contrast !== 0) {
            r = (r - 128) * contrastFactor + 128;
            g = (g - 128) * contrastFactor + 128;
            b = (b - 128) * contrastFactor + 128;
        }

        if (temperature !== 0) {
            r += temperature * 0.5;
            b -= temperature * 0.5;
        }

        if (isColor && saturation !== 1) {
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            r = gray + saturation * (r - gray);
            g = gray + saturation * (g - gray);
            b = gray + saturation * (b - gray);
        }

        if (!isColor) {
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            r = g = b = lum;
        }

        out[i] = clamp8(Math.round(r));
        out[i + 1] = clamp8(Math.round(g));
        out[i + 2] = clamp8(Math.round(b));
        out[i + 3] = work[i + 3];
    }

    return {
        buffer: out.buffer,
        width,
        height,
        wb
    };
}

self.onmessage = (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'process') return;

    try {
        const result = processNegative(
            msg.buffer,
            msg.width,
            msg.height,
            msg.options || {}
        );

        self.postMessage(
            {
                type: 'result',
                requestId: msg.requestId,
                buffer: result.buffer,
                width: result.width,
                height: result.height,
                wb: result.wb
            },
            [result.buffer]
        );
    } catch (err) {
        self.postMessage({
            type: 'error',
            requestId: msg.requestId,
            message: err && err.message ? err.message : 'İşleme hatası'
        });
    }
};
