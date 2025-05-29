import type { Octokit } from "octokit";

export const issueUrlComponents = (githubIssueUrl: string): { owner: string; repo: string; issueNumber: number } => {
  const url = new URL(githubIssueUrl);
  const [, owner, repo, , issueNumber] = url.pathname.split("/");

  if (!owner || !repo || !issueNumber) {
    throw new Error(`Invalid issue URL: ${githubIssueUrl}`);
  }

  return { owner, repo, issueNumber: Number(issueNumber) };
};

export const getIssueStatus = async (octokitClient: Octokit, githubIssueUrl: string): Promise<string | undefined> => {
  try {
    const { owner, repo, issueNumber } = issueUrlComponents(githubIssueUrl);
    const issue = await octokitClient.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    return issue.data.state;
  } catch {
    return undefined;
  }
};

export const postCommentOnIssue = async (
  octokitClient: Octokit,
  githubIssueUrl: string,
  comment: string,
): Promise<void> => {
  const { owner, repo, issueNumber } = issueUrlComponents(githubIssueUrl);
  await octokitClient.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: comment,
  });
};

export const getLastComment = async (octokitClient: Octokit, githubIssueUrl: string): Promise<string | undefined> => {
  try {
    const { owner, repo } = issueUrlComponents(githubIssueUrl);
    const comments = await octokitClient.request(`GET /repos/${owner}/${repo}/issues/comments`, {
      owner,
      repo,
      sort: "created",
      direction: "desc",
      per_page: "1",
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (comments.data.length > 0) {
      // The last comment is the first item due to the sorting
      const lastComment = comments.data[0];
      return lastComment.body;
    } else {
      console.info("[GITHUB] No comments found.");
      return undefined;
    }
  } catch (e) {
    console.error("Unable to get comments", e);
    return undefined;
  }
};

export const issueIdFromUrl = (issueUrl: string): string => {
  const issueId = issueUrl.split("/").pop();
  if (!issueId) {
    throw new Error(`Invalid issue URL: ${issueUrl}`);
  }
  return issueId;
};

export const renderIssueRef = (issueUrl: string) => {
  const issueId = issueIdFromUrl(issueUrl);
  return `<${issueUrl}|issue #${issueId}>`;
};

export const findGithubIssueLinks = (serializedBlocksOrRawMessage: string): string[] => {
  const githubLinkRegex = /https:\/\/github.com\/[^/]+\/[^/]+\/issues\/[0-9]+/g;

  const matches = serializedBlocksOrRawMessage.matchAll(githubLinkRegex);
  const links = [...new Set(Array.from(matches).map((match) => match[0]))];

  return links;
};
