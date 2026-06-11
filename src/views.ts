import type { PageOptions } from "./types";

export function renderDebugIndex(screens: string[]): string {
  const links = screens
    .map(
      (screen) =>
        `<a class="debug-link" href="/debug/ui?screen=${escapeHtml(screen)}">${escapeHtml(screen)}</a>`,
    )
    .join("");

  return renderShell(`
    <main class="page">
      <section class="card debug-card">
        <h1>UI プレビュー</h1>
        <p class="message">UIプレビューしたい時用</p>
        <div class="debug-grid">${links}</div>
      </section>
    </main>
  `);
}

export function renderPage(options: PageOptions): string {
  const tone = options.tone ?? "default";
  const details = options.details?.length
    ? `<ul class="details">${options.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>`
    : "";
  const primary = options.actionHref && options.actionText
    ? `<a class="button button-primary" href="${escapeAttribute(options.actionHref)}">${escapeHtml(options.actionText)}</a>`
    : "";
  const secondary = options.secondaryHref && options.secondaryText
    ? `<a class="button button-secondary" href="${escapeAttribute(options.secondaryHref)}">${escapeHtml(options.secondaryText)}</a>`
    : "";
  const debug = options.debug ? `<a class="debug-back" href="/debug/ui">Debug UI</a>` : "";

  return renderShell(`
    <main class="page">
      <section class="card card-${tone}">
        ${debug}
        <img class="logo" src="https://raw.githubusercontent.com/zunoser/.github/refs/heads/main/img/image.png" alt="" />
        <h1>${escapeHtml(options.title)}</h1>
        <p class="message">${escapeHtml(options.message)}</p>
        ${details}
        <div class="actions">${primary}${secondary}</div>
      </section>
    </main>
  `);
}

function renderShell(body: string): string {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ずのさーへようこそ！</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f5f7;
        --surface: #ffffff;
        --text: #111827;
        --muted: #6b7280;
        --line: #e5e7eb;
        --primary: #111827;
        --primary-text: #ffffff;
        --success: #16a34a;
        --warning: #d97706;
        --error: #dc2626;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .page {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }

      .card {
        width: min(100%, 520px);
        position: relative;
        border: 1px solid var(--line);
        border-radius: 24px;
        background: var(--surface);
        padding: 40px;
      }

      .logo {
        display: block;
        width: 80px;
        height: 80px;
        object-fit: contain;
        margin-bottom: 28px;
      }

      h1 {
        margin: 0;
        font-size: clamp(30px, 8vw, 48px);
        line-height: 1.05;
        letter-spacing: -0.04em;
      }

      .message {
        margin: 20px 0 0;
        color: var(--muted);
        font-size: 16px;
        line-height: 1.8;
      }

      .details {
        margin: 24px 0 0;
        padding: 0;
        list-style: none;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.7;
      }

      .details li {
        border-top: 1px solid var(--line);
        padding: 12px 0;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 32px;
      }

      .button,
      .debug-link,
      .debug-back {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        border-radius: 999px;
        padding: 0 18px;
        font-size: 14px;
        font-weight: 700;
        text-decoration: none;
      }

      .button-primary {
        background: var(--primary);
        color: var(--primary-text);
      }

      .button-secondary,
      .debug-link,
      .debug-back {
        border: 1px solid var(--line);
        color: var(--text);
        background: var(--surface);
      }

      .debug-back {
        position: absolute;
        top: 20px;
        right: 20px;
        min-height: 34px;
        padding: 0 12px;
        font-size: 12px;
      }

      .debug-card {
        width: min(100%, 720px);
      }

      .debug-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
        margin-top: 32px;
      }

      @media (max-width: 560px) {
        .card {
          padding: 28px;
          border-radius: 20px;
        }

        .actions,
        .button {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
