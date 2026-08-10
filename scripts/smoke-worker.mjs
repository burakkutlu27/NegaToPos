/**
 * Headless smoke test for processor.worker.js pipeline (Node 22+).
 * Creates a synthetic orange-mask negative and asserts a finite RGB result.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'js/processor.worker.js'), 'utf8');

// Adapt web-worker source for node worker_threads
const adapted = `
const { parentPort } = require('worker_threads');
const self = {
  onmessage: null,
  postMessage(msg, _transfer) { parentPort.postMessage(msg); }
};
parentPort.on('message', (data) => {
  if (typeof self.onmessage === 'function') self.onmessage({ data });
});
${source}
`;

const tmp = join(tmpdir(), `negatopos-smoke-${Date.now()}.cjs`);
writeFileSync(tmp, adapted);

function makeNegative(w, h) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const edge = x < 10 || x > w - 11 || y < 10 || y > h - 11;
            if (edge) {
                data[i] = 210;
                data[i + 1] = 130;
                data[i + 2] = 55;
            } else {
                data[i] = 70;
                data[i + 1] = 95;
                data[i + 2] = 150;
            }
            data[i + 3] = 255;
        }
    }
    return { data, width: w, height: h };
}

const img = makeNegative(160, 120);

const worker = new Worker(tmp);
const requestId = 1;

const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 5000);
    worker.on('message', (msg) => {
        clearTimeout(timer);
        resolve(msg);
    });
    worker.on('error', reject);
    worker.postMessage({
        type: 'process',
        requestId,
        buffer: img.data.buffer.slice(0),
        width: img.width,
        height: img.height,
        options: {
            filmType: 'color',
            autoCorrect: true,
            settings: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, gamma: 100 }
        }
    });
});

await worker.terminate();
try { unlinkSync(tmp); } catch { /* ignore */ }

if (result.type !== 'result') {
    console.error('FAIL', result);
    process.exit(1);
}

const out = new Uint8ClampedArray(result.buffer);
let sum = 0;
for (let i = 0; i < out.length; i += 4) sum += out[i] + out[i + 1] + out[i + 2];
const avg = sum / (img.width * img.height * 3);

console.log('wb', result.wb);
console.log('avgChannel', avg.toFixed(2));
console.log('PASS_SMOKE', Number.isFinite(avg) && avg > 0 && out.length === img.data.length);
if (!(Number.isFinite(avg) && avg > 0)) process.exit(1);
