/* eslint-disable @typescript-eslint/camelcase */
import * as core from "@actions/core";
import got from "got";
import { GitHub, context } from "@actions/github";
import {
  IssuesListCommentsForRepoResponseData,
  ReposListCommitsResponseData,
  ActionsListJobsForWorkflowRunResponseData,
  PullsGetResponseData,
} from "@octokit/types";
import {
  isStagingComment,
  getBuildState,
  building,
  BuildEntry,
  BuildState,
  BuildEmoji,
  BuildStatus,
  date,
  duration,
  successful,
  failed,
} from "./templates";

type EventMode = "pre" | "post" | "failure";
type Item<T> = T extends (infer I)[] ? I : never;
type Comment = Item<IssuesListCommentsForRepoResponseData>;
type Commit = Item<ReposListCommitsResponseData>;
type PullRequest = PullsGetResponseData;
type Job = Item<ActionsListJobsForWorkflowRunResponseData["jobs"]>;
type Nil = null | undefined;

interface Repo {
  repo: string;
  owner: string;
}

/**
 * Common parameters sent to action states
 */
interface ActionContext {
  buildDuration: number | Nil;
  stagingUrl: string;
  commitUrl: string;
  shortSha: string;
  octokit: GitHub;
  buildTime: Date;
  runLink: string;
  prId: number;
  sha: string;
  repo: Repo;
  tag?: string;
}

/**
 * Attempts to find an existing action comment for the given PR, or null if one isn't
 * found
 * @param octokit - Current Octokit GitHub API binding instance
 * @param prId - PR ID for the current CI context
 * @param repo - GitHub repo for the current CI context
 * @param tag - Optional action tag
 */
async function getActionComment(
  octokit: GitHub,
  prId: number,
  repo: Repo,
  tag?: string,
): Promise<Comment | Nil> {
  const { data: thisUser } = await octokit.users.getAuthenticated();
  const { data: comments } = await octokit.issues.listComments({
    issue_number: prId,
    ...repo,
  });
  const thisUserComments = comments.filter(
    (comment) => comment.user.id === thisUser.id,
  );
  const specialComments = thisUserComments.filter((comment) =>
    isStagingComment(comment.body, tag),
  );
  if (specialComments.length >= 1) return specialComments[0];
  return null;
}

/**
 * Gets the GitHub API object for the given PR
 * @param octokit - Current Octokit GitHub API binding instance
 * @param prId - PR ID for the current CI context
 * @param repo - GitHub repo for the current CI context
 */
async function getPullRequest(
  octokit: GitHub,
  prId: number,
  repo: Repo,
): Promise<PullRequest> {
  const { data: pr } = await octokit.pulls.get({ ...repo, pull_number: prId });
  return (pr as unknown) as PullRequest;
}

/**
 * Gets the SHA of the latest commit on the branch for the given PR
 * @param octokit - Current Octokit GitHub API binding instance
 * @param prId - PR ID for the current CI context
 * @param repo - GitHub repo for the current CI context
 */
async function getLatestCommit(
  octokit: GitHub,
  prId: number,
  repo: Repo,
): Promise<[Commit, string]> {
  const pr = await getPullRequest(octokit, prId, repo);
  const branch = pr.head.ref;
  if (pr.head.repo.full_name !== `${repo.owner}/${repo.repo}`) {
    const message = `Skipping build for untrusted external repository ${pr.head.repo.full_name}`;
    throw new Error(message);
  } else {
    // Use the latest commit from the branch
    const { data: commits } = await octokit.repos.listCommits({
      ...repo,
      sha: branch,
      // Get the latest commit on the branch
      per_page: 1,
    });
    if (commits.length === 0)
      throw new Error(`No commits found in branch ${branch}`);
    return [(commits[0] as unknown) as Commit, branch];
  }
}

/**
 * Attempts to find the currently running job from the API
 * @param octokit - Current Octokit GitHub API binding instance
 * @param repo - GitHub repo for the current CI context
 * @param runId - GitHub actions workflow run Id
 * @param jobName - GitHub actions job name for the staging job
 */
async function getJob(
  octokit: GitHub,
  repo: Repo,
  runId: number,
  jobName: string | Nil,
): Promise<Job | Nil> {
  if (jobName == null) {
    core.info(`Skipping job matching; linking to overall workflow run`);
    return null;
  }

  const { data } = await octokit.actions.listJobsForWorkflowRun({
    ...repo,
    run_id: runId,
  });
  const foundJobs = data.jobs.filter((job) => job.name === jobName);
  if (foundJobs.length === 0) {
    core.warning(
      `No jobs matching job.name = ${jobName} for workflow run with id ${runId}`,
    );
    return null;
  }
  return foundJobs[0];
}

/**
 * Runs the main action logic depending on the mode
 * @param mode - Event mode for the action (i.e. phase of CI job)
 */
export async function run(mode: EventMode): Promise<void> {
  const token: string = core.getInput("GITHUB_TOKEN");
  const baseStagingUrl: string = core.getInput("base-staging-url");
  const buildTime: string = core.getInput("build-time");
  const buildDuration: string = core.getInput("build-duration");
  const jobName: string | Nil = core.getInput("job-name");
  let tag: string | Nil = core.getInput("tag");
  if (tag === "") tag = null;

  const parsedBuildDuration =
    buildDuration.trim().length > 0 ? parseInt(buildDuration.trim()) : null;
  const octokit = new GitHub(token);
  const { repo } = context;

  const runId: string | Nil = process.env.GITHUB_RUN_ID;
  if (runId == null)
    throw new Error(
      `Environment variable "GITHUB_RUN_ID" undefined; couldn't link to action run`,
    );

  const job = await getJob(octokit, repo, parseInt(runId), jobName);
  const isPr = context.eventName === "pull_request";

  let sha: string;
  let branch: string;
  if (isPr) {
    // Extract commit SHA from the latest commit on the PR's head branch
    const prId = context.issue.number;
    const [lastCommit, lastCommitBranch] = await getLatestCommit(
      octokit,
      prId,
      repo,
    );
    sha = lastCommit.sha;
    branch = lastCommitBranch;
  } else {
    // Extract the commit SHA/branch from the environment
    sha = context.sha;
    branch = context.ref.replace(/^refs\/heads\//, "");
  }

  const shortSha = sha.slice(0, 7);
  const prId = isPr ? context.issue.number : 0;
  const commitUrl = `${baseStagingUrl}/commit/${shortSha}/`;
  const stagingUrl = isPr ? `${baseStagingUrl}/pr/${prId}/` : commitUrl;

  // Output global information about build
  core.setOutput("runId", runId);
  core.setOutput("jobId", job?.id ?? "");
  core.setOutput("deployUrl", stagingUrl);
  core.setOutput("branch", branch);
  core.setOutput("sha", sha);
  core.setOutput("commitUrl", commitUrl);

  if (isPr) {
    // Output additional information for PRs
    const pr = await getPullRequest(octokit, prId, repo);
    core.setOutput("prId", prId);
    core.setOutput("baseBranch", pr.base.ref);
  } else {
    core.setOutput("prId", "");
    core.setOutput("baseBranch", "");
  }

  // Stop execution if not a PR
  if (!isPr) {
    core.info("Not a PR; setting outputs and returning early");
    return;
  }

  const actionContext: ActionContext = {
    runLink: job?.html_url ?? buildRunLink(repo, runId),
    buildTime: new Date(Date.parse(buildTime)),
    buildDuration: parsedBuildDuration,
    stagingUrl,
    commitUrl,
    shortSha,
    sha,
    octokit,
    repo,
    prId,
  };

  switch (mode) {
    case "pre":
      await pre(actionContext);
      break;
    case "post":
      core.saveState("stagingSuccess", "true");
      await post(actionContext);
      break;
    case "failure":
      await failure(actionContext);
  }
}

/**
 * Updates the existing comment in the context if it exists with the given body, or
 * creates a new comment if it doesn't exist
 * @param newBody - New comment body to use
 * @param comment - Action comment
 * @param actionContext - Base action context
 */
async function patchComment(
  newBody: string,
  comment: Comment | Nil,
  actionContext: ActionContext,
): Promise<void> {
  const { octokit, prId, repo } = actionContext;
  if (comment != null) {
    await octokit.issues.updateComment({
      ...repo,
      body: newBody,
      comment_id: comment.id,
    });
  } else {
    await octokit.issues.createComment({
      ...repo,
      body: newBody,
      issue_number: prId,
    });
  }
}

/**
 * Performs the update logic, modifying the given build state and returning the new one
 * (might mutate the old state object). If the comment exists and the function can find
 * a matching entry in the comment, it updates the entry. Otherwise, adds a new entry as
 * the latest one (pushing all other entries down if they exist).
 * @param current - Current build entry (might not be latest)
 * @param comment - Action comment
 * @param actionContext - Base action context
 */
function updateState(
  current: BuildEntry,
  comment: Comment | Nil,
  actionContext: ActionContext,
): BuildState {
  const { shortSha } = actionContext;
  let state: BuildState;
  if (comment != null) {
    state = getBuildState(comment.body);

    // If the latest entry is the current one, then update the latest
    if (state.latest.commitSha === shortSha) {
      state.latest = current;
    } else {
      // Try to find the entry in the list of previous entries
      let patched = false;
      for (const entry of state.previous) {
        if (entry.commitSha === shortSha) {
          patched = true;
          Object.assign(entry, current);
        }
      }

      // If the entry still wasn't found, then add it to the latest
      if (!patched) {
        const previousLatest = state.latest;
        state = {
          previous: [previousLatest, ...state.previous],
          latest: current,
        };
      }
    }
  } else {
    // Initialize the empty state with the new build entry
    state = {
      previous: [],
      latest: current,
    };
  }

  return state;
}

/**
 * Builds a GitHub permanent run link to the given runId
 * @param repo - Aggregate GitHub repo object
 * @param runId - Numeric unique Id for the current run, parsed from the environment
 */
function buildRunLink(repo: Repo, runId: string): string {
  return `https://github.com/${repo.owner}/${repo.repo}/actions/runs/${runId}`;
}

/**
 * Builds a GitHub permanent commit link to the given sha
 * @param actionContext - Base action context
 */
function buildCommitLink(actionContext: ActionContext): string {
  const { repo, sha } = actionContext;
  return `https://github.com/${repo.owner}/${repo.repo}/commit/${sha}`;
}

/**
 * Gets the initial comment state, printing a message to the console if it exists
 * @param actionContext - Base action context
 */
async function getInitialComment(
  actionContext: ActionContext,
): Promise<Comment | Nil> {
  const { prId, repo, tag, octokit } = actionContext;
  const comment = await getActionComment(octokit, prId, repo, tag);
  if (comment != null) {
    core.debug(
      `Found existing CI comment ${comment.id} by ${comment.user.login} on PR ${prId}`,
    );
  } else {
    core.debug(`Found no existing CI comment on PR ${prId}`);
  }
  return comment;
}

/**
 * Executes the primary action logic before a build, updating the newest build entry and
 * pushing all previous build entries to the bottom section if they exist.
 * @param actionContext - Base action context
 */
async function pre(actionContext: ActionContext): Promise<void> {
  const {
    prId,
    stagingUrl: url,
    shortSha,
    buildTime,
    runLink,
    commitUrl,
  } = actionContext;

  const current: BuildEntry = {
    emoji: BuildEmoji.InProgress,
    status: BuildStatus.InProgress,
    deployUrl: commitUrl,
    commitSha: shortSha,
    commitLink: buildCommitLink(actionContext),
    buildTime: date(buildTime),
    buildDuration: null,
    runLink,
  };

  const comment = await getInitialComment(actionContext);
  const state = updateState(current, comment, actionContext);
  await patchComment(
    building({ prId: prId.toString(), state, url }),
    comment,
    actionContext,
  );
}

/**
 * Executes the primary logic after a successful build, finding the corresponding build
 * entry if it exists and updating it, else creates a new entry at at the top and pushes
 * all previous build entries to the bottom section if they exist.
 * @param actionContext - Base action context
 */
async function post(actionContext: ActionContext): Promise<void> {
  const {
    prId,
    stagingUrl: url,
    shortSha,
    buildTime,
    buildDuration,
    runLink,
    commitUrl,
    octokit,
    repo,
    tag,
  } = actionContext;

  const current: BuildEntry = {
    emoji: BuildEmoji.Success,
    status: BuildStatus.Success,
    deployUrl: commitUrl,
    commitSha: shortSha,
    commitLink: buildCommitLink(actionContext),
    buildTime: date(buildTime),
    buildDuration: buildDuration != null ? duration(buildDuration) : null,
    runLink,
  };

  let comment = await getInitialComment(actionContext);
  const state = updateState(current, comment, actionContext);
  await patchComment(
    successful({ prId: prId.toString(), state, url }),
    comment,
    actionContext,
  );

  // On post, wait 2 minutes and verify that the commit link exists
  await new Promise((resolve) => setTimeout(resolve, 2000));
  let isError = false;
  try {
    got(commitUrl);
  } catch (err) {
    isError = true;
  }

  if (isError) {
    // Update the comment to remove the commit deploy URL
    comment = await getActionComment(octokit, prId, repo, tag);
    const newState = updateState(
      { ...current, deployUrl: null },
      comment,
      actionContext,
    );
    await patchComment(
      successful({ prId: prId.toString(), state: newState, url }),
      comment,
      actionContext,
    );
  }
}

/**
 * Executes the primary logic after a failed build, finding the corresponding build
 * entry if it exists and updating it, else creates a new entry at at the top and pushes
 * all previous build entries to the bottom section if they exist.
 * @param actionContext - Base action context
 */
async function failure(actionContext: ActionContext): Promise<void> {
  const { prId, stagingUrl: url, shortSha, buildTime, runLink } = actionContext;

  const current: BuildEntry = {
    emoji: BuildEmoji.Failure,
    status: BuildStatus.Failure,
    deployUrl: null,
    commitSha: shortSha,
    commitLink: buildCommitLink(actionContext),
    buildTime: date(buildTime),
    buildDuration: null,
    runLink,
  };

  const comment = await getInitialComment(actionContext);
  const state = updateState(current, comment, actionContext);
  await patchComment(
    failed({ prId: prId.toString(), state, url }),
    comment,
    actionContext,
  );
}
