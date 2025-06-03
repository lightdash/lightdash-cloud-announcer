import { octokitClient } from "../clients/github.js";
import { GH_OWNER, GH_REPO } from "../config.js";
import { createGithubIssue } from "../github.js";

const syncGithubIssues = async ({ owner, repo }: { owner: string; repo: string }) => {
  const issuesIterator = octokitClient.paginate.iterator(octokitClient.rest.issues.listForRepo, {
    owner,
    repo,
    sort: "created",
    direction: "asc",
    state: "all",
    per_page: 100,
    // 3 month ago - helpful for testing
    // since: new Date(Date.now() - 3 * 30 * 24 * 60 * 60 * 1000).toISOString(),
  });

  for await (const issuesBatch of issuesIterator) {
    if (issuesBatch.status !== 200) {
      throw new Error(`Failed to fetch issues: ${issuesBatch.status}`);
    }

    console.info(`Fetched ${issuesBatch.data.length} issues`);
    console.info(`> request url: ${issuesBatch.url}`);

    for (const issue of issuesBatch.data) {
      try {
        await createGithubIssue({ owner: GH_OWNER, repo: GH_REPO, issue: issue });
      } catch (error) {
        console.error(`Failed to create issue: ${issue.title}`, error);
        console.info("Issue:");
        console.dir(issue, { depth: null });
        console.info("~~~~~~~~~~~~~");
      }
    }

    console.info(`[GH] synced ${issuesBatch.data.length} issues`);
  }
};

syncGithubIssues({
  owner: GH_OWNER,
  repo: GH_REPO,
})
  .then(() => {
    console.info("[GH] sync completed");
  })
  .catch((error: unknown) => {
    console.error("[GH] sync failed", error);
  });
