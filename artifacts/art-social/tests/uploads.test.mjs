import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/api.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '').replaceAll('import.meta.env.BASE_URL', '"/"');

function harness(status = 200) {
  const calls = [];
  const uploads = [];
  const context = vm.createContext({
    Headers, FormData, URLSearchParams,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => url.endsWith('request-url')
        ? { uploadURL: 'https://storage.invalid/signed-test', assetId: 'asset' }
        : { assetId: 'asset', mediaUrl: '/api/media/asset' } };
    },
    XMLHttpRequest: class {
      upload = {};
      status = status;
      open(method, url) { uploads.push({ method, url }); }
      setRequestHeader(name, value) { uploads[0][name] = value; }
      send(file) {
        uploads[0].file = file;
        this.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
        this.onload();
      }
    },
  });
  vm.runInContext(source, context);
  return { context, calls, uploads, run: (code) => vm.runInContext(code, context) };
}

test('upload progress reports transfer and finalization without sending bytes to the app API', async () => {
  const h = harness();
  h.context.progress = [];
  const result = await h.run(`uploadFile({ name: 'upload.png', type: 'image/png', size: 10 }, 'post', value => progress.push(value))`);
  assert.deepEqual(h.context.progress, [0, 50, 100]);
  assert.equal(result.mediaUrl, '/api/media/asset');
  assert.equal(h.uploads[0].method, 'PUT');
  assert.equal(h.uploads[0]['Content-Type'], 'image/png');
  assert.equal(h.calls.length, 2);
  assert.equal(JSON.parse(h.calls[0].options.body).purpose, 'post');
  assert.deepEqual(JSON.parse(h.calls[1].options.body), { assetId: 'asset' });
  assert.equal(h.calls[0].options.credentials, 'include');
});

test('failed object transfer never marks an upload complete', async () => {
  const h = harness(403);
  await assert.rejects(h.run(`uploadFile({ name: 'upload.mp4', type: 'video/mp4', size: 10 }, 'post')`), /could not be uploaded/);
  assert.equal(h.calls.length, 1);
});

test('content pagination and filters are encoded in same-origin requests', async () => {
  const h = harness();
  await h.run(`getBootstrap({ page: 2, q: 'music & film', boardId: 'board' })`);
  assert.equal(h.calls[0].url, '/api/social/bootstrap?page=2&q=music+%26+film&boardId=board');
});
