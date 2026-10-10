import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/Toast';
import { EntryScreen } from './EntryScreen';

describe('EntryScreen room join feedback', () => {
  it('preserves nickname and room code when a join is rejected', () => {
    const onEnterRoom = vi.fn();
    const props = {
      onEnterRoom,
      onCreateRoom: vi.fn(),
      error: null,
    };
    const { rerender } = render(
      <ToastProvider>
        <EntryScreen {...props} />
      </ToastProvider>,
    );

    const textInputs = screen.getAllByRole('textbox');
    fireEvent.change(textInputs[1], { target: { value: 'Guest123' } });
    for (const [index, char] of ['A', 'B', 'C', '2', '3', '4'].entries()) {
      fireEvent.change(textInputs[index + 2], { target: { value: char } });
    }

    fireEvent.click(screen.getByRole('button', { name: /Entrar no Jogo Agora/ }));
    expect(onEnterRoom).toHaveBeenCalledWith('Guest123', 'ABC234');

    rerender(
      <ToastProvider>
        <EntryScreen {...props} error="ROOM_NOT_FOUND: Room does not exist" />
      </ToastProvider>,
    );

    const inputsAfterError = screen.getAllByRole('textbox');
    expect(inputsAfterError[1]).toHaveValue('Guest123');
    expect(inputsAfterError.slice(2).map((input) => (input as HTMLInputElement).value)).toEqual([
      'A',
      'B',
      'C',
      '2',
      '3',
      '4',
    ]);
    expect(screen.getByText(/ROOM_NOT_FOUND/)).toBeInTheDocument();
  });
});
