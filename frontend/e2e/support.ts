import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export async function createTwoPlayers(browser: Browser): Promise<{
  hostContext: BrowserContext;
  guestContext: BrowserContext;
  host: Page;
  guest: Page;
}> {
  const contextOptions = { reducedMotion: 'reduce' as const };
  const hostContext = await browser.newContext(contextOptions);
  const guestContext = await browser.newContext(contextOptions);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('/');
  await host.getByLabel('Seu Apelido no Jogo').fill('Anfitrião');
  await host.getByRole('button', { name: 'Criar Sala e Convidar Amigos' }).click();
  const roomHeading = host.getByRole('heading', { name: /Sala Privada:/ });
  await expect(roomHeading).toBeVisible();
  const roomCode = (await roomHeading.textContent())?.match(/#([A-Z2-9]{6})/)?.[1];
  if (!roomCode) throw new Error('The server did not provide a valid room code.');

  await guest.goto('/');
  await guest.getByLabel('Seu Apelido', { exact: true }).fill('Convidado');
  for (const [index, digit] of [...roomCode].entries()) {
    await guest.getByLabel(`Dígito ${index + 1} do código da sala`).fill(digit);
  }
  await guest.getByRole('button', { name: 'Entrar no Jogo Agora' }).click();
  await expect(guest.getByRole('heading', { name: /Sala Privada:/ })).toBeVisible();

  return { hostContext, guestContext, host, guest };
}

export async function prepareSingleCategoryMatch(host: Page): Promise<void> {
  await host.getByRole('button', { name: 'Sem Fim' }).click();
  await host.getByRole('button', { name: '3', exact: true }).click();
  for (const category of ['Cidade', 'Animal', 'Comida', 'Objeto']) {
    await host.getByTitle(`Remover ${category}`).click();
  }
  await expect(host.getByText('Nome', { exact: true })).toBeVisible();
}

export async function submitRoundAnswers(host: Page, guest: Page, round: number): Promise<void> {
  const heading = new RegExp(`Rodada ${round} de 3`);
  await expect(host.locator('[data-game-screen] h1')).toContainText(heading);
  await expect(guest.locator('[data-game-screen] h1')).toContainText(heading);
  for (const page of [host, guest]) {
    const prompt = await page.getByRole('heading', { name: /Preencha com a Letra/ }).textContent();
    const letter = prompt?.match(/Letra\s+([A-Z])/)?.[1];
    if (!letter) throw new Error('The server did not provide the round letter.');
    await page.getByRole('textbox').fill(`${letter}resposta`);
  }

  await host.getByRole('button', { name: 'Gritar STOP!' }).click();
  await expect(host.locator('[data-game-screen] h1')).toContainText('Rodada');
  await expect(guest.locator('[data-game-screen] h1')).toContainText('Rodada');
  await expect(host.getByRole('button', { name: 'Válida' })).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Válida' })).toBeVisible();
  await Promise.all([
    host.locator('article').filter({ hasText: 'Convidado' }).getByRole('button', { name: 'Válida' }).click(),
    guest.locator('article').filter({ hasText: 'Anfitrião' }).getByRole('button', { name: 'Válida' }).click(),
  ]);
}
