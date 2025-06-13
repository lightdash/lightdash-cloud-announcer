import type {
  Context,
  Installation,
  InstallationQuery,
  SlackAction,
  SlackShortcut,
  SlackViewAction,
  SlashCommand,
} from "@slack/bolt";
import type { WebAPIPlatformError, WebClient } from "@slack/web-api";

export const getTeamIdFromInstallation = <T extends boolean, V extends "v1" | "v2">(
  installation: Installation<V, T>,
): string => {
  if (installation.isEnterpriseInstall && installation.enterprise) {
    return installation.enterprise.id;
  }

  if (installation.team) {
    return installation.team.id;
  }

  throw new Error("Could not find a valid team id in the slack installation");
};

export const getTeamIdFromInstallationQuery = <T extends boolean>(installQuery: InstallationQuery<T>): string => {
  if (installQuery.isEnterpriseInstall && installQuery.enterpriseId) {
    return installQuery.enterpriseId;
  }

  if (installQuery.teamId) {
    return installQuery.teamId;
  }

  throw new Error("Could not find a valid team id in the slack installation query");
};

export const getTeamIdFromSlackAction = <T extends SlackAction>(body: T): string => {
  if (body.is_enterprise_install && "enterprise" in body) {
    return body.enterprise.id;
  }

  if (body.team) {
    return body.team.id;
  }

  throw new Error("Could not find a valid team id in the slack action");
};

export const getTeamIdFromSlashCommand = <T extends SlashCommand>(body: T): string => {
  if (body.is_enterprise_install && body.enterprise_id) {
    return body.enterprise_id;
  }

  return body.team_id;
};

export const getTeamIdfromViewAction = <T extends SlackViewAction>(body: T): string => {
  if (body.is_enterprise_install && body.enterprise) {
    return body.enterprise.id;
  }

  if (body.team) {
    return body.team.id;
  }

  throw new Error("Could not find a valid team id in the slack view action");
};

export const getTeamIdFromShortcut = <T extends SlackShortcut>(body: T): string => {
  if (body.is_enterprise_install && body.enterprise) {
    return body.enterprise.id;
  }

  if (body.team) {
    return body.team.id;
  }

  throw new Error("Could not find a valid team id in the slack shortcut");
};

export const getTeamIdFromContext = <T extends Context>(context: T): string => {
  if (context.isEnterpriseInstall && context.enterpriseId) {
    return context.enterpriseId;
  }

  if (context.teamId) {
    return context.teamId;
  }

  throw new Error("Could not find a valid team id in the slack context");
};

export const updateFirstResponderUserGroup = async (client: WebClient, slackUserId: string) => {
  try {
    // Get all usergroups
    const userGroupsResponse = await client.usergroups.list();

    // Find the first-responder usergroup
    const firstResponderGroup = userGroupsResponse.usergroups?.find(
      (group) => group.name === "first-responder" || group.handle === "first-responder",
    );

    if (!firstResponderGroup || !firstResponderGroup.id) {
      throw new Error("First-responder usergroup not found");
    }

    // Update the usergroup with the new user
    await client.usergroups.users.update({
      usergroup: firstResponderGroup.id,
      users: slackUserId,
    });

    return true;
  } catch (error) {
    console.error("Error updating first-responder usergroup:", error);
    return false;
  }
};

export const slackTryJoin = async <T>(fn: () => Promise<T>, client: WebClient, channelId: string) => {
  try {
    return await fn();
  } catch (e) {
    const maybeSlackPlatformError = e as WebAPIPlatformError;
    if (
      maybeSlackPlatformError.code === "slack_webapi_platform_error" &&
      maybeSlackPlatformError.data?.error === "not_in_channel"
    ) {
      await client.conversations.join({ channel: channelId });
      return await fn();
    } else {
      throw e;
    }
  }
};

export const errorMessageOrString = (e: unknown): string => {
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
};
