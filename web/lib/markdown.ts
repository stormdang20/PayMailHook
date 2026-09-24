import { Marked } from 'marked';

/** GitHub-style heading ids, so in-page links like `#pagination` work the same here and on GitHub. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

/**
 * Renders the repo's own docs (trusted, bundled at build time; never user input) with the
 * placeholders replaced by this instance's URL, so copied snippets work as-is.
 */
export const renderDocs = (md: string) => marked.parse(withOrigin(md), { async: false });

export const withOrigin = (md: string) =>
  md
    .replaceAll('https://<your-paymailhook>', location.origin)
    .replaceAll('https://<PAYMAILHOOK_URL>', location.origin)
    .replaceAll('<PAYMAILHOOK_URL>', location.origin);
