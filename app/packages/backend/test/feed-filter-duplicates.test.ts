import test from 'node:test';
import assert from 'node:assert/strict';
import defaultSeed from '../src/home-feed-seed.json' with { type: 'json' };
import { HomeFeedStore, type HomeFeedFilters, type HomeFeedSeed, type HomeFeedSeedRecord } from '../src/home-feed-store.js';

test('equivalent repeated filter members retain ranked and chronological cursors', () => {
  const store = new HomeFeedStore();
  const chains = [...new Set(store.snapshotRecords().map(row => row.chain))];
  const filters: HomeFeedFilters = { chains, assetClasses: ['coin', 'stock', 'perp', 'pack'] };
  const repeated: HomeFeedFilters = Object.freeze({
    chains: Object.freeze([...chains, ...chains].reverse()),
    assetClasses: Object.freeze([...filters.assetClasses, 'coin', 'stock']),
  });
  const original = structuredClone(repeated);
  const ranked = store.ranked({ filters, page: 0, pageSize: 1 });
  assert.ok(ranked.nextPageToken);
  assert.deepEqual(store.ranked({ filters: repeated, page: 0, pageSize: 1 }), ranked);
  assert.deepEqual(
    store.ranked({ filters: repeated, page: 1, pageSize: 1, pageToken: ranked.nextPageToken }),
    store.ranked({ filters, page: 1, pageSize: 1, pageToken: ranked.nextPageToken }),
  );
  const newest = store.newest({ filters, pageSize: 1 });
  assert.ok(newest.headToken);
  assert.ok(newest.nextPageToken);
  assert.deepEqual(store.newest({ filters: repeated, pageSize: 1 }), newest);
  assert.deepEqual(
    store.newest({ filters: repeated, pageSize: 1, pageToken: newest.nextPageToken }),
    store.newest({ filters, pageSize: 1, pageToken: newest.nextPageToken }),
  );
  assert.deepEqual(store.countNew({ filters: repeated, since: newest.headToken }),
                   store.countNew({ filters, since: newest.headToken }));
  assert.deepEqual(repeated, original);
  assert.throws(() => store.ranked({ filters: { ...filters, chains: [] },
    page: 1, pageSize: 1, pageToken: ranked.nextPageToken }), /filter context/);
});

function row(index: number, chain: 'solana' | 'base', createdAt: string): HomeFeedSeedRecord {
  return {
    ...structuredClone(defaultSeed.records[0]) as HomeFeedSeedRecord,
    recordId: `dedup-record-${index}`,
    calloutId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    coinMint: `DEDUP_MINT_${index}`,
    chain, createdAt, localRank: index,
    deleted: false, hidden: false,
  };
}

test('new-count caps each distinct chain once rather than counting repeated members', () => {
  const seed: HomeFeedSeed = {
    datasetId: 'synthetic-duplicate-filter-count',
    observedAt: '2026-10-28T12:00:00.000Z',
    records: [row(90, 'solana', '2026-10-28T09:00:00.000Z')],
  };
  const previous = new HomeFeedStore(seed);
  const current = new HomeFeedStore({ ...seed, records: [
    ...Array.from({ length: 30 }, (_, index) => row(index + 1, 'solana', '2026-10-28T10:00:00.000Z')),
    row(31, 'base', '2026-10-28T10:00:00.000Z'),
    row(32, 'base', '2026-10-28T10:00:00.000Z'),
    ...seed.records,
  ] });
  for (const chains of [['solana'], ['solana', 'base']] as const) {
    const filters: HomeFeedFilters = { chains, assetClasses: [] };
    const repeated: HomeFeedFilters = { chains: [...chains, ...chains], assetClasses: [] };
    const since = previous.newest({ filters: repeated, pageSize: 1 }).headToken!;
    assert.ok(since);
    const result = current.countNew({ filters: repeated, since });
    assert.equal(result.newCount, chains.length === 1 ? 25 : 27);
    assert.equal(result.capped, true);
    assert.deepEqual(result, current.countNew({ filters, since }));
  }
});
