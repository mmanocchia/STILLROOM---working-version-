// Explicitly opt-in. Creates ONLY isolated, marked development identities.
// Credentials and tokens stay in process memory and are never printed/saved.
import { clerkClient } from '@clerk/express';
import { build } from 'esbuild';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (!process.argv.includes('--allow-isolated-destructive-tests')) throw new Error('Explicit destructive-test permission required.');
if (!process.env.REPLIT_DEV_DOMAIN?.endsWith('.replit.dev')) throw new Error('Development only.');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const apiDir = path.join(root, 'artifacts/api-server');
const apiRequire = createRequire(path.join(apiDir, 'package.json'));
const dbRequire = createRequire(path.join(root, 'lib/db/package.json'));
const output = await build({
  stdin: { contents: `export * from './src/lib/accountDeletion.ts';export * from './src/lib/objectStorage.ts';export {pool} from '@workspace/db';`,
    resolveDir: apiDir }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'workspace-db', setup(b) { b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: path.join(root, 'lib/db/src/index.ts') })); } }],
});
const mod = { exports: {} };
new Function('require', 'module', 'exports', output.outputFiles[0].text)(
  (id) => id === 'pg' ? dbRequire(id) : apiRequire(id), mod, mod.exports);
const { pool, initiateDeletion, runDeletionBatch, deletionStatus, subjectHash, ObjectStorageService, objectStorageClient } = mod.exports;
const marker = randomBytes(6).toString('hex'), contexts = [], files = [];
const origin = `https://${process.env.REPLIT_DEV_DOMAIN}`;
let count = 0, positiveApiDeletion = false;
function check(label, ok) { if (!ok) throw new Error(`FAIL: ${label}`); console.log('PASS', label); count++; }
const q = (text, args = []) => pool.query(text, args);
async function http(ctx, url, body, method = body ? 'POST' : 'GET') {
  const headers = { Origin: origin };
  if (ctx) {
    if (!ctx.jwt || Date.now() > ctx.refreshAt) {
      ctx.jwt = (await clerkClient.sessions.getToken(ctx.sessionId)).jwt; ctx.refreshAt = Date.now() + 40000;
    }
    headers.Authorization = `Bearer ${ctx.jwt}`;
  }
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(origin + '/api' + url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  return { status: response.status, data: await response.json().catch(() => null) };
}
async function identity(role) {
  const user = await clerkClient.users.createUser({
    emailAddress: [`stillroom-deletion-${marker}-${role.toLowerCase()}+clerk_test@example.com`],
    password: randomBytes(32).toString('base64url') + '!Aa9',
    privateMetadata: { stillroomIsolatedDeletionAudit: marker },
  });
  const ctx = { id: user.id, role, receipt: randomBytes(32).toString('hex') };
  contexts.push(ctx);
  const verified = await clerkClient.users.getUser(ctx.id);
  check(`${role} test identity has exact isolation marker`, verified.privateMetadata.stillroomIsolatedDeletionAudit === marker);
  ctx.sessionId = (await clerkClient.sessions.createSession({ userId: ctx.id })).id;
  const created = await http(ctx, '/auth/profile', { role, name: 'Isolated deletion audit', username: `sr_${marker}_${role}` });
  check(`${role} profile created through authenticated onboarding`, created.status === 201 && created.data.profile?.id === ctx.id);
  return ctx;
}
async function media(owner) {
  const id = randomUUID(), objectPath = `/objects/assets/${id}`;
  const privateDir = new ObjectStorageService().getPrivateObjectDir().replace(/^\/|\/$/g, '');
  const [bucket, ...prefix] = privateDir.split('/');
  const file = objectStorageClient.bucket(bucket).file(`${prefix.join('/')}/assets/${id}`);
  await file.save(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'), { contentType: 'image/png', resumable: false });
  files.push(file);
  await q(`INSERT INTO stillroom_media_assets(id,owner_id,object_path,name,content_type,size,status,created_at)
    VALUES($1,$2,$3,'Isolated audit image','image/png',68,'ready',now()-interval '1 hour')`, [id, owner.id, objectPath]);
  return { id, file };
}
async function waitComplete(ctx) {
  for (let i = 0; i < 20; i++) {
    const status = await deletionStatus(ctx.receipt);
    if (status.status === 'complete') return status;
    await q("UPDATE stillroom_account_deletions SET next_attempt_at=now() WHERE receipt_hash=encode(sha256($1::bytea),'hex')", [Buffer.from(ctx.receipt)]);
    await runDeletionBatch(undefined, subjectHash(ctx.id));
    await delay(300);
  }
  throw new Error('Isolated cleanup did not complete.');
}
async function absentIdentity(ctx) {
  try { await clerkClient.users.getUser(ctx.id); return false; } catch (e) { return e.status === 404; }
}
// Clean up only an identity whose creation was observed by the browser audit.
// Exact ID, canonical test address, recent creation, and isolated username must
// all match before the destructive service can be invoked.
const cleanupId = process.argv.find((arg) => arg.startsWith('--cleanup-user='))?.slice('--cleanup-user='.length);
if (cleanupId) {
  const expected = process.argv.find((arg) => arg.startsWith('--cleanup-email='))?.slice('--cleanup-email='.length).toLowerCase();
  if (!/^stillroom-settings-[a-z0-9]+\+clerk_test@example\.com$/.test(expected || '')) throw new Error('Invalid isolated-test address.');
  const identity = await clerkClient.users.getUser(cleanupId);
  const primary = identity.emailAddresses.find((row) => row.id === identity.primaryEmailAddressId);
  if (identity.id !== cleanupId || primary?.emailAddress.toLowerCase() !== expected
    || Date.now() - identity.createdAt > 2 * 60 * 60 * 1000) throw new Error('Isolated browser identity provenance mismatch; refusing deletion.');
  const { rows: [profile] } = await q('SELECT role,username FROM stillroom_profiles WHERE id=$1', [cleanupId]);
  if (profile && (profile.role !== 'Fan' || !/^sr_settings_[a-z0-9_]+$/i.test(profile.username))) throw new Error('Unexpected existing profile; refusing deletion.');
  if (profile) {
    const ctx = { id: cleanupId, receipt: randomBytes(32).toString('hex') };
    await initiateDeletion(ctx.id, ctx.receipt, false);
    await waitComplete(ctx);
  } else await clerkClient.users.deleteUser(cleanupId);
  check('Verified browser-only disposable identity removed', await absentIdentity({ id: cleanupId }));
  check('Disposable browser profile removed', !(await q('SELECT id FROM stillroom_profiles WHERE id=$1', [cleanupId])).rows.length);
  await pool.end();
  process.exit(0);
}
try {
  const baseline = await q(`SELECT jsonb_build_object('profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM stillroom_profiles p),
    'boards',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM stillroom_artist_boards b),
    'posts',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM stillroom_posts p)) AS data`);
  const fan = await identity('Fan'), artist = await identity('Artist');
  check('Guest settings are rejected', (await http(null, '/account/settings')).status === 401);
  for (const ctx of [fan, artist]) {
    const settings = await http(ctx, '/account/settings');
    check(`${ctx.role} reads only their own settings`, settings.status === 200 && settings.data.profile.id === ctx.id && !('email' in settings.data.profile));
    ctx.profile = settings.data.profile;
  }
  const patch = { name: fan.profile.name, username: fan.profile.username, biography: 'Isolated audit', profileImageAssetId: null };
  check('Spoofed profile ID and role are rejected', (await http(fan, '/account/settings', { ...patch, id: artist.id, role: 'Artist' }, 'PATCH')).status === 400);
  check('Duplicate username is rejected', (await http(fan, '/account/settings', { ...patch, username: artist.profile.username }, 'PATCH')).status === 409);
  check('Empty username is rejected', (await http(fan, '/account/settings', { ...patch, username: ' ' }, 'PATCH')).status === 400);
  check('Existing username availability is false', !(await http(fan, `/account/username?username=${artist.profile.username}`)).data.available);
  const profileMedia = await media(fan), contributionMedia = await media(fan);
  const boardId = randomUUID(), postId = randomUUID(), shelfId = randomUUID();
  await q("INSERT INTO stillroom_artist_boards(id,owner_id,artist_name,discipline,biography) VALUES($1,$2,'Isolated audit','Other','Isolated audit')", [boardId, artist.id]);
  await q("INSERT INTO stillroom_posts(id,board_id,author_id,content,media_asset_id) VALUES($1,$2,$3,'Isolated audit',$4)", [postId, boardId, fan.id, contributionMedia.id]);
  await q("INSERT INTO stillroom_comments(post_id,author_id,content) VALUES($1,$2,'Isolated audit')", [postId, fan.id]);
  await q("INSERT INTO stillroom_reposts(post_id,user_id) VALUES($1,$2)", [postId, fan.id]);
  await q("INSERT INTO stillroom_follows(fan_id,artist_id) VALUES($1,$2)", [fan.id, artist.id]);
  await q("INSERT INTO stillroom_shelves(id,owner_id,title,visibility) VALUES($1,$2,'Isolated audit','private')", [shelfId, fan.id]);
  await q("INSERT INTO stillroom_shelf_posts(shelf_id,post_id) VALUES($1,$2)", [shelfId, postId]);
  const updated = await http(fan, '/account/settings', { ...patch, username: `sr_${marker}_renamed`, profileImageAssetId: profileMedia.id }, 'PATCH');
  check('Profile changes keep stable identity and role', updated.status === 200 && updated.data.profile.id === fan.id && updated.data.profile.role === 'Fan' && updated.data.profile.username.endsWith('_renamed'));
  check('Other user cannot use owned profile image', (await http(artist, '/account/settings', { name: artist.profile.name, username: artist.profile.username, biography: '', profileImageAssetId: profileMedia.id }, 'PATCH')).status === 400);
  check('Deletion rejects a supplied victim ID', (await http(fan, '/account/deletion', { confirmation: 'DELETE', artistCascadeConfirmed: true, receipt: fan.receipt, userId: artist.id })).status === 400);
  check('Deletion requires typed confirmation', (await http(artist, '/account/deletion', { confirmation: 'no', artistCascadeConfirmed: true, receipt: artist.receipt })).status === 400);
  const requested = await http(artist, '/account/deletion', { confirmation: 'DELETE', artistCascadeConfirmed: true, receipt: artist.receipt });
  if (requested.status === 403) {
    check('Backend-created session cannot bypass recent identity verification', requested.data.code === 'REVERIFICATION_REQUIRED');
    console.log('BLOCKED positive HTTP deletion: requires interactive recent Clerk verification; testing the real cleanup service directly on isolated records.');
    let refused = false;
    try { await initiateDeletion(artist.id, artist.receipt, false); } catch (e) { refused = e.status === 400; }
    check('Artist cascade must be explicitly confirmed', refused);
    await initiateDeletion(artist.id, artist.receipt, true);
  } else {
    check('Recently authenticated deletion API accepts confirmed own request', requested.status === 202);
    positiveApiDeletion = true;
  }
  await waitComplete(artist);
  check('Artist identity removed from Clerk', await absentIdentity(artist));
  check('Board and Fan original contribution cascade', !(await q('SELECT id FROM stillroom_artist_boards WHERE id=$1 UNION ALL SELECT id FROM stillroom_posts WHERE id=$2', [boardId, postId])).rows.length);
  check('Comments, reposts and saved references cascade', (await q(`SELECT (SELECT count(*) FROM stillroom_comments WHERE post_id=$1)
    +(SELECT count(*) FROM stillroom_reposts WHERE post_id=$1)+(SELECT count(*) FROM stillroom_shelf_posts WHERE post_id=$1) AS n`, [postId])).rows[0].n === '0');
  check('Surviving Fan profile and private Shelf are preserved', (await q('SELECT id FROM stillroom_profiles WHERE id=$1', [fan.id])).rows.length === 1 && (await q('SELECT id FROM stillroom_shelves WHERE id=$1', [shelfId])).rows.length === 1);
  check('Unreferenced contribution object is removed', !(await contributionMedia.file.exists())[0]);
  check('Still-referenced Fan profile object is preserved', (await profileMedia.file.exists())[0]);
  await initiateDeletion(fan.id, fan.receipt, false);
  const blocked = await http(fan, '/auth/profile', { role: 'Fan', name: 'Forbidden', username: `sr_${marker}_restore` });
  check('Partially deleting account cannot recreate its profile', [401, 403].includes(blocked.status));
  await runDeletionBatch({ removeIdentity: async () => { throw new Error('simulated outage'); }, removeObject: async () => { throw new Error('not reached'); } }, subjectHash(fan.id));
  check('External failure remains truthfully pending', (await deletionStatus(fan.receipt)).status === 'pending');
  check('Failed identity deletion has a durable retry reference', (await q("SELECT user_id,last_error_code FROM stillroom_account_deletions WHERE user_id=$1", [fan.id])).rows[0]?.last_error_code === 'EXTERNAL_CLEANUP_RETRY');
  await waitComplete(fan);
  check('Retry removes Fan Clerk identity', await absentIdentity(fan));
  check('Retry removes final owned storage object', !(await profileMedia.file.exists())[0]);
  await initiateDeletion(fan.id, fan.receipt, false);
  check('Repeating confirmed deletion is idempotent', (await deletionStatus(fan.receipt)).status === 'complete');
  check('Completed ledger contains no raw identity or storage paths', !(await q("SELECT id FROM stillroom_account_deletions WHERE user_id=ANY($1::text[])", [contexts.map(c => c.id)])).rows.length);
  const after = await q(`SELECT jsonb_build_object('profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM stillroom_profiles p),
    'boards',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM stillroom_artist_boards b),
    'posts',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM stillroom_posts p)) AS data`);
  check('All pre-existing profiles, Boards and posts are unchanged', JSON.stringify(baseline.rows[0].data) === JSON.stringify(after.rows[0].data));
  console.log(`RESULT ${count} passed; positive HTTP deletion ${positiveApiDeletion ? 'passed' : 'requires interactive recent-verification test'}. No existing identities/content were modified.`);
} finally {
  for (const ctx of contexts) {
    const live = await q('SELECT id FROM stillroom_profiles WHERE id=$1', [ctx.id]);
    if (live.rows.length) {
      const identity = await clerkClient.users.getUser(ctx.id).catch(() => null);
      if (identity && identity.privateMetadata.stillroomIsolatedDeletionAudit !== marker) throw new Error('Cleanup provenance mismatch; refusing deletion.');
      await initiateDeletion(ctx.id, ctx.receipt, true);
      await waitComplete(ctx);
    } else if (!(await absentIdentity(ctx))) {
      const identity = await clerkClient.users.getUser(ctx.id);
      if (identity.privateMetadata.stillroomIsolatedDeletionAudit !== marker) throw new Error('Cleanup provenance mismatch.');
      // Creation may have failed before the profile existed; no app data to erase.
      await clerkClient.users.deleteUser(ctx.id);
    }
  }
  for (const file of files) await file.delete({ ignoreNotFound: true });
  await pool.end();
}
