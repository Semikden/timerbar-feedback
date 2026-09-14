/* ================================================================
   Cloudflare Pages Function — POST /api/feedback
   Принимает JSON с формы, шлёт в выбранный канал:
   - telegram (по умолчанию)
   - email
   - sheets
   - webhook (универсальный)

   Переменные окружения (в Cloudflare Dashboard → Pages → Settings):
     CHANNEL=telegram
     TELEGRAM_BOT_TOKEN=...
     TELEGRAM_CHAT_ID=...
     EMAIL_TO=...
     WEBHOOK_URL=...
     GOOGLE_CREDENTIALS_JSON=...   (содержимое service account JSON)
     SHEET_ID=...
     SHEET_NAME=Feedback
   ================================================================ */

export async function onRequestPost({ request, env }) {
  // CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  // Базовая валидация (повтор серверной, не доверяем клиенту)
  const errors = validate(payload);
  if (errors.length) {
    return json({ ok: false, error: 'validation', details: errors }, 400);
  }

  const channel = (env.CHANNEL || 'telegram').toLowerCase();

  try {
    if (channel === 'telegram') {
      await sendTelegram(payload, env);
    } else if (channel === 'email') {
      await sendEmail(payload, env);
    } else if (channel === 'sheets') {
      await appendToSheets(payload, env);
    } else if (channel === 'webhook') {
      await sendWebhook(payload, env);
    } else {
      return json({ ok: false, error: 'unknown_channel', channel }, 500);
    }

    return json({ ok: true, channel });
  } catch (e) {
    console.error('feedback error:', e);
    return json({ ok: false, error: 'send_failed', message: e.message }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ====== CHANNELS ===================================================

async function sendTelegram(p, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chat = env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error('TELEGRAM_BOT_TOKEN/CHAT_ID not set');

  const text =
    `🆕 Новое обращение Timer Bar\n` +
    `Тип: ${p.typeLabel || p.type}\n` +
    `Имя: ${escape(p.name)}\n` +
    `Телефон: ${escape(p.phone)}\n` +
    `Когда: ${new Date(p.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n\n` +
    `${escape(p.message)}`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram ${res.status}: ${body}`);
  }
}

async function sendEmail(p, env) {
  // Требует сторонний API (SendGrid / Resend). Здесь шаблон для Resend.
  const apiKey = env.RESEND_API_KEY;
  const to = env.EMAIL_TO;
  if (!apiKey || !to) throw new Error('RESEND_API_KEY/EMAIL_TO not set');

  const subject = `[${p.typeLabel || p.type}] Timer Bar — ${p.name}`;
  const html =
    `<h2>Новое обращение Timer Bar</h2>` +
    `<p><b>Тип:</b> ${escape(p.typeLabel || p.type)}<br>` +
    `<b>Имя:</b> ${escape(p.name)}<br>` +
    `<b>Телефон:</b> ${escape(p.phone)}<br>` +
    `<b>Когда:</b> ${new Date(p.createdAt).toLocaleString('ru-RU')}</p>` +
    `<p><b>Сообщение:</b><br>${escape(p.message).replace(/\n/g, '<br>')}</p>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'Timer Bar Feedback <noreply@timerbar.ru>',
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

async function appendToSheets(p, env) {
  // Требует service account Google с domain-wide delegation или OAuth.
  // Упрощённый пример: используем googleapis через npm в Cloudflare Pages
  // (Pages поддерживает только встроенные модули — для серьёзной интеграции
  // используйте Cloudflare Worker + nodejs_compat + npm install googleapis).
  // Здесь показана логика, реальная авторизация зависит от выбранного подхода.
  throw new Error('Google Sheets: реализуется отдельно. См. Deployment.md');
}

async function sendWebhook(p, env) {
  const url = env.WEBHOOK_URL;
  if (!url) throw new Error('WEBHOOK_URL not set');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Webhook ${res.status}: ${body}`);
  }
}

// ====== HELPERS ====================================================

function validate(p) {
  const errs = [];
  if (!p || typeof p !== 'object') {
    errs.push('payload_not_object');
    return errs;
  }
  if (!p.name || (p.name + '').trim().length < 2) errs.push('name_too_short');
  if (!p.phone) errs.push('phone_missing');
  if (!p.type || !['complaint', 'suggestion', 'gratitude'].includes(p.type))
    errs.push('type_invalid');
  if (!p.message || (p.message + '').trim().length < 10) errs.push('message_too_short');
  if (p.message && p.message.length > 5000) errs.push('message_too_long');
  return errs;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}