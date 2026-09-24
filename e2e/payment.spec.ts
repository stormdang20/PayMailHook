import { expect, test } from '@playwright/test';

test('sign up, add a Gmail, receive a bank email, see the transaction and a delivered webhook', async ({
  page,
  request,
}) => {
  const gmail = `shop.${Date.now()}@gmail.com`;

  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(`owner.${Date.now()}@test.dev`);
  await page.getByLabel('Mật khẩu').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Đăng ký' }).click();
  await expect(page.getByText('Thêm Gmail nhận biến động số dư')).toBeVisible();

  await page.getByLabel('Gmail').fill(gmail);
  await page.getByLabel('URL webhook (không bắt buộc)').fill('http://localhost:4455/__e2e/hook');
  await page.getByRole('button', { name: 'Thêm' }).click();
  const script = await page.getByRole('dialog').locator('textarea').inputValue();
  const token = script.match(/const INGEST_TOKEN = '([^']+)'/)?.[1];
  expect(token).toBeTruthy();
  await page.keyboard.press('Escape');

  // What Apps Script does: post the raw bank email with the config's token.
  const raw = await (await request.get(`/__e2e/signed-email?to=${gmail}`)).body();
  const ingest = await request.post('/api/ingest', {
    headers: { authorization: `Bearer ${token}`, 'content-type': 'message/rfc822' },
    data: raw,
  });
  expect(await ingest.json()).toMatchObject({ ok: true, status: 'stored' });

  await page.getByRole('link', { name: 'Giao dịch' }).click();
  const row = page.getByRole('row').filter({ hasText: 'PMH123456' });
  await expect(row).toContainText('+149.000');
  await expect(row).toContainText('123456');

  await page.getByRole('link', { name: 'Webhook' }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: '123456' })).toContainText('Thành công', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
});
