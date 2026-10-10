import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Answer, RoomState } from '../types';
import { ResultsScreen } from './ResultsScreen';

afterEach(cleanup);

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
      <ResultsScreen
        room={room}
        myPlayerId="voter-2"
        answers={[answer]}
        onVote={onVote}
        onNextRound={vi.fn()}
      />,
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
        onNextRound={vi.fn()}
      />,
    );
    expect(screen.getByText('Você não pode votar na própria resposta.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Válida' })).not.toBeInTheDocument();
    expect(onVote).toHaveBeenCalledTimes(1);
  });

  it('renders the server-selected category and confirmed cumulative points', () => {
    const laterCategoryRoom: RoomState = {
      ...room,
      categories: [...room.categories, { id: 'cat-2', name: 'Cidade' }],
      currentReviewCategoryIndex: 1,
      players: room.players.map((player) => ({ ...player, score: player.id === 'author-1' ? 12.5 : 7 })),
    };

    render(
      <ResultsScreen
        room={laterCategoryRoom}
        myPlayerId="voter-2"
        answers={[{ ...answer, categoryId: 'cat-2', score: 2.5 }]}
        onVote={vi.fn()}
        onNextRound={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Cidade — Rodada 1 de 3' })).toBeInTheDocument();
    expect(screen.getByText('12.5 pts')).toBeInTheDocument();
    expect(screen.getByText('7 pts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Próxima Categoria/ })).not.toBeInTheDocument();
  });

  it('shows next round control only to the host after intermediate round results', () => {
    const onNextRound = vi.fn();
    const resultsRoom: RoomState = {
      ...room,
      phase: 'ROUND_RESULTS',
      currentReviewCategoryIndex: 0,
    };
    const { unmount } = render(
      <ResultsScreen
        room={resultsRoom}
        myPlayerId="author-1"
        answers={[answer]}
        onVote={vi.fn()}
        onNextRound={onNextRound}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Próxima Rodada' }));
    expect(onNextRound).toHaveBeenCalledOnce();
    unmount();

    render(
      <ResultsScreen
        room={resultsRoom}
        myPlayerId="voter-2"
        answers={[answer]}
        onVote={vi.fn()}
        onNextRound={onNextRound}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Próxima Rodada' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Válida' })).not.toBeInTheDocument();
    expect(screen.getByText('Aguardando o anfitrião iniciar a próxima rodada.')).toBeInTheDocument();
  });

  it('suspends next-round actions when no active host is present', () => {
    const noHostRoom: RoomState = {
      ...room,
      phase: 'ROUND_RESULTS',
      players: room.players.map((player) => ({ ...player, isHost: false })),
    };

    render(
      <ResultsScreen
        room={noHostRoom}
        myPlayerId="voter-2"
        answers={[answer]}
        onVote={vi.fn()}
        onNextRound={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Próxima Rodada' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Próxima rodada suspensa: não há anfitrião ativo na sala.',
    );
  });

  it('does not offer voting controls to a disconnected player', () => {
    const disconnectedVoterRoom: RoomState = {
      ...room,
      players: room.players.map((player) =>
        player.id === 'voter-2' ? { ...player, status: 'disconnected' } : player,
      ),
    };

    render(
      <ResultsScreen
        room={disconnectedVoterRoom}
        myPlayerId="voter-2"
        answers={[answer]}
        onVote={vi.fn()}
        onNextRound={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Válida' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invalidar' })).not.toBeInTheDocument();
  });
});
