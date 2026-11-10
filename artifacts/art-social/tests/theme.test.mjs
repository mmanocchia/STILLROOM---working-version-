import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const css = read('../src/index.css');
const clerk = read('../src/clerk.js');
const favicon = read('../public/favicon.svg');
const root = css.match(/:root\s*\{([^}]+)\}/)[1];
const tokens = Object.fromEntries([...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
function token(name) {
  const value = tokens[name];
  assert.ok(value, `Missing token ${name}`);
  const alias = value.match(/^var\((--[\w-]+)\)$/);
  return alias ? token(alias[1]) : value.toUpperCase();
}
function luminance(hex) {
  const values = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
test('the five requested brand colors are centralized and white stays dominant', () => {
  assert.equal(token('--sr-white'), '#FFFFFF');
  assert.equal(token('--sr-blush'), '#FAF4F6');
  assert.equal(token('--sr-softpink'), '#E8B9C7');
  assert.equal(token('--sr-accent'), '#C65D82');
  assert.equal(token('--sr-text'), '#29252A');
  assert.equal(token('--paper'), '#FFFFFF');
  assert.match(css, /--feed-background:\s*var\(--sr-white\)/);
  assert.match(css, /\.app-main:has\(\.home-page\)\s*\{\s*background:\s*var\(--sr-white\)/);
});
test('interactive, body and muted text tokens meet normal-text contrast on white and blush', () => {
  for (const background of ['--paper', '--surface-soft']) {
    for (const foreground of ['--ink', '--muted', '--faint', '--teal']) {
      assert.ok(contrast(token(foreground), token(background)) >= 4.5, `${foreground} on ${background}`);
    }
  }
  assert.ok(contrast('#FFFFFF', token('--sr-accent-strong')) >= 4.5);
  assert.ok(contrast('#FFFFFF', token('--sr-accent-deep')) >= 4.5);
  assert.ok(contrast(token('--line-dark'), '#FFFFFF') >= 3, 'Form control boundaries remain visible');
  assert.ok(contrast(token('--line-dark'), token('--surface-soft')) >= 3);
});
test('legacy teal/aqua literals are absent from application, provider theme and brand mark', () => {
  const files = [css, clerk, favicon].join('\n');
  assert.doesNotMatch(files, /#(?:159a95|63c7c1|e4f6f4|172e32|258f89|147d85|117d79|e2f4f3)\b/i);
  for (const match of files.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const c = match[1].match(/../g).map((v) => parseInt(v, 16) / 255);
    const max = Math.max(...c), min = Math.min(...c), delta = max - min;
    if (delta < 0.04) continue; // Neutral surfaces are not colored accents.
    let hue = max === c[0] ? (c[1] - c[2]) / delta : max === c[1] ? (c[2] - c[0]) / delta + 2 : (c[0] - c[1]) / delta + 4;
    hue = (hue * 60 + 360) % 360;
    assert.ok(hue < 70 || hue > 210, `Unexpected green/aqua accent #${match[1]}`);
  }
});
test('Clerk theme uses the same accessible accent without changing font identity', () => {
  const primary = clerk.match(/colorPrimary:\s*'(#[0-9a-f]+)'/i)[1].toUpperCase();
  assert.equal(primary, token('--sr-accent-strong'));
  assert.match(clerk, /fontFamily:\s*'Inter, sans-serif'/);
  assert.match(css, /font-family:\s*'Inter', sans-serif/);
  assert.match(css, /'Anton', sans-serif/);
});
test('logo geometry is preserved; only its colors are themed', () => {
  assert.match(favicon, /viewBox="0 0 40 40"/);
  assert.match(favicon, /<rect width="40" height="40" rx="11"/);
  assert.deepEqual([...favicon.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]), [
    'M20 3.8 36.2 13.2v13.6L20 36.2 3.8 26.8V13.2L20 3.8Z',
    'M12.1 12.2h15.8v15.6H12.1z',
    'm12.2 27.8 15.6-15.6M20 12.2v15.6',
  ]);
});
test('keyboard focus stays visible and media is not recolored through filters', () => {
  assert.match(css, /:focus-visible[\s\S]*?outline:\s*2px solid var\(--(?:rust|sr-accent)\)/);
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/\b(?:img|video)\b/.test(block[1])) assert.doesNotMatch(block[2], /(?:^|;)\s*(?:filter|mix-blend-mode)\s*:/);
  }
});
