import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinalResults } from '../types';
import { PodiumScreen } from './PodiumScreen';

afterEach(cleanup);

describe('PodiumScreen avatars', () => {
  it('shows each player-selected avatar on the podium and remaining players list', () => {
    const results: FinalResults = {
      podium: [
        { position: 1, playerId: 'winner', nickname: 'Winner', score: 30, tier: 'gold', avatar: '🐼' },
        { position: 2, playerId: 'second', nickname: 'Second', score: 20, tier: 'silver', avatar: '🐸' },
      ],
      list: [
        { position: 3, playerId: 'third', nickname: 'Third', score: 10, avatar: '🦄' },
      ],
    };

    render(
      <PodiumScreen
        results={results}
        myPlayerId="winner"
        onPlayAgain={vi.fn()}
        onBackToHome={vi.fn()}
      />,
    );

    expect(screen.getByText('🐼')).toBeInTheDocument();
    expect(screen.getByText('🐸')).toBeInTheDocument();
    expect(screen.getByText('🦄')).toBeInTheDocument();
  });
});
