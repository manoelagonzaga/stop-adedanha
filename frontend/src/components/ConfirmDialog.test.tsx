import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('does not render when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Encerrar e deletar sala?"
        description="Esta ação apaga a sala."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders an accessible dialog with labelled content when open', () => {
    render(
      <ConfirmDialog
        open
        title="Encerrar e deletar sala?"
        description="Esta ação apaga a sala permanentemente."
        confirmLabel="Encerrar e deletar"
        cancelLabel="Cancelar"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Encerrar e deletar sala?');
    expect(dialog).toHaveAccessibleDescription('Esta ação apaga a sala permanentemente.');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('calls onCancel for Escape, backdrop and cancel button', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Descartar sala em rascunho?"
        description="A sala será deletada."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Fechar diálogo' }));
    expect(onCancel).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it('calls onConfirm when the confirm action is pressed', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Encerrar e deletar sala?"
        description="Todos serão desconectados."
        confirmLabel="Encerrar e deletar"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar e deletar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not cancel or confirm while busy', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        busy
        title="Encerrar e deletar sala?"
        description="Processando…"
        confirmLabel="Encerrar e deletar"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar diálogo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aguarde…' }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
