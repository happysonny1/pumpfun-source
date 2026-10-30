import test from 'node:test';
import assert from 'node:assert/strict';
import seedData from '../src/competitions-seed.json' with { type: 'json' };
import { CompetitionStore, type RawCompetition } from '../src/competitions-store.js';

function seedWithTier(rankFrom: number, rankTo: number): RawCompetition[] {
  const competition = structuredClone(seedData.find(c => c.slug === 'winter-warfare')) as RawCompetition;
  competition.prizes = [{ rankFrom, rankTo, amount: '2 SOL' }];
  return [competition];
}

test('competition prizes reject finite ranks outside positive safe integers', () => {
  for (const field of ['rankFrom', 'rankTo'] as const) {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const seed = seedWithTier(1, 2);
      seed[0].prizes[0][field] = value;
      assert.throws(() => new CompetitionStore(seed), /positive safe integer/i, `${field}=${value}`);
    }
  }
});

test('competition prizes reject a reversed inclusive rank range', () => {
  assert.throws(() => new CompetitionStore(seedWithTier(5, 1)), /rankTo.*rankFrom/i);
});

test('valid single and ascending rank ranges retain inclusive winner prizes', () => {
  for (const [rankFrom, rankTo] of [[1, 1], [1, 2], [2, 2]]) {
    const store = new CompetitionStore(seedWithTier(rankFrom, rankTo));
    const view = store.getByIdOrSlug('winter-warfare')!.competition;
    assert.equal(view.winners.length, rankTo);
    for (const winner of view.winners) {
      assert.equal(winner.prize, winner.rank >= rankFrom ? '2 SOL' : null);
    }
  }
});
