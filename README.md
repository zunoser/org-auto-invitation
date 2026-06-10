# ZUNOSER Auto Invitation

このプロジェクトはずのさー向けに作成された、Discordの特定サーバー参加を確認し、参加済みユーザーに対して GitHub Organization 招待を送るためのアプリケーションです。

## セットアップ

```sh
pnpm install
pnpm cf-typegen
```

`.dev.vars.example` を参考に `.dev.vars` を作成します。

```txt
APP_URL="http://localhost:8787"
DISCORD_CLIENT_ID="..."
DISCORD_CLIENT_SECRET="..."
DISCORD_GUILD_ID="..."
GITHUB_CLIENT_ID="..."
GITHUB_CLIENT_SECRET="..."
GITHUB_ORG="..."
GITHUB_ADMIN_TOKEN="..."
SESSION_SECRET="replace-with-at-least-32-random-characters"
DEBUG_UI="1"
```

## OAuth Callback URL

Discord Developer Portal:

```txt
http://localhost:8787/auth/discord/callback
```

GitHub OAuth App:

```txt
http://localhost:8787/auth/github/callback
```

本番では `APP_URL` に本番 URL を設定し、各 OAuth App の callback URL も本番 URL に変更してください。

## GitHub Token

`GITHUB_ADMIN_TOKEN` は GitHub Organization の owner が発行した PAT を使用します。

推奨は Fine-grained PAT です。

- Resource owner: 対象 Organization
- Organization permissions: `Members` の Read and write

Classic PAT を使う場合は `admin:org` scope が必要です。

## 開発

```sh
pnpm dev
```