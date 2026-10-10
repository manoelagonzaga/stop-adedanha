import { expect, test } from '@playwright/test';
import { createTwoPlayers, prepareSingleCategoryMatch, submitRoundAnswers } from './support';

test('two players complete a three-round match with host-confirmed progression', async ({ browser }) => {
  const { hostContext, guestContext, host, guest } = await createTwoPlayers(browser);
  try {
    await prepareSingleCategoryMatch(host);
    await host.getByRole('button', { name: /play_circle Iniciar Partida/ }).click();
    await expect(host.locator('[data-game-screen] h1')).toContainText('Rodada 1 de 3');
    await expect(host.locator('[role="alert"]')).toHaveCount(0);

    for (let round = 1; round <= 3; round += 1) {
      await submitRoundAnswers(host, guest, round);
      if (round < 3) {
        await expect(host.getByRole('button', { name: 'Próxima Rodada' })).toBeVisible();
        await expect(guest.getByText('Aguardando o anfitrião iniciar a próxima rodada.')).toBeVisible();
        await host.getByRole('button', { name: 'Próxima Rodada' }).click();
      }
    }

    await expect(host.getByRole('heading', { name: '🏆 Pódio Final' })).toBeVisible();
    await expect(guest.getByRole('heading', { name: '🏆 Pódio Final' })).toBeVisible();
    await expect(host.locator('[data-game-screen] h1')).toBeFocused();
    await expect(guest.locator('[data-game-screen] h1')).toBeFocused();
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});
