import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie } from "hono/cookie";

import {
  exchangeDiscordCode,
  exchangeGitHubCode,
  fetchDiscordUser,
  fetchGitHubUser,
  getGitHubMembership,
  inviteGitHubUser,
  isDiscordGuildMember,
} from "./services";
import { randomToken, readSession, sessionCookieName, writeSession } from "./session";
import type { AppEnv, Bindings, PageOptions } from "./types";
import { renderDebugIndex, renderPage } from "./views";

const app = new Hono<AppEnv>();

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
