import { expect, test } from 'bun:test';
import { renderAppsScript } from '../src/core/apps-script';

test('fills the ingest URL and token into Code.gs', () => {
  const code = renderAppsScript('https://pmh.example.workers.dev/api/ingest', 'tok$&en');
  expect(code).toContain("const INGEST_URL = 'https://pmh.example.workers.dev/api/ingest';");
  expect(code).toContain("const INGEST_TOKEN = 'tok$&en';");
  expect(code).not.toContain('{{');
});
