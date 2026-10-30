import test from 'node:test';
import assert from 'node:assert/strict';
import seedData from '../src/competitions-seed.json' with { type: 'json' };
import { CompetitionStore, type RawCompetition } from '../src/competitions-store.js';
import { buildApp } from '../src/app.js';

function seed(): RawCompetition[] {
  return [structuredClone(seedData.find(c => c.slug === 'squad-showdown-s1')) as RawCompetition];
}

const changes: Array<[string, (data: RawCompetition[]) => void]> = [
  ['roster member', data => { const rows = data[0].entries[0].members!; rows.push(structuredClone(rows[0])); }],
  ['highlight token', data => { const rows = data[0].entries[0].highlightTokens!; rows.push(structuredClone(rows[0])); }],
  ['highlight member', data => { const rows = data[0].entries[0].highlightTokens![0].members!; rows.push(structuredClone(rows[0])); }],
];
for (const [label, change] of changes) {
  test(`competition snapshots reject a duplicate ${label}`, () => {
    const data = seed();
    change(data);
    assert.throws(() => new CompetitionStore(data), /duplicate.*(roster|highlight)/i);
  });
}

test('same mint on distinct chains and the same member on distinct tokens remain independent', async () => {
  const data = seed();
  const entry = data[0].entries[0];
  const otherChain = structuredClone(entry.highlightTokens![0]);
  otherChain.chainId = 8453;
  entry.highlightTokens!.push(otherChain);
  const app = buildApp([], { competitionStore: new CompetitionStore(data) });
  const headers = { authorization: `Bearer pf_live_${'a'.repeat(49)}` };
  try {
    const detail = await app.inject({ url: `/v1/competitions/${data[0].id}/entries/${entry.entryId}`, headers });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().members.length, 2);
    assert.equal(detail.json().entry.memberCount, 2);
    const highlights = await app.inject({ url: `/v1/competitions/${data[0].id}/entries/${entry.entryId}/highlights`, headers });
    assert.equal(highlights.statusCode, 200);
    const tokens = highlights.json().tokens;
    assert.equal(tokens.length, 2);
    assert.deepEqual(new Set(tokens.map((t: any) => t.chainId)), new Set([101, 8453]));
    for (const token of tokens) assert.equal(token.members.length, 2);
    const board = await app.inject({ url: `/v1/competitions/${data[0].id}/highlights?perMemberLimit=2`, headers });
    assert.equal(board.statusCode, 200);
    const rows = board.json().rows.filter((row: any) => row.entryId === entry.entryId);
    assert.equal(rows.length, 4);
  } finally {
    await app.close();
  }
});
