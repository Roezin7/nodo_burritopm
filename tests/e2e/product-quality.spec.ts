import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const perfiles = [
  { nombre: 'Admin', pin: '1234', ruta: '/semana/ventas' },
  { nombre: 'Maria (Pilsen)', pin: '5678', ruta: '/semana/ventas' },
  { nombre: 'Beto (Bodega y reparto)', pin: '4321', ruta: '/semana/despacho' },
] as const;
const tieneDemo = process.env.SEED_DEMO === '1' || Boolean(process.env.CI);

async function entrar(page: Page, nombre: string, pin: string) {
  await page.addInitScript(() => {
    sessionStorage.setItem('bpm-splash', '1');
    if (!sessionStorage.getItem('bpm-e2e-storage-ready')) {
      localStorage.removeItem('bpm_token');
      localStorage.removeItem('bpm_ultimo_usuario');
      sessionStorage.setItem('bpm-e2e-storage-ready', '1');
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: nombre, exact: true }).click();
  for (const digito of pin) await page.getByRole('button', { name: digito, exact: true }).click();
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('#main-content')).toBeVisible();
}

async function adjuntarCaptura(page: Page, testInfo: TestInfo, nombre: string) {
  await testInfo.attach(nombre, {
    body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
    contentType: 'image/png',
  });
}

for (const perfil of perfiles) {
  test(`${perfil.nombre}: navegación, adaptación y accesibilidad`, async ({ page }, testInfo) => {
    test.skip(!tieneDemo, 'Requiere la base de datos demo aislada usada por CI.');
    await entrar(page, perfil.nombre, perfil.pin);
    await page.goto(perfil.ruta);
    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.locator('.app-error-fallback')).toHaveCount(0);
    await expect(page.locator('.bottom-link--on')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    const resultados = await new AxeBuilder({ page }).analyze();
    const criticos = resultados.violations.filter((violacion) => ['critical', 'serious'].includes(violacion.impact ?? ''));
    expect(criticos, criticos.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`).join('\n')).toEqual([]);

    await adjuntarCaptura(page, testInfo, `${testInfo.project.name}-${perfil.nombre}.png`);
  });
}

test('diálogo y centro de sincronización contienen y restauran el foco', async ({ page }) => {
  test.skip(!tieneDemo, 'Requiere la base de datos demo aislada usada por CI.');
  await entrar(page, 'Admin', '1234');
  const disparador = page.getByRole('button', { name: /Estado de sincronización/ });
  await disparador.focus();
  await disparador.click();
  const modal = page.getByRole('dialog', { name: 'Sincronización' });
  await expect(modal).toBeVisible();
  await expect(modal.locator(':focus')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(disparador).toBeFocused();
});

test('admin manipula pedidos masivos con teclado como hoja de cálculo', async ({ page }, testInfo) => {
  test.skip(!tieneDemo, 'Requiere la base de datos demo aislada usada por CI.');
  test.skip(testInfo.project.name !== 'desktop-chromium', 'La cuadrícula se usa en escritorio; móvil conserva tarjetas táctiles.');
  await entrar(page, 'Admin', '1234');
  await page.goto('/semana/ventas');
  await expect(page.getByRole('button', { name: 'Orden individual' })).toHaveCount(0);
  const primeraFecha = page.locator('.weekly-sales-sheet').first();
  await primeraFecha.locator('summary').click();
  const celdas = primeraFecha.locator('input[data-grid-mode="desktop"]:not(:disabled)');
  await expect(celdas).not.toHaveCount(0);
  expect(await celdas.count()).toBeGreaterThan(2);

  await celdas.nth(0).fill('11');
  await celdas.nth(0).press('Enter');
  await expect(celdas.nth(1)).toBeFocused();
  await celdas.nth(1).fill('12');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await expect(celdas.nth(2)).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(celdas.nth(1)).toHaveValue('');
  await expect(celdas.nth(2)).toHaveValue('');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(celdas.nth(1)).toHaveValue('12');
});

test('acceso público: identidad, adaptación y accesibilidad', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('bpm-splash', '1');
    localStorage.removeItem('bpm_token');
  });
  await page.goto('/');
  await expect(page).toHaveTitle('Acceso · NODO');
  await expect(page.getByText('¿Quién eres?')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const resultados = await new AxeBuilder({ page }).analyze();
  const criticos = resultados.violations.filter((violacion) => ['critical', 'serious'].includes(violacion.impact ?? ''));
  expect(criticos, criticos.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`).join('\n')).toEqual([]);
  await adjuntarCaptura(page, testInfo, `${testInfo.project.name}-acceso.png`);
});
