import { describe, it, expect } from 'vitest';
import {
  passesLetterCheck,
  computeCategoryScores,
  computeRoundScores,
  resolveInvalidation,
  buildFinalRanking,
  STOP_BONUS_PTS,
  type RoundSnapshot,
} from '../scoring';
import type { Answer, Category } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAnswer(
  playerId: string,
  categoryId: string,
  value: string,
  opts: Partial<{ isValid: boolean; invalidations: string[] }> = {},
): Answer {
  return {
    playerId,
    categoryId,
    value,
    isValid: opts.isValid ?? true,
    invalidations: opts.invalidations ?? [],
    score: 0,
  };
}

function makeSnapshot(
  answers: Answer[],
  letter = 'S',
  stopperId: string | null = null,
): RoundSnapshot {
  const map = new Map<string, Answer>();
  for (const a of answers) {
    map.set(`${a.playerId}:${a.categoryId}`, a);
  }
  return { letter, answers: map, stopperId };
}

const cat1: Category = { id: 'cat-1', name: 'Nome' };
const cat2: Category = { id: 'cat-2', name: 'Comida' };

const players = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];

// ── passesLetterCheck ──────────────────────────────────────────────────────

describe('passesLetterCheck', () => {
  it('returns true for a word starting with the correct letter', () => {
    expect(passesLetterCheck('Silvia', 'S')).toBe(true);
  });

  it('is case-insensitive for both value and letter', () => {
    expect(passesLetterCheck('silvia', 'S')).toBe(true);
    expect(passesLetterCheck('SILVIA', 's')).toBe(true);
  });

  it('returns false for a word starting with wrong letter', () => {
    expect(passesLetterCheck('Maria', 'S')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(passesLetterCheck('', 'S')).toBe(false);
    expect(passesLetterCheck('   ', 'S')).toBe(false);
  });
});

// ── computeCategoryScores ──────────────────────────────────────────────────

describe('computeCategoryScores', () => {
  it('gives +10 for unique valid answers', () => {
    const answers = [
      makeAnswer('p1', 'cat-1', 'Silvia'),
      makeAnswer('p2', 'cat-1', 'Sandro'),
    ];
    const snap = makeSnapshot(answers);
    const { scores } = computeCategoryScores(snap, cat1, players);

    expect(scores['p1']).toBe(10);
    expect(scores['p2']).toBe(10);
  });

  it('gives +5 for duplicate valid answers', () => {
    const answers = [
      makeAnswer('p1', 'cat-1', 'Silvia'),
      makeAnswer('p2', 'cat-1', 'Silvia'),
    ];
    const snap = makeSnapshot(answers);
    const { scores } = computeCategoryScores(snap, cat1, players);

    expect(scores['p1']).toBe(5);
    expect(scores['p2']).toBe(5);
  });

  it('gives 0 for empty answers', () => {
    const answers = [
      makeAnswer('p1', 'cat-1', ''),
      makeAnswer('p2', 'cat-1', 'Sandro'),
    ];
    const snap = makeSnapshot(answers);
    const { scores } = computeCategoryScores(snap, cat1, players);

    expect(scores['p1']).toBe(0);
    expect(scores['p2']).toBe(10);
  });

  it('gives 0 for invalidated answers', () => {
    const answers = [
      makeAnswer('p1', 'cat-1', 'Silvia', { isValid: false, invalidations: ['p2', 'p3'] }),
      makeAnswer('p2', 'cat-1', 'Sandro'),
    ];
    const snap = makeSnapshot(answers);
    const { scores } = computeCategoryScores(snap, cat1, players);

    expect(scores['p1']).toBe(0);
    expect(scores['p2']).toBe(10);
  });

  it('does not count invalidated answers toward duplicate detection', () => {
    // p1 has "Silvia" invalidated, p2 has "Silvia" valid — p2 should get +10 (unique)
    const answers = [
      makeAnswer('p1', 'cat-1', 'Silvia', { isValid: false, invalidations: ['p2', 'p3'] }),
      makeAnswer('p2', 'cat-1', 'Silvia'),
    ];
    const snap = makeSnapshot(answers);
    const { scores } = computeCategoryScores(snap, cat1, players);

    expect(scores['p1']).toBe(0);
    expect(scores['p2']).toBe(10); // unique after invalidation
  });

  it('is case-insensitive for duplicate detection', () => {
    const answers = [
      makeAnswer('p1', 'cat-1', 'SILVIA'),
      makeAnswer('p2', 'cat-1', 'silvia'),
    ];
    const snap = makeSnapshot(answers);
    const { scores } = computeCategoryScores(snap, cat1, players);

    expect(scores['p1']).toBe(5);
    expect(scores['p2']).toBe(5);
  });

  it('handles three players where two share the same word', () => {
    const answers = [
      makeAnswer('p1', 'cat-1', 'Silvia'),
      makeAnswer('p2', 'cat-1', 'Silvia'),
      makeAnswer('p3', 'cat-1', 'Sofia'),
    ];
    const snap = makeSnapshot(answers);
    const { scores } = computeCategoryScores(snap, cat1, players);

    expect(scores['p1']).toBe(5);
    expect(scores['p2']).toBe(5);
    expect(scores['p3']).toBe(10);
  });
});

// ── computeRoundScores ─────────────────────────────────────────────────────

describe('computeRoundScores', () => {
  it('accumulates points across all categories', () => {
    const answers = [
      makeAnswer('p1', 'cat-1', 'Silvia'),
      makeAnswer('p2', 'cat-1', 'Sandro'),
      makeAnswer('p1', 'cat-2', 'Sopa'),
      makeAnswer('p2', 'cat-2', 'Sopa'), // shared
    ];
    const snap = makeSnapshot(answers);
    const { roundPts } = computeRoundScores(snap, [cat1, cat2], players);

    // cat-1: p1 +10 unique, p2 +10 unique
    // cat-2: p1 +5 dup, p2 +5 dup
    expect(roundPts['p1']).toBe(15);
    expect(roundPts['p2']).toBe(15);
  });

  it('adds stop bonus (+10) to the stopper', () => {
    const answers = [
      makeAnswer('p1', 'cat-1', 'Silvia'),
      makeAnswer('p2', 'cat-1', 'Sandro'),
    ];
    const snap = makeSnapshot(answers, 'S', 'p1');
    const { roundPts } = computeRoundScores(snap, [cat1], players);

    expect(roundPts['p1']).toBe(10 + STOP_BONUS_PTS); // 10 unique + 10 bonus
    expect(roundPts['p2']).toBe(10); // 10 unique, no bonus
  });

  it('gives no bonus when stopperId is null', () => {
    const answers = [
      makeAnswer('p1', 'cat-1', 'Silvia'),
    ];
    const snap = makeSnapshot(answers, 'S', null);
    const { roundPts } = computeRoundScores(snap, [cat1], players);

    expect(roundPts['p1']).toBe(10);
  });

  it('gives 0 pts to a player with no answers', () => {
    const answers = [
      makeAnswer('p1', 'cat-1', 'Silvia'),
    ];
    const snap = makeSnapshot(answers, 'S', null);
    const { roundPts } = computeRoundScores(snap, [cat1], [{ id: 'p1' }, { id: 'p2' }]);

    expect(roundPts['p1']).toBe(10);
    // p2 has no answers, so no entry (or 0)
    expect(roundPts['p2'] ?? 0).toBe(0);
  });
});

// ── resolveInvalidation ────────────────────────────────────────────────────

describe('resolveInvalidation', () => {
  it('does not invalidate below majority (2 out of 4)', () => {
    expect(resolveInvalidation(2, 4)).toBe(false);
  });

  it('invalidates at exact majority (3 out of 4)', () => {
    expect(resolveInvalidation(3, 4)).toBe(true);
  });

  it('invalidates above majority (2 out of 3)', () => {
    expect(resolveInvalidation(2, 3)).toBe(true);
  });

  it('handles 1 voter correctly', () => {
    // 1 active player: majority = ceil(1/2) = 1 → 1 vote invalidates
    expect(resolveInvalidation(1, 1)).toBe(true);
    expect(resolveInvalidation(0, 1)).toBe(false);
  });

  it('returns false for 0 active players', () => {
    expect(resolveInvalidation(0, 0)).toBe(false);
  });

  it('does not invalidate with 0 votes', () => {
    expect(resolveInvalidation(0, 5)).toBe(false);
  });
});

// ── buildFinalRanking ──────────────────────────────────────────────────────

describe('buildFinalRanking', () => {
  it('assigns gold/silver/bronze tiers to top 3', () => {
    const players = [
      { id: 'p1', nickname: 'Ana', score: 100 },
      { id: 'p2', nickname: 'Bruno', score: 80 },
      { id: 'p3', nickname: 'Carla', score: 60 },
      { id: 'p4', nickname: 'Diego', score: 40 },
    ];
    const { podium, list } = buildFinalRanking(players);

    expect(podium).toHaveLength(3);
    expect(podium[0]).toMatchObject({ tier: 'gold', position: 1, nickname: 'Ana', score: 100 });
    expect(podium[1]).toMatchObject({ tier: 'silver', position: 2, nickname: 'Bruno', score: 80 });
    expect(podium[2]).toMatchObject({ tier: 'bronze', position: 3, nickname: 'Carla', score: 60 });

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ position: 4, nickname: 'Diego', score: 40 });
  });

  it('sorts players by score descending', () => {
    const players = [
      { id: 'p3', nickname: 'Carla', score: 60 },
      { id: 'p1', nickname: 'Ana', score: 100 },
      { id: 'p2', nickname: 'Bruno', score: 80 },
    ];
    const { podium } = buildFinalRanking(players);
    expect(podium[0].nickname).toBe('Ana');
    expect(podium[1].nickname).toBe('Bruno');
    expect(podium[2].nickname).toBe('Carla');
  });

  it('works with exactly 3 players (no list)', () => {
    const players = [
      { id: 'p1', nickname: 'Ana', score: 100 },
      { id: 'p2', nickname: 'Bruno', score: 80 },
      { id: 'p3', nickname: 'Carla', score: 60 },
    ];
    const { podium, list } = buildFinalRanking(players);
    expect(podium).toHaveLength(3);
    expect(list).toHaveLength(0);
  });

  it('works with fewer than 3 players', () => {
    const players = [
      { id: 'p1', nickname: 'Ana', score: 100 },
      { id: 'p2', nickname: 'Bruno', score: 80 },
    ];
    const { podium, list } = buildFinalRanking(players);
    expect(podium).toHaveLength(2);
    expect(list).toHaveLength(0);
  });

  it('assigns correct positions to list players', () => {
    const players = [
      { id: 'p1', nickname: 'P1', score: 100 },
      { id: 'p2', nickname: 'P2', score: 90 },
      { id: 'p3', nickname: 'P3', score: 80 },
      { id: 'p4', nickname: 'P4', score: 70 },
      { id: 'p5', nickname: 'P5', score: 60 },
    ];
    const { list } = buildFinalRanking(players);
    expect(list[0].position).toBe(4);
    expect(list[1].position).toBe(5);
  });
});
