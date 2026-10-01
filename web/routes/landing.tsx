import { BellRing, Bot, type LucideIcon, Mailbox, QrCode, ShieldCheck, Webhook } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '@/components/logo';
import { OrderCode } from '@/components/order-code';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth';

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Mailbox,
    title: 'Không cần API ngân hàng',
    text: 'Dùng chính email thông báo biến động số dư mà CAKE, Timo và PayPal đã gửi cho bạn. Không hợp đồng, không phí giao dịch.',
  },
  {
    icon: ShieldCheck,
    title: 'Không thể giả mạo',
    text: 'Chỉ chấp nhận email có chữ ký DKIM hợp lệ của ngân hàng và gửi đúng tới Gmail của bạn. Email chuyển tiếp hay sửa nội dung đều bị loại.',
  },
  {
    icon: Webhook,
    title: 'Webhook đáng tin',
    text: 'Ký theo chuẩn Standard Webhooks, tự gửi lại 10 lần trong khoảng 15 giờ nếu hệ thống của bạn lỗi, có log từng lần gửi và nút gửi lại.',
  },
  {
    icon: BellRing,
    title: 'Ba cách kết nối Gmail',
    text: 'Dùng App Password qua IMAP, cấp quyền đọc bằng tài khoản Google, hoặc chuyển tiếp email ngân hàng. Kèm thông báo đẩy khi có tiền vào.',
  },
  {
    icon: QrCode,
    title: 'Mã VietQR điền sẵn',
    text: 'Tạo mã QR có sẵn số tài khoản, số tiền và mã đơn. Khách quét bằng app ngân hàng là chuyển đúng nội dung.',
  },
  {
    icon: Bot,
    title: 'Tích hợp trong một buổi',
    text: 'REST API, MCP cho trợ lý AI, và một prompt để coding agent tự thêm thanh toán vào ứng dụng của bạn.',
  },
];

const STEPS = [
  {
    title: 'Kết nối Gmail',
    text: 'Gmail đang nhận email thông báo của CAKE, Timo hoặc PayPal, và URL webhook của hệ thống bạn.',
  },
  {
    title: 'Khách chuyển khoản',
    text: 'Nội dung chứa mã đơn, ví dụ PMH123456. Mã VietQR điền sẵn giúp khách không gõ sai.',
  },
  {
    title: 'PayMailHook xác thực',
    text: 'Kiểm tra chữ ký DKIM của ngân hàng, đọc số tiền và tách mã đơn, thường trong vài giây.',
  },
  {
    title: 'Đơn tự xác nhận',
    text: 'Hệ thống của bạn nhận webhook đã ký, đối chiếu mã đơn và số tiền rồi chuyển đơn sang đã thanh toán.',
  },
];

const USES = [
  'Tự xác nhận thanh toán cho cửa hàng online, khoá học, dịch vụ đăng ký.',
  'Màn hình thu ngân xem tiền vào theo thời gian thực bằng link chia sẻ, không cần tài khoản.',
  'Đẩy giao dịch sang CRM, ERP hay bảng tính qua webhook hoặc REST API.',
  'Hỏi trợ lý AI "đơn 123 đã thanh toán chưa?" qua MCP.',
];

const FAQ = [
  {
    q: 'PayMailHook là gì?',
    a: 'Dịch vụ đọc email thông báo biến động số dư của ngân hàng, nhận ra khoản chuyển khoản có mã đơn hàng, rồi báo cho hệ thống của bạn bằng webhook. Nhờ vậy bạn nhận chuyển khoản tự động mà không cần tích hợp API ngân hàng.',
  },
  {
    q: 'Hỗ trợ những ngân hàng nào?',
    a: 'CAKE by VPBank và Timo. Tài khoản ngân hàng cần bật thông báo biến động số dư qua email tới một Gmail.',
  },
  {
    q: 'Tôi cần chuẩn bị gì?',
    a: 'Một Gmail đang nhận email thông báo của ngân hàng, và một URL trên hệ thống của bạn để nhận webhook. Phần tích hợp có tài liệu và prompt mẫu cho coding agent.',
  },
  {
    q: 'Dữ liệu của tôi được lưu thế nào?',
    a: 'PayMailHook kiểm tra metadata để nhận diện email ngân hàng rồi đọc nội dung các email phù hợp. Hệ thống lưu các trường giao dịch; email xử lý thành công không được lưu nguyên văn. Một số email lỗi được lưu mã hoá và dọn sau 7 ngày. Webhook secret và App Password được mã hoá; lịch sử webhook đã hoàn tất hoặc thất bại được dọn sau 30 ngày.',
  },
  {
    q: 'Nếu hệ thống của tôi lỗi thì webhook có bị mất không?',
    a: 'Không. Mỗi lần gửi thất bại được thử lại sau 10 giây, rồi giãn dần tới 8 giờ, tổng cộng 10 lần trong khoảng 15 giờ. Sau đó bạn vẫn gửi lại được từ trang Webhook.',
  },
  {
    q: 'Có mất phí không?',
    a: 'Không. PayMailHook không thu phí theo giao dịch và bạn nhận tiền thẳng vào tài khoản ngân hàng của mình.',
  },
];

/** The product in one moment: the bank's email arrives, is verified, and the shop is told. Plays once. */
function HeroStory() {
  const step = 'animate-arrive motion-reduce:animate-none';
  return (
    <figure
      className="relative mx-auto w-full max-w-sm space-y-3"
      aria-label="Ví dụ: một khoản chuyển khoản được xác nhận"
    >
      <div className={`${step} rounded-xl border bg-card p-4 shadow-sm [animation-delay:150ms]`}>
        <p className="text-muted-foreground text-xs">Email từ CAKE by VPBank, vừa xong</p>
        <p className="mt-1 font-semibold text-3xl text-primary tabular-nums">+149.000 đ</p>
        <p className="mt-1 text-sm">
          Nội dung: <OrderCode code="PMH123456" />
        </p>
      </div>
      <div
        className={`${step} ml-6 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm [animation-delay:800ms]`}
      >
        <ShieldCheck className="size-4 text-primary" />
        Chữ ký DKIM của cake.vn hợp lệ
      </div>
      <div
        className={`${step} ml-12 rounded-lg bg-foreground px-3 py-2.5 font-mono text-background text-xs [animation-delay:1450ms]`}
      >
        <p className="text-background/60">POST https://shop.vn/webhooks/paymailhook</p>
        <p className="mt-1">
          <span className="text-highlight">200 OK</span> đơn 123456 đã thanh toán
        </p>
      </div>
    </figure>
  );
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 py-16 md:py-24">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="font-semibold text-2xl tracking-tight md:text-3xl">{title}</h2>
        {lead && <p className="mt-2 max-w-2xl text-muted-foreground">{lead}</p>}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

function Header({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-6 px-4">
        <Link to="/" aria-label="PayMailHook">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-5 text-muted-foreground text-sm md:flex">
          <a href="#tinh-nang" className="hover:text-foreground">
            Tính năng
          </a>
          <a href="#cach-hoat-dong" className="hover:text-foreground">
            Cách hoạt động
          </a>
          <a href="#hoi-dap" className="hover:text-foreground">
            Hỏi đáp
          </a>
          <Link to="/docs" className="hover:text-foreground">
            Tài liệu
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {signedIn ? (
            <Button asChild>
              <Link to="/dashboard">Mở dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link to="/sign-in">Đăng nhập</Link>
              </Button>
              <Button asChild>
                <Link to="/sign-up">Tạo tài khoản</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function LandingPage() {
  const { data: session } = authClient.useSession();
  return (
    <div className="min-h-svh">
      <Header signedIn={Boolean(session)} />
      <main>
        <section className="mx-auto grid max-w-5xl items-center gap-12 px-4 py-16 md:grid-cols-[1.15fr_1fr] md:py-24">
          <div className="space-y-6">
            <h1 className="font-semibold text-4xl leading-tight tracking-tight md:text-5xl">
              Khách chuyển khoản, đơn hàng tự xác nhận.
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              PayMailHook đọc email biến động số dư của CAKE, Timo và email nhận tiền PayPal, kiểm tra chữ ký của ngân
              hàng, rồi báo cho hệ thống của bạn bằng webhook trong vài giây.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to={session ? '/dashboard' : '/sign-up'}>{session ? 'Mở dashboard' : 'Tạo tài khoản'}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/docs">Xem tài liệu tích hợp</Link>
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">Đang hỗ trợ CAKE by VPBank và Timo.</p>
          </div>
          <HeroStory />
        </section>

        <div className="border-y bg-card">
          <Section id="tinh-nang" title="Tính năng" lead="Những gì bạn cần để nhận chuyển khoản tự động, không hơn.">
            <ul className="grid gap-x-12 gap-y-10 md:grid-cols-2">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex gap-4">
                  <f.icon className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={1.75} />
                  <div>
                    <h3 className="font-medium">{f.title}</h3>
                    <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{f.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <Section id="cach-hoat-dong" title="Cách hoạt động">
          <div className="grid gap-12 md:grid-cols-[1.2fr_1fr]">
            <ol className="space-y-6">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground text-sm">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-medium">{s.title}</h3>
                    <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="rounded-xl border bg-card p-6">
              <h3 className="font-medium">Dùng vào việc gì</h3>
              <ul className="mt-4 space-y-3 text-sm">
                {USES.map((u) => (
                  <li key={u} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    {u}
                  </li>
                ))}
              </ul>
              <Button asChild variant="outline" className="mt-6">
                <Link to="/docs">Xem API và định dạng webhook</Link>
              </Button>
            </div>
          </div>
        </Section>

        <div className="border-t bg-card">
          <Section id="hoi-dap" title="Câu hỏi thường gặp">
            <Accordion type="single" collapsible className="max-w-3xl">
              {FAQ.map((f) => (
                <AccordionItem key={f.q} value={f.q}>
                  <AccordionTrigger className="text-base">{f.q}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground leading-relaxed">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Section>
        </div>

        <section className="bg-primary text-primary-foreground">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-6 px-4 py-14">
            <div>
              <h2 className="font-semibold text-2xl tracking-tight">Bắt đầu nhận chuyển khoản tự động</h2>
              <p className="mt-1 text-primary-foreground/80">Kết nối Gmail và nhận webhook đầu tiên trong vài phút.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" variant="secondary">
                <Link to={session ? '/dashboard' : '/sign-up'}>{session ? 'Mở dashboard' : 'Tạo tài khoản'}</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
              >
                <Link to="/docs">Xem tài liệu tích hợp</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-muted-foreground text-sm">
          <span>© 2026 PayMailHook</span>
          <nav className="flex flex-wrap gap-5">
            <Link to="/docs" className="hover:text-foreground">
              Tài liệu
            </Link>
            <Link to="/privacy" className="hover:text-foreground">
              Quyền riêng tư
            </Link>
            <Link to="/terms" className="hover:text-foreground">
              Điều khoản sử dụng
            </Link>
            <a href="https://github.com/stormdang20/PayMailHook/issues" className="hover:text-foreground">
              Báo lỗi và góp ý
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
