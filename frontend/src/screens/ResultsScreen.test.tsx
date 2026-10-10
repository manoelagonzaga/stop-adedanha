import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Answer, RoomState } from '../types';
import { ResultsScreen } from './ResultsScreen';

const room: RoomState = {
  code: 'ABC234',
  phase: 'CATEGORY_REVIEW',
  players: [
    { id: 'author-1', nickname: 'Autora', isHost: true, status: 'active', score: 0 },
    { id: 'voter-2', nickname: 'Votante', isHost: false, status: 'active', score: 0 },
  ],
  categories: [{ id: 'cat-1', name: 'Animal' }],
  currentRound: 1,
  totalRounds: 3,
  currentLetter: 'C',
  currentRoundId: 'round-id-1',
  currentReviewCategoryIndex: 0,
};

const answer: Answer = {
  playerId: 'author-1',
  categoryId: 'cat-1',
  value: 'Cachorro',
  isValid: true,
  invalidations: [],
  votes: { 'voter-2': 'invalidate' },
  eligibleVoters: ['voter-2'],
  score: 0,
};

describe('ResultsScreen authoritative voting', () => {
  it('shows server votes and sends explicit decisions without allowing self-voting', () => {
    const onVote = vi.fn();
    const { rerender } = render(
      <ResultsScreen room={room} myPlayerId="voter-2" answers={[answer]} onVote={onVote} />,
    );

    expect(screen.getByText('1 voto(s) para invalidar')).toBeInTheDocument();
    const validButton = screen.getByRole('button', { name: 'Válida' });
    expect(screen.getByRole('button', { name: 'Invalidar' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(validButton);
    expect(onVote).toHaveBeenCalledWith('round-id-1', 'cat-1', 'author-1', 'valid');

    rerender(
      <ResultsScreen
        room={room}
        myPlayerId="author-1"
        answers={[answer]}
        onVote={onVote}
      />,
    );
    expect(screen.getByText('Você não pode votar na própria resposta.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Válida' })).not.toBeInTheDocument();
    expect(onVote).toHaveBeenCalledTimes(1);
  });
});
