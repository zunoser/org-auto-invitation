export type AppEnv = {
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

export type Bindings = StringBindings<Env> & SecretBindings;

export type Session = {
  createdAt: number;
  discordState?: string;
  discordVerified?: boolean;
  discordUserId?: string;
  githubState?: string;
};

export type DiscordTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

export type DiscordUser = {
  id: string;
  username: string;
};

export type DiscordGuild = {
  id: string;
  name?: string;
};

export type GitHubTokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

export type GitHubUser = {
  id: number;
  login: string;
  html_url: string;
};

export type GitHubMembership = "member" | "not_member" | "unknown";

export type GitHubInvitationResult = "created" | "already_invited" | "failed";

export type PageOptions = {
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
