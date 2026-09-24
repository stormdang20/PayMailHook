import template from '../../apps-script/Code.gs' with { type: 'text' };

/** Code.gs with this config's endpoint and token, ready to paste into script.google.com. */
export const renderAppsScript = (ingestUrl: string, token: string) =>
  // Replacer functions, so `$&`-style patterns in the values are inserted literally.
  template.replace('{{INGEST_URL}}', () => ingestUrl).replace('{{INGEST_TOKEN}}', () => token);
