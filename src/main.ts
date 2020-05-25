/* eslint-disable @typescript-eslint/camelcase */
import * as core from "@actions/core";
import { GitHub, context } from "@actions/github";
import { IssuesListCommentsForRepoResponseData } from "@octokit/types";
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
interface Repo {
  repo: string;
  owner: string;
}

/**
 * Common parameters sent to action states
 */
interface ActionContext {
  buildDuration: number | null;
  comment: Comment | null;
  stagingUrl: string;
  shortSha: string;
  octokit: GitHub;
  buildTime: Date;
  runLink: string;
  prId: number;
  sha: string;
  repo: Repo;
}

/**
 * Attempts to find an existing action comment for the given PR, or null if one isn't
 * found
 * @param octokit - Current Octokit GitHub API binding instance
 * @param prId - PR ID for the current CI context
 * @param repo - GitHub repo for the current CI context
 */
async function getActionComment(
  octokit: GitHub,
  prId: number,
  repo: Repo,
): Promise<Comment | null> {
  const { data: thisUser } = await octokit.users.getAuthenticated();
  const { data: comments } = await octokit.issues.listComments({
    issue_number: prId,
    ...repo,
  });
  const thisUserComments = comments.filter(
    (comment) => comment.user.id === thisUser.id,
  );
  const specialComments = thisUserComments.filter((comment) =>
    isStagingComment(comment.body),
  );
  if (specialComments.length >= 1) return specialComments[0];
  return null;
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
  const parsedBuildDuration =
    buildDuration.trim().length > 0 ? parseInt(buildDuration.trim()) : null;
  const octokit = new GitHub(token);
  const prId = context.issue.number;
  const { repo } = context;
  const comment = await getActionComment(octokit, prId, repo);

  const runId: string | undefined = process.env.GITHUB_RUN_ID;
  if (runId == null)
    throw new Error(
      `Environment variable "GITHUB_RUN_ID" undefined; couldn't link to action run`,
    );

  const actionContext: ActionContext = {
    stagingUrl: `${baseStagingUrl}/pr/${prId}`,
    buildTime: new Date(Date.parse(buildTime)),
    buildDuration: parsedBuildDuration,
    runLink: buildRunLink(repo, runId),
    shortSha: context.sha.slice(0, 7),
    sha: context.sha,
    comment,
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
 * @param actionContext - Base action context
 */
async function patchComment(
  newBody: string,
  actionContext: ActionContext,
): Promise<void> {
  const { octokit, comment, prId, repo } = actionContext;
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
 * @param actionContext - Base action context
 */
function updateState(
  current: BuildEntry,
  actionContext: ActionContext,
): BuildState {
  const { comment, shortSha } = actionContext;
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
 * Executes the primary action logic before a build, updating the newest build entry and
 * pushing all previous build entries to the bottom section if they exist.
 * @param actionContext - Base action context
 */
async function pre(actionContext: ActionContext): Promise<void> {
  const { prId, stagingUrl: url, shortSha, buildTime, runLink } = actionContext;

  const current: BuildEntry = {
    emoji: BuildEmoji.InProgress,
    status: BuildStatus.InProgress,
    deployUrl: url,
    commitSha: shortSha,
    commitLink: buildCommitLink(actionContext),
    buildTime: date(buildTime),
    buildDuration: null,
    runLink,
  };

  const state = updateState(current, actionContext);
  await patchComment(
    building({ prId: prId.toString(), state, url }),
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
  } = actionContext;

  const current: BuildEntry = {
    emoji: BuildEmoji.Success,
    status: BuildStatus.Success,
    deployUrl: url,
    commitSha: shortSha,
    commitLink: buildCommitLink(actionContext),
    buildTime: date(buildTime),
    buildDuration: buildDuration != null ? duration(buildDuration) : null,
    runLink,
  };

  const state = updateState(current, actionContext);
  await patchComment(
    successful({ prId: prId.toString(), state, url }),
    actionContext,
  );
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

  const state = updateState(current, actionContext);
  await patchComment(
    failed({ prId: prId.toString(), state, url }),
    actionContext,
  );
}
