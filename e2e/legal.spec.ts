import { expect, test } from '@playwright/test';

test('privacy and terms are public, reloadable, and linked from the homepage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Quyền riêng tư' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Privacy Policy | PayMailHook');
  await expect(page.getByRole('article')).toContainText('gmail.readonly');
  await expect(page.getByRole('article')).toContainText('Limited Use');
  await expect(page.getByRole('link', { name: 'dqst09@gmail.com', exact: true })).toHaveAttribute(
    'href',
    'mailto:dqst09@gmail.com',
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();

  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Điều khoản sử dụng' }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole('heading', { name: 'Terms of Service', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Terms of Service | PayMailHook');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Terms of Service', exact: true })).toBeVisible();
  await page.getByRole('article').getByRole('link', { name: 'Privacy Policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
});

test('legal pages fit a mobile viewport without requiring sign-in', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/privacy', '/terms']) {
    await page.goto(path);
    await expect(page.getByRole('article')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
