/**
 * scoring.ts — Pure scoring engine for Stop! multiplayer.
 *
 * All functions here are pure (no side effects, no I/O) so they can be
 * tested with Vitest without mocking the Cloudflare Workers runtime.
 */

import type { Answer, Category, Player, PodiumItem, RankingListItem } from './types';

export const STOP_BONUS_PTS = 10;

// ── Per-round data (subset used by scoring) ────────────────────────────────

export interface RoundSnapshot {
  letter: string;
  /** key: `${playerId}:${categoryId}` */
  answers: Map<string, Answer>;
  stopperId: string | null;
}

// ── Primary validation ─────────────────────────────────────────────────────

/**
 * Returns true if the answer value is non-empty AND starts with the given letter.
 * Backend primary validation — client-side also enforces this visually.
 */
export function passesLetterCheck(value: string, letter: string): boolean {
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 && trimmed.startsWith(letter.toUpperCase());
}

// ── Category score computation ─────────────────────────────────────────────

export interface CategoryScoreResult {
  /** playerId → points earned in this category */
  scores: Record<string, number>;
}

/**
 * Computes the score for every player in a single category.
 *
 * Rules:
 * - Empty or invalidated answer → 0 pts
 * - Valid, unique answer → +10 pts
 * - Valid, duplicated answer → +5 pts
 */
export function computeCategoryScores(
  roundSnapshot: Pick<RoundSnapshot, 'answers'>,
  category: Category,
  players: (Pick<Player, 'id'> & Partial<Pick<Player, 'status'>>)[],
): CategoryScoreResult {
  const scores: Record<string, number> = {};

  // Collect answers for this category
  const catAnswers: Answer[] = [];
  for (const player of players) {
    const key = `${player.id}:${category.id}`;
    const ans = roundSnapshot.answers.get(key);
    if (ans) catAnswers.push(ans);
  }

  // Word frequency map — only count valid, non-empty answers
  const freq: Record<string, number> = {};
  for (const ans of catAnswers) {
    const clean = ans.value.trim().toLowerCase();
    if (clean && ans.isValid) {
      freq[clean] = (freq[clean] ?? 0) + 1;
    }
  }

  // Assign points
  for (const ans of catAnswers) {
    const clean = ans.value.trim().toLowerCase();
    if (clean && ans.isValid) {
      const isUnique = freq[clean] === 1;
      const baseScore = isUnique ? 10 : 5;
      const eligibleVoters = ans.eligibleVoters ??
        players
          .filter((player) => player.id !== ans.playerId && player.status !== 'disconnected')
          .map((player) => player.id);
      const invalidationVotes = ans.votes
        ? Object.entries(ans.votes).filter(
            ([voterId, decision]) => eligibleVoters.includes(voterId) && decision === 'invalidate',
          ).length
        : ans.invalidations.filter((voterId) => eligibleVoters.includes(voterId)).length;
      scores[ans.playerId] =
        (scores[ans.playerId] ?? 0) +
        baseScore * resolveInvalidation(invalidationVotes, eligibleVoters.length);
    } else {
      // Ensure the player has a 0-entry even if blank/invalidated
      scores[ans.playerId] = scores[ans.playerId] ?? 0;
    }
  }

  return { scores };
}

// ── Round score computation ────────────────────────────────────────────────

export interface RoundScoreResult {
  /** playerId → total points earned in this round (all categories + stop bonus) */
  roundPts: Record<string, number>;
}

/**
 * Computes the cumulative round points for every player across all categories,
 * plus the stop bonus (+10) for the player who called STOP first.
 */
export function computeRoundScores(
  roundSnapshot: RoundSnapshot,
  categories: Category[],
  players: Pick<Player, 'id'>[],
): RoundScoreResult {
  const roundPts: Record<string, number> = {};

  for (const category of categories) {
    const { scores } = computeCategoryScores(roundSnapshot, category, players);
    for (const [pid, pts] of Object.entries(scores)) {
      roundPts[pid] = (roundPts[pid] ?? 0) + pts;
    }
  }

  // Stop bonus
  if (roundSnapshot.stopperId) {
    roundPts[roundSnapshot.stopperId] =
      (roundPts[roundSnapshot.stopperId] ?? 0) + STOP_BONUS_PTS;
  }

  return { roundPts };
}

// ── Invalidation vote ──────────────────────────────────────────────────────

/**
 * Returns the score multiplier for invalidation votes among eligible voters.
 */
export function resolveInvalidation(
  invalidationVotes: number,
  eligibleVoters: number,
): 0 | 0.5 | 1 {
  if (eligibleVoters <= 0) return 1;
  const ratio = invalidationVotes / eligibleVoters;
  if (ratio > 0.5) return 0;
  if (ratio >= 0.1) return 0.5;
  return 1;
}

// ── Final ranking / podium ─────────────────────────────────────────────────

export interface FinalRanking {
  podium: PodiumItem[];
  list: RankingListItem[];
}

/**
 * Builds the podium (top 3) and remainder list sorted by total score descending.
 */
export function buildFinalRanking(
  players: Pick<Player, 'id' | 'nickname' | 'score' | 'avatar'>[],
): FinalRanking {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  const tiers = ['gold', 'silver', 'bronze'] as const;

  const podium: PodiumItem[] = top3.map((p, i) => ({
    position: (i + 1) as 1 | 2 | 3,
    playerId: p.id,
    nickname: p.nickname,
    score: p.score,
    tier: tiers[i],
    avatar: p.avatar,
  }));

  const list: RankingListItem[] = rest.map((p, i) => ({
    position: i + 4,
    playerId: p.id,
    nickname: p.nickname,
    score: p.score,
    avatar: p.avatar,
  }));

  return { podium, list };
}
