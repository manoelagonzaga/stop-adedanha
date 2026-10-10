import { expect, test } from '@playwright/test';
import { createTwoPlayers } from './support';

test('supports keyboard Stop, focuses phase headings, and respects reduced motion', async ({ browser }) => {
  const { hostContext, guestContext, host, guest } = await createTwoPlayers(browser);
  try {
    await host.emulateMedia({ reducedMotion: 'reduce' });
    await expect
      .poll(() => host.locator('.bg-shape').first().evaluate((element) => getComputedStyle(element).animationName))
      .toBe('none');

    await host.getByRole('button', { name: 'Sem Fim' }).click();
    await host.getByRole('button', { name: '3', exact: true }).click();
    for (const category of ['Animal', 'Comida', 'Objeto']) {
      await host.getByTitle(`Remover ${category}`).click();
    }
    await host.getByRole('button', { name: /play_circle Iniciar Partida/ }).click();
    const prompt = await host.getByRole('heading', { name: /Preencha com a Letra/ }).textContent();
    const letter = prompt?.match(/Letra\s+([A-Z])/)?.[1];
    if (!letter) throw new Error('The server did not provide the round letter.');

    const hostAnswer = host.getByRole('textbox').nth(0);
    const guestPrompt = await guest.getByRole('heading', { name: /Preencha com a Letra/ }).textContent();
    const guestLetter = guestPrompt?.match(/Letra\s+([A-Z])/)?.[1];
    if (!guestLetter) throw new Error('The server did not provide the guest round letter.');
    for (const page of [host, guest]) {
      const currentLetter = page === host ? letter : guestLetter;
      const inputs = page.getByRole('textbox');
      await inputs.nth(0).fill(`${currentLetter}resposta`);
      await inputs.nth(1).fill(`${currentLetter}cidade`);
    }

    await hostAnswer.focus();
    await hostAnswer.press('Enter');
    await expect(host.locator('[data-game-screen] h1')).toBeFocused();
    await expect(host.locator('p.sr-only[role="status"]')).toContainText(/Revisão da categoria/);

    await Promise.all([
      host.locator('article').filter({ hasText: 'Convidado' }).getByRole('button', { name: 'Válida' }).click(),
      guest.locator('article').filter({ hasText: 'Anfitrião' }).getByRole('button', { name: 'Válida' }).click(),
    ]);
    await expect(host.locator('p.sr-only[role="status"]')).toContainText('Cidade');
    await expect(host.locator('[data-game-screen] h1')).toBeFocused();
    await Promise.all([
      host.locator('article').filter({ hasText: 'Convidado' }).getByRole('button', { name: 'Válida' }).click(),
      guest.locator('article').filter({ hasText: 'Anfitrião' }).getByRole('button', { name: 'Válida' }).click(),
    ]);
    await expect(host.locator('[data-game-screen] h1')).toBeFocused();
    await expect(host.getByRole('button', { name: 'Próxima Rodada' })).toBeVisible();
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});
