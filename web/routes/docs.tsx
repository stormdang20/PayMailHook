import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { renderDocs, withOrigin } from '@/lib/markdown';
import apiMd from '../../docs/api.md?raw';
import promptMd from '../../docs/integration-prompt.md?raw';

// The part of integration-prompt.md meant to be pasted into an agent (below the first rule).
const prompt = promptMd.split('\n---\n')[1]?.trim() ?? promptMd;
const api = renderDocs(apiMd);
const promptHtml = renderDocs(promptMd);

function Prose({ html }: { html: string }) {
  return (
    <article
      className="prose prose-slate max-w-3xl prose-headings:scroll-mt-20 prose-a:text-primary prose-code:before:content-none prose-code:after:content-none prose-pre:bg-foreground prose-table:text-sm"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: renders the repo's own Markdown docs, bundled at build time
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function DocsPage() {
  const copyPrompt = () =>
    navigator.clipboard.writeText(withOrigin(prompt)).then(
      () => toast.success('Đã copy prompt, dán vào coding agent trong repo ứng dụng của bạn'),
      () => toast.error('Không copy được, hãy chọn và copy thủ công'),
    );
  return (
    <PublicShell wide>
      <Tabs defaultValue={location.hash === '#prompt' ? 'prompt' : 'api'}>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="api">Tài liệu API</TabsTrigger>
            <TabsTrigger value="prompt">Prompt tích hợp</TabsTrigger>
          </TabsList>
          <Button variant="outline" onClick={copyPrompt}>
            <Copy />
            Copy prompt tích hợp
          </Button>
        </div>
        <TabsContent value="api">
          <Prose html={api} />
        </TabsContent>
        <TabsContent value="prompt">
          <Prose html={promptHtml} />
        </TabsContent>
      </Tabs>
    </PublicShell>
  );
}
