import assert from 'node:assert/strict';
import test from 'node:test';
import '../core.js';

const { reasons, parseCount, keywords, readText, defaults, settings } = globalThis.FollowerPrunerCore;
const clean = { name: 'Alice', bio: 'I grow tomatoes.', followers: 20 };

test('every general keyword matches anywhere in name, handle, or bio, ignoring case', () => {
  for (const keyword of keywords) {
    for (const field of ['name', 'handle', 'bio']) {
      assert.ok(reasons({ ...clean, [field]: `prefix${keyword.toUpperCase()}suffix` }).includes(`${field} contains ${keyword}`));
    }
  }
  for (const name of ['Beth', 'Preethi', 'Ethan']) assert.deepEqual(reasons({ ...clean, name }), []);
  assert.deepEqual(reasons({ ...clean, bio: 'Making something with ETH' }), []);
  assert.deepEqual(reasons({ ...clean, name: 'MyEthereumApp' }), ['name contains ethereum']);
  assert.deepEqual(reasons({ ...clean, bio: 'Building on ETHEREUM' }), ['bio contains ethereum']);
  for (const field of ['name', 'handle', 'bio']) {
    for (const text of ['NFT', 'Collecting NFTs', 'MyNfTGallery']) {
      assert.deepEqual(reasons({ ...clean, [field]: text }), [`${field} contains nft`]);
    }
  }
  assert.deepEqual(reasons({ ...clean, handle: 'nft_collector' }), ['handle contains nft']);
  assert.deepEqual(reasons({ ...clean, handle: 'CryptoPerson' }), ['handle contains crypto']);
  assert.deepEqual(reasons({ ...clean, handle: 'beth' }), []);
});

test('any single rule suffices and exactly 20 followers is kept', () => {
  assert.deepEqual(reasons(clean), []);
  for (const name of ['Alice ♦️', 'Alice ♦']) assert.deepEqual(reasons({ ...clean, name }), ['♦️ in display name']);
  assert.deepEqual(reasons({ ...clean, bio: '♦️' }), []);
  for (const bio of ['', ' \n\t ']) assert.deepEqual(reasons({ ...clean, bio }), ['no bio']);
  for (const followers of [0, 1, 19]) assert.deepEqual(reasons({ ...clean, followers }), [`${followers} followers (<20)`]);
  assert.deepEqual(reasons({ name: 'CRYPTO ♦️', bio: '', followers: 19 }), ['♦️ in display name', 'name contains crypto', 'no bio', '19 followers (<20)']);
});

test('additional bio keywords match substrings without searching names or handles', () => {
  for (const word of ['sahara', 'follow', 'spaace_ai', 'btc', 'gnoma', 'airdrop', 'cnpynetwork']) {
    assert.deepEqual(reasons({ ...clean, bio: `prefix${word.toUpperCase()}suffix` }), [`bio contains ${word}`]);
    assert.deepEqual(reasons({ ...clean, name: word, handle: word }), []);
  }
  assert.deepEqual(reasons({ ...clean, bio: 'Follow my art' }), ['bio contains follow']);
  assert.deepEqual(reasons({ ...clean, bio: 'Following my dreams' }), ['bio contains follow']);
  assert.deepEqual(reasons({ ...clean, bio: 'CRYPTO' }), ['bio contains crypto']);
});

test('unreadable fields are never treated as an empty bio or zero followers', () => {
  for (const followers of [null, undefined, NaN, -1, '0', Infinity]) {
    assert.deepEqual(reasons({ ...clean, followers }), []);
  }
  for (const bio of [null, undefined]) assert.deepEqual(reasons({ ...clean, bio }), []);
});

test('follower counts parse English counts and abbreviations, rejecting ambiguity', () => {
  for (const [text, expected] of [['0', 0], ['19 Followers', 19], ['20Followers', 20], ['1 Follower', 1], ['1,234', 1234], ['1.2K Followers', 1200], ['2M', 2000000], ['1B', 1e9]]) {
    assert.equal(parseCount(text), expected, text);
  }
  for (const text of ['', '—', 'Following', 'Followers', '20 following', '1,2', '0.2', '19people', '-2', '19+']) {
    assert.equal(parseCount(text), null, text);
  }
});

test('emoji images survive text extraction without duplicating nested spans', () => {
  const text = value => ({ nodeType: 3, textContent: value });
  const span = (...childNodes) => ({ nodeName: 'SPAN', childNodes });
  const emoji = { nodeName: 'IMG', getAttribute: name => name === 'alt' ? '♦️' : null };
  assert.equal(readText(span(span(text('Alice ')), emoji)), 'Alice ♦️');
  assert.equal(readText(null), '');
});

test('timing defaults and retry limits are validated', () => {
  assert.deepEqual(settings(), defaults);
  assert.deepEqual(defaults, { scrollDelay: 250, actionDelay: 2000, hoverDelay: 350, profileLoadDelay: 1000, maxFollowerAttempts: 3, maxHoverAttempts: 5, maxScrollAttempts: 5 });
  assert.equal(settings({ actionDelay: '3000' }).actionDelay, 3000);
  for (const value of [-1, NaN, Infinity, 1.5]) assert.throws(() => settings({ scrollDelay: value }));
  assert.throws(() => settings({ maxFollowerAttempts: 0 }));
});
