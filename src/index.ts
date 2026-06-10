import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

type AppEnv = {
  Bindings: Bindings;
};

type StringBindings<T extends object> = {
  [Key in keyof T]: T[Key] extends string ? string : T[Key];
};

type SecretBindings = {
  DISCORD_CLIENT_SECRET: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_ADMIN_TOKEN: string;
  SESSION_SECRET: string;
};

type Bindings = StringBindings<Env> & SecretBindings;

type Session = {
  createdAt: number;
  discordState?: string;
  discordVerified?: boolean;
  discordUserId?: string;
  githubState?: string;
};

type DiscordTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type DiscordUser = {
  id: string;
  username: string;
};

type DiscordGuild = {
  id: string;
  name?: string;
};

type GitHubTokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GitHubUser = {
  id: number;
  login: string;
  html_url: string;
};

type PageOptions = {
  title: string;
  message: string;
  actionHref?: string;
  actionText?: string;
  secondaryHref?: string;
  secondaryText?: string;
  tone?: "default" | "success" | "warning" | "error";
  details?: string[];
  debug?: boolean;
};

const app = new Hono<AppEnv>();
const sessionCookieName = "zunoser_invite_session";
const sessionMaxAgeSeconds = 15 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

app.get("/", (c) => {
  return c.html(
    renderPage({
      title: "ずのさーへようこそ",
      message: "ずのさーの GitHub Organization に参加しよう！",
      actionHref: "/auth/discord",
      actionText: "Organization に参加する",
    }),
  );
});

app.get("/auth/discord", async (c) => {
  const config = getConfig(c.env, [
    "APP_URL",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_GUILD_ID",
    "SESSION_SECRET",
  ]);
  if (!config.ok) {
    return configError(c, config.missing);
  }

  const state = randomToken();
  await writeSession(c, { createdAt: Date.now(), discordState: state });

  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", c.env.DISCORD_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${c.env.APP_URL}/auth/discord/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds");
  url.searchParams.set("state", state);

  return c.redirect(url.toString());
});

app.get("/auth/discord/callback", async (c) => {
  const config = getConfig(c.env, [
    "APP_URL",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_GUILD_ID",
    "SESSION_SECRET",
  ]);
  if (!config.ok) {
    return configError(c, config.missing);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  const session = await readSession(c);

  if (!code || !state || !session?.discordState || state !== session.discordState) {
    return oauthError(c, "Discord 認証の state が一致しません。もう一度お試しください。");
  }

  const token = await exchangeDiscordCode(c.env, code);
  if (!token.access_token) {
    return oauthError(c, "Discord のアクセストークン取得に失敗しました。", token.error_description);
  }

  const [user, isGuildMember] = await Promise.all([
    fetchDiscordUser(token.access_token),
    isDiscordGuildMember(token.access_token, c.env.DISCORD_GUILD_ID),
  ]);

  if (!isGuildMember) {
    deleteCookie(c, sessionCookieName, { path: "/" });
    return c.html(
      renderPage({
        title: "ずのさーへの参加が必要です",
        message: "参加を確認できませんでした。",
        actionHref: "/auth/discord",
        actionText: "もう一度確認する",
        secondaryHref: "/",
        secondaryText: "最初に戻る",
        tone: "warning",
      }),
      403,
    );
  }

  await writeSession(c, {
    createdAt: Date.now(),
    discordVerified: true,
    discordUserId: user.id,
  });

  return c.redirect("/auth/github");
});

app.get("/auth/github", async (c) => {
  const config = getConfig(c.env, [
    "APP_URL",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_ORG",
    "GITHUB_ADMIN_TOKEN",
    "SESSION_SECRET",
  ]);
  if (!config.ok) {
    return configError(c, config.missing);
  }

  const session = await readSession(c);
  if (!session?.discordVerified) {
    return c.redirect("/");
  }

  const state = randomToken();
  await writeSession(c, { ...session, githubState: state });

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${c.env.APP_URL}/auth/github/callback`);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);

  return c.redirect(url.toString());
});

app.get("/auth/github/callback", async (c) => {
  const config = getConfig(c.env, [
    "APP_URL",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_ORG",
    "GITHUB_ADMIN_TOKEN",
    "SESSION_SECRET",
  ]);
  if (!config.ok) {
    return configError(c, config.missing);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  const session = await readSession(c);

  if (!session?.discordVerified) {
    return c.redirect("/");
  }

  if (!code || !state || !session.githubState || state !== session.githubState) {
    return oauthError(c, "GitHub 認証の state が一致しません。もう一度お試しください。");
  }

  const token = await exchangeGitHubCode(c.env, code);
  if (!token.access_token) {
    return oauthError(c, "GitHub のアクセストークン取得に失敗しました。", token.error_description);
  }

  const user = await fetchGitHubUser(token.access_token);
  const membership = await getGitHubMembership(c.env, user.login);
  if (membership === "member") {
    deleteCookie(c, sessionCookieName, { path: "/" });
    return c.html(
      renderPage({
        title: "既に参加済みです",
        message: "この GitHub アカウントは既に Organization に参加しています。",
        actionHref: user.html_url,
        actionText: "GitHub プロフィールを開く",
        secondaryHref: "/",
        secondaryText: "最初に戻る",
        tone: "success",
      }),
    );
  }

  const invitation = await inviteGitHubUser(c.env, user.id);
  deleteCookie(c, sessionCookieName, { path: "/" });

  if (invitation === "created") {
    return c.html(
      renderPage({
        title: "招待を送信しました",
        message: "「参加を確認する」から、招待を承認しよう！",
        actionHref: `https://github.com/orgs/${encodeURIComponent(c.env.GITHUB_ORG)}/invitation`,
        actionText: "参加を確認する",
        secondaryHref: "/",
        secondaryText: "最初に戻る",
        tone: "success",
      }),
    );
  }

  if (invitation === "already_invited") {
    return c.html(
      renderPage({
        title: "招待済みの可能性があります",
        message: "対象アカウントには既に招待が送信されている可能性があります。",
        actionHref: `https://github.com/orgs/${encodeURIComponent(c.env.GITHUB_ORG)}/invitation`,
        actionText: "GitHub の招待を確認する",
        secondaryHref: "/",
        secondaryText: "最初に戻る",
        tone: "warning",
      }),
      409,
    );
  }

  return oauthError(c, "GitHub Organization への招待送信に失敗しました。");
});

app.get("/debug/ui", (c) => {
  if (!isDebugUiAllowed(c)) {
    return c.notFound();
  }

  const screen = c.req.query("screen") ?? "index";
  const screens: Record<string, PageOptions> = {
    home: {
      title: "ずのさーへようこそ",
      message: "ずのさーの GitHub Organization に参加しよう！",
      actionHref: "/auth/discord",
      actionText: "Organization に参加する",
    },
    not_member: {
      title: "ずのさーへの参加が必要です",
      message: "参加を確認できませんでした。",
      actionHref: "/auth/discord",
      actionText: "もう一度確認する",
      tone: "warning",
    },
    github: {
      title: "GitHub 認証へ進みます",
      message: "GitHub アカウントを確認して Organization 招待を送信します。",
      actionHref: "/auth/github",
      actionText: "GitHub で続行する",
    },
    success: {
      title: "招待を送信しました",
      message: "対象アカウント宛に GitHub Organization の招待を送信しました。",
      actionHref: "https://github.com/notifications",
      actionText: "GitHub を開く",
      tone: "success",
    },
    already: {
      title: "既に参加済みです",
      message: "この GitHub アカウントは既に Organization に参加しています。",
      actionHref: "/",
      actionText: "最初に戻る",
      tone: "success",
    },
    error: {
      title: "処理に失敗しました",
      message: "認証または招待送信で問題が発生しました。時間を置いて再度お試しください。",
      actionHref: "/",
      actionText: "最初に戻る",
      tone: "error",
    },
  };

  if (screen === "index") {
    return c.html(renderDebugIndex(Object.keys(screens)));
  }

  const page = screens[screen];
  if (!page) {
    return c.notFound();
  }

  return c.html(renderPage({ ...page, debug: true }));
});

app.notFound((c) => {
  return c.html(
    renderPage({
      title: "ページが見つかりません",
      message: "指定されたページは存在しません。",
      actionHref: "/",
      actionText: "最初に戻る",
      tone: "error",
    }),
    404,
  );
});

app.onError((error, c) => {
  console.error(JSON.stringify({ message: "unhandled error", error: error.message }));
  return c.html(
    renderPage({
      title: "処理に失敗しました",
      message: "予期しないエラーが発生しました。時間を置いて再度お試しください。",
      actionHref: "/",
      actionText: "最初に戻る",
      tone: "error",
    }),
    500,
  );
});

export default app;

async function exchangeDiscordCode(env: Bindings, code: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: `${env.APP_URL}/auth/discord/callback`,
  });

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  return response.json<DiscordTokenResponse>();
}

async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Discord user");
  }

  return response.json<DiscordUser>();
}

async function isDiscordGuildMember(accessToken: string, guildId: string): Promise<boolean> {
  let after: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const url = new URL("https://discord.com/api/users/@me/guilds");
    url.searchParams.set("limit", "200");
    if (after) {
      url.searchParams.set("after", after);
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch Discord guilds");
    }

    const guilds = await response.json<DiscordGuild[]>();
    if (guilds.some((guild) => guild.id === guildId)) {
      return true;
    }

    if (guilds.length < 200) {
      return false;
    }

    after = guilds.at(-1)?.id;
    if (!after) {
      return false;
    }
  }

  return false;
}

async function exchangeGitHubCode(env: Bindings, code: string): Promise<GitHubTokenResponse> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "zunoser-auto-invitation",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${env.APP_URL}/auth/github/callback`,
    }),
  });

  return response.json<GitHubTokenResponse>();
}

async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "zunoser-auto-invitation",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch GitHub user");
  }

  return response.json<GitHubUser>();
}

async function getGitHubMembership(env: Bindings, login: string): Promise<"member" | "not_member" | "unknown"> {
  const response = await fetch(
    `https://api.github.com/orgs/${encodeURIComponent(env.GITHUB_ORG)}/members/${encodeURIComponent(login)}`,
    {
      headers: githubAdminHeaders(env),
    },
  );

  if (response.status === 204) {
    return "member";
  }

  if (response.status === 404) {
    return "not_member";
  }

  console.warn(JSON.stringify({ message: "membership check failed", status: response.status }));
  return "unknown";
}

async function inviteGitHubUser(env: Bindings, inviteeId: number): Promise<"created" | "already_invited" | "failed"> {
  const response = await fetch(
    `https://api.github.com/orgs/${encodeURIComponent(env.GITHUB_ORG)}/invitations`,
    {
      method: "POST",
      headers: {
        ...githubAdminHeaders(env),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ invitee_id: inviteeId }),
    },
  );

  if (response.status === 201) {
    return "created";
  }

  if (response.status === 422) {
    return "already_invited";
  }

  console.error(JSON.stringify({ message: "github invitation failed", status: response.status }));
  return "failed";
}

function githubAdminHeaders(env: Bindings): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_ADMIN_TOKEN}`,
    "User-Agent": "zunoser-auto-invitation",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readSession(c: Context<AppEnv>): Promise<Session | null> {
  const cookie = getCookie(c, sessionCookieName);
  if (!cookie || !c.env.SESSION_SECRET) {
    return null;
  }

  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expected = await hmac(payload, c.env.SESSION_SECRET);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }

  try {
    const session = JSON.parse(decoder.decode(base64UrlDecode(payload))) as Session;
    if (Date.now() - session.createdAt > sessionMaxAgeSeconds * 1000) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

async function writeSession(c: Context<AppEnv>, session: Session): Promise<void> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(session)));
  const signature = await hmac(payload, c.env.SESSION_SECRET);

  setCookie(c, sessionCookieName, `${payload}.${signature}`, {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    maxAge: sessionMaxAgeSeconds,
  });
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

function getConfig(env: Bindings, names: Array<keyof Bindings>): { ok: true } | { ok: false; missing: string[] } {
  const missing = names.filter((name) => {
    const value = env[name];
    return typeof value !== "string" || value.length === 0 || value === "replace-me";
  });

  return missing.length === 0 ? { ok: true } : { ok: false, missing: missing.map(String) };
}

function configError(c: Context<AppEnv>, missing: string[]): Response {
  return c.html(
    renderPage({
      title: "設定が不足しています",
      message: "OAuth または招待送信に必要な環境変数が設定されていません。",
      actionHref: "/",
      actionText: "最初に戻る",
      tone: "error",
      details: missing.map((name) => `${name} を設定してください。`),
    }),
    500,
  );
}

function oauthError(c: Context<AppEnv>, message: string, detail?: string): Response {
  return c.html(
    renderPage({
      title: "処理に失敗しました",
      message,
      actionHref: "/",
      actionText: "最初に戻る",
      tone: "error",
      details: detail ? [detail] : undefined,
    }),
    400,
  );
}

function isDebugUiAllowed(c: Context<AppEnv>): boolean {
  return c.env.DEBUG_UI === "1";
}

function renderDebugIndex(screens: string[]): string {
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

function renderPage(options: PageOptions): string {
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
