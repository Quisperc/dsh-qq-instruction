/**
 * 上传端点（POST /api/dsh-qq-vault/upload）的行为测试。
 *
 * 为什么值得测：这是唯一一个**非 GET** 的写入口，一旦校验松了，
 * 就能被用来往磁盘任意写、或塞非备份包进来。用假 Request 直接打 handler，
 * 不启动宿主、不碰真实备份目录。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { handleUploadRequest } from '../lib/index.js';
import { resolvePaths } from '../lib/bundle.js';

/** 造一个最小 Request 替身：支持 headers 与 body 流。 */
function makeRequest({ method = 'POST', contentType = 'application/octet-stream', body = Buffer.alloc(0), contentLength } = {}) {
  const headers = new Map();
  if (contentType !== null) headers.set('content-type', contentType);
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    method,
    headers: { get: (key) => headers.get(String(key).toLowerCase()) ?? null },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    }),
  };
}

/** 合法的 tar.gz 头（只校验魔数，不需要真内容）。 */
const GZIP_BYTES = zlib.gzipSync(Buffer.from('not-a-real-tar'));

/** 造一个只含 backupDir 的路径集合。 */
function makePaths(root) {
  const full = resolvePaths({ home: root, profile: 'web', workspace: path.join(root, 'QQ_msg'), repoRoot: path.join(root, 'repo') });
  return full;
}

const silent = () => {};

test('上传成功：落盘到 backupDir/uploads，返回 uploadId 与绝对路径', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-up-'));
  try {
    const paths = makePaths(root);
    const res = await handleUploadRequest(makeRequest({ body: GZIP_BYTES }), paths, silent);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(data.uploadId.startsWith('up-'));
    assert.ok(fs.existsSync(data.path), '文件应已落盘');
    assert.equal(fs.statSync(data.path).size, GZIP_BYTES.length);
    // 权限收紧（备份含 token，不能让人随手读）
    assert.equal(fs.statSync(data.path).mode & 0o777, 0o600);
    assert.ok(data.path.includes(path.join('uploads', '')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('拒非 POST（方法闸）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-up2-'));
  try {
    const res = await handleUploadRequest(makeRequest({ method: 'GET', body: GZIP_BYTES }), makePaths(root), silent);
    assert.equal(res.status, 405);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('拒错误 content-type（避免表单/JSON 混进来）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-up3-'));
  try {
    const res = await handleUploadRequest(makeRequest({ contentType: 'application/json', body: GZIP_BYTES }), makePaths(root), silent);
    assert.equal(res.status, 415);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('拒空文件', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-up4-'));
  try {
    const res = await handleUploadRequest(makeRequest({ body: Buffer.alloc(0) }), makePaths(root), silent);
    assert.equal(res.status, 400);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('拒非 gzip：不留下垃圾文件', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-up5-'));
  try {
    const paths = makePaths(root);
    const res = await handleUploadRequest(makeRequest({ body: Buffer.from('plain text, not gzip') }), paths, silent);
    assert.equal(res.status, 400);
    const dir = path.join(paths.backupDir, 'uploads');
    const leftovers = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.equal(leftovers.length, 0, `不该留文件：${leftovers.join(',')}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('声明的 content-length 超限时直接拒（不读 body）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-up6-'));
  try {
    const res = await handleUploadRequest(
      makeRequest({ body: GZIP_BYTES, contentLength: 65 * 1024 * 1024 }),
      makePaths(root),
      silent,
    );
    assert.equal(res.status, 413);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
