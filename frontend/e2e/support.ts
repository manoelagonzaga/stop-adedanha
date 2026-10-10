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

  await hostContext.grantPermissions(['clipboard-read', 'clipboard-write']);
  const invitationButton = host.getByRole('button', { name: new RegExp(`Copiar Link da Sala #${roomCode}`) });
  await invitationButton.click();
  const inviteUrl = await host.evaluate(() => navigator.clipboard.readText());
  expect(new URL(inviteUrl).searchParams.get('room')).toBe(roomCode);

  await guest.goto(inviteUrl);
  await expect(guest.getByLabel('Seu Apelido', { exact: true })).toBeFocused();
  await expect(guest.getByLabel('Dígito 1 do código da sala')).toHaveValue(roomCode[0]);
  await guest.getByLabel('Seu Apelido', { exact: true }).fill('Convidado');
  await guest.getByRole('button', { name: 'Entrar no Jogo Agora' }).click();
  await expect(guest.getByRole('heading', { name: /Sala Privada:/ })).toBeVisible();
  await expect(host.getByText('2 de 20 participantes conectados')).toBeVisible();
  await expect(host.getByText('Convidado')).toBeVisible();
  await expect(guest.getByRole('list').getByText('Anfitrião', { exact: true }).first()).toBeVisible();

  return { hostContext, guestContext, host, guest };
}

export async function prepareSingleCategoryMatch(host: Page): Promise<void> {
  await host.getByRole('button', { name: 'Sem Fim' }).click();
  await expect(host.getByRole('button', { name: 'Sem Fim' })).toHaveAttribute('aria-pressed', 'true');
  await host.getByRole('button', { name: '3', exact: true }).click();
  await expect(host.getByRole('button', { name: '3', exact: true })).toHaveClass(/bg-indigo-600/);
  const categoryInput = host.getByPlaceholder(/Criar categoria personalizada/);
  await categoryInput.fill('Categoria E2E');
  await host.getByRole('button', { name: /Adicionar/ }).click();
  await expect(host.getByText('Categoria E2E', { exact: true })).toBeVisible();
  await expect(host.getByText('Configuração salva pelo servidor.')).toBeVisible();
  const removeCustomCategory = host.getByTitle('Remover Categoria E2E');
  await removeCustomCategory.click();
  await expect(removeCustomCategory).toHaveCount(0);
  const letterA = host.getByRole('button', { name: 'A', exact: true });
  await letterA.click();
  await expect(letterA).toHaveAttribute('aria-pressed', 'false');
  await expect(host.getByText('Configuração salva pelo servidor.')).toBeVisible();
  await letterA.click();
  await expect(letterA).toHaveAttribute('aria-pressed', 'true');
  await expect(host.getByText('Configuração salva pelo servidor.')).toBeVisible();

  for (const category of ['Cidade', 'Animal', 'Comida', 'Objeto']) {
    const removeButton = host.getByTitle(`Remover ${category}`);
    await removeButton.click();
    await expect(removeButton).toHaveCount(0);
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
