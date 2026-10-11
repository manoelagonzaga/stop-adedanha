import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinalResults } from '../types';
import { PodiumScreen } from './PodiumScreen';

afterEach(cleanup);

const results: FinalResults = {
  podium: [
    { position: 1, playerId: 'winner', nickname: 'Winner', score: 30, tier: 'gold', avatar: '🐼' },
    { position: 2, playerId: 'second', nickname: 'Second', score: 20, tier: 'silver', avatar: '🐸' },
  ],
  list: [
    { position: 3, playerId: 'third', nickname: 'Third', score: 10, avatar: '🦄' },
  ],
};

describe('PodiumScreen', () => {
  it('shows each player-selected avatar on the podium and remaining players list', () => {
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

  it('separates "Jogar Novamente" and "Voltar ao Início" button actions', () => {
    const onPlayAgain = vi.fn();
    const onBackToHome = vi.fn();

    render(
      <PodiumScreen
        results={results}
        myPlayerId="winner"
        onPlayAgain={onPlayAgain}
        onBackToHome={onBackToHome}
      />,
    );

    const playAgainBtn = screen.getByRole('button', { name: /Jogar Novamente/ });
    const backToHomeBtn = screen.getByRole('button', { name: /Voltar ao Início/ });

    expect(playAgainBtn).toBeInTheDocument();
    expect(backToHomeBtn).toBeInTheDocument();

    fireEvent.click(playAgainBtn);
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    expect(onBackToHome).not.toHaveBeenCalled();

    fireEvent.click(backToHomeBtn);
    expect(onBackToHome).toHaveBeenCalledTimes(1);
  });
});
