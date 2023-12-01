/**
 *
 * @param { string } githubIssueUrl
 * @returns {{owner: string, repo: string, issueNumber: number}}
 */
export const issueUrlComponents = (githubIssueUrl) => {
    const url = new URL(githubIssueUrl);
    const [, owner, repo, , issueNumber] = url.pathname.split('/')
    return {owner, repo, issueNumber: parseInt(issueNumber, 10)};
}

/**
 *
 * @param {import("octokit").Octokit} octokitClient
 * @param { string } githubIssueUrl
 * @returns {undefined | string}
 */
export const getIssueStatus = async (octokitClient, githubIssueUrl) => {
    try {
        const { owner, repo, issueNumber } = issueUrlComponents(githubIssueUrl);
        const issue = await octokitClient.rest.issues.get({owner, repo, issue_number: issueNumber});
        return issue.data.state;
    } catch (e) {
        return undefined
    }
}

/**
 * @param {import("octokit").Octokit} octokitClient
 * @param {string} githubIssueUrl
 * @param {string} comment
 * @returns {Promise<void>}
 */
export const postCommentOnIssue = async (octokitClient, githubIssueUrl, comment) => {
    const { owner, repo, issueNumber } = issueUrlComponents(githubIssueUrl);
    await octokitClient.rest.issues.createComment({owner, repo, issue_number: issueNumber, body: comment});
}
