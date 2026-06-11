import type {
  Bindings,
  DiscordGuild,
  DiscordTokenResponse,
  DiscordUser,
  GitHubInvitationResult,
  GitHubMembership,
  GitHubTokenResponse,
  GitHubUser,
} from "./types";

export async function exchangeDiscordCode(env: Bindings, code: string): Promise<DiscordTokenResponse> {
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

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Discord user");
  }

  return response.json<DiscordUser>();
}

export async function isDiscordGuildMember(accessToken: string, guildId: string): Promise<boolean> {
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

export async function exchangeGitHubCode(env: Bindings, code: string): Promise<GitHubTokenResponse> {
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

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
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

export async function getGitHubMembership(env: Bindings, login: string): Promise<GitHubMembership> {
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

export async function inviteGitHubUser(env: Bindings, inviteeId: number): Promise<GitHubInvitationResult> {
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
