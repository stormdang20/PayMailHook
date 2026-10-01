import { expect, test } from '@playwright/test';

test('Google intake hides the email field and automatically adds the selected mailbox after consent', async ({
  page,
}) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        socialProviders: ['google'],
        imap: false,
        gmailOAuth: true,
        forwarding: true,
        vapidPublicKey: null,
      },
    }),
  );
  await page.goto('/sign-up');
  await page.getByLabel('Tên đăng nhập').fill(`gmail${Date.now()}`);
  await page.getByLabel('Email').fill(`gmail.${Date.now()}@test.dev`);
  await page.getByLabel('Mật khẩu').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kết nối' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Cách nhận email' })).toHaveText('Đăng nhập Google (Gmail OAuth)');
  await expect(page.getByLabel('Gmail', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Đăng nhập với Google', exact: true })).toBeVisible();

  await page.getByRole('combobox', { name: 'Cách nhận email' }).click();
  await page.getByRole('option', { name: 'Chuyển tiếp email', exact: true }).click();
  await expect(page.getByLabel('Gmail', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Cách nhận email' }).click();
  await page.getByRole('option', { name: 'Đăng nhập Google (Gmail OAuth)', exact: true }).click();

  let createCount = 0;
  await page.route('**/api/email-configs', async (route) => {
    if (route.request().method() === 'POST') createCount++;
    await route.continue();
  });
  await page.route('**/api/auth/link-social', (route) => {
    const body = route.request().postDataJSON();
    expect(body.scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(body.additionalParams.prompt).toContain('select_account');
    expect(body.callbackURL).toBe(`/dashboard?gmail=${body.additionalData.gmailConnect}`);
    return route.fulfill({ json: { url: `http://localhost:4455${body.callbackURL}`, redirect: true } });
  });
  let connected = false;
  await page.route('**/api/gmail/connect', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ banks: ['TIMO'], webhookUrl: 'https://shop.test/payment' });
    connected = true;
    await route.fulfill({
      json: { config: { id: crypto.randomUUID(), gmail: 'chosen@gmail.com' }, webhookSecret: 'whsec_example' },
    });
  });
  await page.getByRole('button', { name: 'Ngân hàng' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'CAKE by VPBank' }).click();
  await page.keyboard.press('Escape');
  await page.getByLabel('URL webhook (không bắt buộc)').fill('https://shop.test/payment');
  await page.getByRole('button', { name: 'Đăng nhập với Google', exact: true }).click();
  await expect(page.getByText('Đã kết nối chosen@gmail.com')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('whsec_example');
  expect(connected).toBe(true);
  expect(createCount).toBe(0);
});

test('cancelled Google consent shows an error without creating an email config', async ({ page }) => {
  await page.goto('/sign-up');
  await page.getByLabel('Tên đăng nhập').fill(`cancel${Date.now()}`);
  await page.getByLabel('Email').fill(`cancel.${Date.now()}@test.dev`);
  await page.getByLabel('Mật khẩu').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kết nối' })).toBeVisible();
  const flow = crypto.randomUUID();
  await page.evaluate((flowId) => sessionStorage.setItem(`gmail:${flowId}`, '{}'), flow);
  let finished = false;
  await page.route('**/api/gmail/connect', (route) => {
    finished = true;
    return route.fulfill({ status: 500 });
  });
  await page.goto(`/dashboard?gmailError=${flow}&error=access_denied`);
  await expect(page.getByText(/Chưa được cấp quyền đọc Gmail/)).toBeVisible();
  await expect(page.getByText('Chưa kết nối Gmail nào', { exact: true })).toBeVisible();
  expect(finished).toBe(false);
  expect(await page.evaluate((flowId) => sessionStorage.getItem(`gmail:${flowId}`), flow)).toBeNull();
});
