import { expect, test } from '@playwright/test';

test('sign up, add a Gmail, receive a bank email, see the transaction and a delivered webhook', async ({
  page,
  request,
}) => {
  const gmail = `shop.${Date.now()}@gmail.com`;

  await page.goto('/sign-up');
  await page.getByLabel('Tên đăng nhập').fill(`owner${Date.now()}`);
  await page.getByLabel('Email').fill(`owner.${Date.now()}@test.dev`);
  await page.getByLabel('Mật khẩu').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kết nối' })).toBeVisible();

  await expect(page.getByRole('combobox', { name: 'Cách nhận email' })).toHaveText('Chuyển tiếp email');
  await page.getByLabel('Gmail').fill(gmail);
  await page.getByLabel('URL webhook (không bắt buộc)').fill('http://localhost:4455/__e2e/hook');
  await page.getByRole('button', { name: 'Thêm' }).click();
  await expect(page.getByRole('dialog')).toContainText('whsec_');
  await page.keyboard.press('Escape');

  // The bank email reaches the config's forwarding address.
  const address = await page.locator('code').filter({ hasText: /^pmh-/ }).textContent();
  const forwarded = await request.post(`/__e2e/forward?gmail=${gmail}&to=${address}`);
  expect(await forwarded.json()).toMatchObject({ ok: true, status: 'stored' });

  await page.getByRole('link', { name: 'Giao dịch' }).click();
  const row = page.getByRole('row').filter({ hasText: 'PMH123456' });
  await expect(row).toContainText('+149.000');
  await expect(row).toContainText('123456');

  await page.getByRole('link', { name: 'Webhook' }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: '123456' })).toContainText('Thành công', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  // The bank multi-select really submits the chosen subset (hidden inputs follow the ticked boxes).
  await page.getByRole('link', { name: 'Kết nối' }).click();
  const cardBanks = page.getByRole('button', { name: 'Ngân hàng' }).nth(1);
  await expect(cardBanks).toHaveText('Tất cả ngân hàng');
  await cardBanks.click();
  await page.getByRole('menuitemcheckbox', { name: 'CAKE by VPBank' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'PayPal' }).click();
  await page.keyboard.press('Escape');
  await expect(cardBanks).toHaveText('Timo');
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByText('Đã lưu')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ngân hàng' }).nth(1)).toHaveText('Timo');
});
