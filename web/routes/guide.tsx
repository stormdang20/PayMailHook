import { Link } from 'react-router';
import { SAMPLE_PAYLOAD } from '@/lib/webhook-sample';

const NODE = `// npm install standardwebhooks
import express from 'express';
import { Webhook } from 'standardwebhooks';

const wh = new Webhook(process.env.PAYMAILHOOK_SECRET); // whsec_...
const app = express();

// Dùng body thô: chữ ký được tính trên đúng các byte đã gửi.
app.post('/webhooks/paymailhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = wh.verify(req.body, req.headers);
  } catch {
    return res.status(401).end();
  }
  const id = req.headers['webhook-id'];
  if (await alreadyHandled(id)) return res.status(200).end(); // vẫn trả 2xx khi trùng
  const { orderId, transaction } = event.data;
  await markOrderPaid(orderId, transaction.amount); // khớp cả mã đơn và số tiền
  res.status(200).end();
});`;

const PHP = `<?php
// composer require standard-webhooks/standard-webhooks
$wh = new \\StandardWebhooks\\Webhook(getenv('PAYMAILHOOK_SECRET')); // whsec_...
$headers = array_change_key_case(getallheaders(), CASE_LOWER);
try {
    $event = $wh->verify(file_get_contents('php://input'), $headers);
} catch (\\Exception $e) {
    http_response_code(401);
    exit;
}
// Chống trùng theo $headers['webhook-id'], rồi khớp orderId + amount với đơn hàng.
http_response_code(200);`;

const PYTHON = `# pip install standardwebhooks
from flask import Flask, request
from standardwebhooks.webhooks import Webhook
import os

wh = Webhook(os.environ["PAYMAILHOOK_SECRET"])  # whsec_...
app = Flask(__name__)

@app.post("/webhooks/paymailhook")
def paymailhook():
    try:
        headers = {k.lower(): v for k, v in request.headers.items()}
        event = wh.verify(request.get_data(), headers)
    except Exception:
        return "", 401
    # Chống trùng theo headers["webhook-id"], rồi khớp orderId + amount.
    return "", 200`;

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">{children}</pre>;
}

export function GuidePage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-8 text-sm leading-relaxed">
      <header className="space-y-2">
        <h1 className="font-semibold text-2xl">Hướng dẫn tích hợp webhook</h1>
        <p className="text-muted-foreground">
          Khi có tiền vào với nội dung chứa <code>&lt;tiền tố&gt;&lt;mã đơn&gt;</code> (mặc định <code>PMH123456</code>
          ), PayMailHook gửi một request <code>POST</code> tới URL webhook của bạn theo chuẩn{' '}
          <a className="underline" href="https://www.standardwebhooks.com/" target="_blank" rel="noreferrer">
            Standard Webhooks
          </a>
          .
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="font-semibold text-lg">Request</h2>
        <Code>{`POST <URL webhook của bạn>
content-type: application/json
webhook-id: <id, giữ nguyên qua mọi lần gửi lại>
webhook-timestamp: <unix giây>
webhook-signature: v1,<base64 HMAC-SHA256>`}</Code>
        <Code>{JSON.stringify(SAMPLE_PAYLOAD, null, 2)}</Code>
        <p>
          <code>amount</code> là số nguyên VND. <code>balanceAfter</code> chỉ có với Timo, <code>bankTxnId</code> chỉ có
          với CAKE.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-lg">Quy tắc phía nhận</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Xác thực chữ ký bằng thư viện Standard Webhooks, cho lệch thời gian tối đa 5 phút (thư viện mặc định).
          </li>
          <li>
            Chống trùng theo <code>webhook-id</code>. <strong>Vẫn trả 2xx khi trùng</strong>, nếu không hệ thống sẽ tiếp
            tục gửi lại.
          </li>
          <li>
            Khớp cả <code>orderId</code> <strong>và</strong> <code>amount</code> với đơn hàng; chỉ chuyển trạng thái đơn
            đang chờ thanh toán.
          </li>
          <li>Trả 2xx trong vòng 10 giây. Việc nặng hãy đẩy vào hàng đợi của bạn rồi trả lời ngay.</li>
        </ol>
        <p>
          Chỉ 2xx được coi là thành công (3xx cũng là lỗi). Lỗi sẽ được gửi lại sau 10s, 10s, 20s, 30s, 50s, 1h, 2h, 4h,
          8h (tổng 10 lần trong khoảng 15 giờ); bạn cũng có thể gửi lại thủ công trong trang Webhook.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-lg">Node.js</h2>
        <Code>{NODE}</Code>
        <h2 className="font-semibold text-lg">PHP</h2>
        <Code>{PHP}</Code>
        <h2 className="font-semibold text-lg">Python</h2>
        <Code>{PYTHON}</Code>
      </section>

      <footer className="text-muted-foreground">
        <Link className="underline" to="/privacy">
          Quyền riêng tư
        </Link>
      </footer>
    </article>
  );
}
