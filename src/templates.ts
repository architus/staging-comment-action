import { DateTime } from "luxon";

/**
 * Build status text
 */
export enum BuildStatus {
  InProgress = "In&#8209;progress",
  Success = "Success",
  Failure = "Failure",
}

/**
 * Build status icon as a unicode emoji
 */
export enum BuildEmoji {
  InProgress = "🟡",
  Success = "🟢",
  Failure = "🔴",
}

/**
 * Serializes/parsed build entry
 */
export interface BuildEntry {
  emoji: BuildEmoji;
  status: BuildStatus;
  deployUrl: string | null;
  commitSha: string;
  commitLink: string;
  buildTime: string;
  buildDuration: string | null;
  runLink: string;
}

/**
 * Comment args for creating a new/updated comment
 */
export interface CommentArgs {
  prId: string;
  url: string;
  tag: string | Nil;
  state: BuildState;
}

/**
 * Current state of the build CI
 */
export interface BuildState {
  latest: BuildEntry;
  previous: BuildEntry[];
}

type Nil = null | undefined;
const COMMENT_TAG = (tag: string | Nil): string =>
  `<!-- ci/staging-comment-action${tag != null ? `-${tag}` : ""} -->`;
const HEADER_ROW = "| | Status | Url | Commit | Started at | Duration | Job |";
const SEPARATOR_ROW = "|-|-|-|-|-|-|-|";
const NULL = "~";

/**
 * Determines if the given comment comes from this action, where it should include a
 * hidden HTML comment at the beginning (see `COMMENT_TAG`)
 * @param body - Comment body
 */
export function isStagingComment(body: string, tag: string | Nil): boolean {
  const trimmed = body.trim();
  return trimmed.startsWith(COMMENT_TAG(tag));
}

const BUILD_ENTRY_REGEX = /^\|.*\|\s*$/;

/**
 * Gets each build entry from a comment body, splitting the top entry from the previous
 * entries, if they exist. Throws an Exception if parsing fails or there aren't enough
 * build entries.
 * @param body - Comment body
 */
export function getBuildState(body: string): BuildState {
  const lines = body.split(/\r?\n/);
  const entries: BuildEntry[] = [];
  for (const line of lines) {
    if (
      line.match(BUILD_ENTRY_REGEX) &&
      !(line.startsWith(HEADER_ROW) || line.startsWith(SEPARATOR_ROW))
    ) {
      entries.push(parseBuildEntry(line));
    }
  }

  if (entries.length >= 1)
    return { latest: entries[0], previous: entries.slice(1) };
  throw new Error(`Too few build entries parsed from comment ${body}`);
}

/**
 * Parses a single build entry line from the comment body. Throws an Exception if parsing
 * fails
 * @param line - Line from comment body that is a table line
 */
function parseBuildEntry(line: string): BuildEntry {
  const cells = line
    .trim()
    .replace(/^(|)/, "")
    .replace(/(|)$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
  if (cells.length !== 7)
    throw new Error(
      `Incorrect number of cells in build entry: ${JSON.stringify(cells)}`,
    );
  const [commitSha, commitLink] = parseLink(cells[3]);
  return {
    emoji: cells[0] as BuildEmoji,
    status: cells[1] as BuildStatus,
    deployUrl: cells[2] === NULL ? null : parseLink(cells[2])[1],
    commitSha: commitSha.replace(/`/, ""),
    commitLink,
    buildTime: cells[4],
    buildDuration: cells[5] === NULL ? null : cells[5],
    runLink: parseLink(cells[6])[1],
  };
}

const MARKDOWN_LINK_REGEX = /^\[(.*)\]\((.*)\)$/;

/**
 * Parses an inline markdown link into its `[text, url]` components, throwing an Exception
 * if parsing fails
 * @param markdown - Markdown link inline element
 */
function parseLink(markdown: string): [string, string] {
  const matchObject = MARKDOWN_LINK_REGEX.exec(markdown);
  if (matchObject != null) return [matchObject[1], matchObject[2]];
  throw new Error(`Unable to parse markdown link ${markdown}`);
}

const LINK_NOTE =
  "Semi-permanent links to the built versions of each commit are available in the details below, which are kept for 2 weeks after they are created.";

/**
 * Renders the failure comment
 */
export const failed = ({ state, tag }: CommentArgs): string => `
${COMMENT_TAG(tag)}
There was an error building a deploy preview for the last commit. For more details, check the output of the action run [here](${
  state.latest.runLink
}).

${LINK_NOTE}

${details(state)}
`;

/**
 * Renders the building successful comment
 */
export const successful = ({ prId, url, state, tag }: CommentArgs): string =>
  `
  ${COMMENT_TAG(tag)}
A deploy preview has been created for this Pull Request (#${prId}), which is available at ${url}.

${LINK_NOTE}

${details(state)}
`.trim();

/**
 * Renders the building in-progress comment
 */
export const building = ({ prId, url, state, tag }: CommentArgs): string =>
  `
${COMMENT_TAG(tag)}
A deploy preview is being created for this Pull Request (#${prId}), which will be available at ${url} once completed.

${LINK_NOTE}

${details(state)}
`.trim();

/**
 * Renders the inner details section of a build comment
 */
export const details = (state: BuildState): string => `
#### Build details

${HEADER_ROW}
${SEPARATOR_ROW}
${entry(state.latest)}

<details><summary>Previous builds</summary>
<p>

${previous(state.previous)}

</p>
</details>`;

/**
 * Renders a single build entry to Markdown
 */
export const entry = ({
  emoji,
  status,
  deployUrl,
  commitSha,
  commitLink,
  buildTime,
  buildDuration,
  runLink,
}: BuildEntry): string =>
  `| ${emoji} | ${status} | ${
    deployUrl != null ? link("link", deployUrl) : NULL
  } | ${link(`\`${commitSha}\``, commitLink)} | ${buildTime} | ${
    buildDuration != null ? buildDuration : NULL
  } | ${link("link", runLink)} |
`.trim();

/**
 * Renders a duration to a `4m 2s` format
 * @param totalSeconds - Total number of seconds in the duration
 */
export const duration = (totalSeconds: number): string => {
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}m ${seconds}s`;
};

/**
 * Constructs a link using Markdown syntax
 * @param text - Link text
 * @param url - Link href
 */
const link = (text: string, url: string): string => `[${text}](${url})`;

/**
 * Formats a date object into a markdown string
 * @param dateTime - JavaScript date object
 */
export const date = (jsDateTime: Date): string => {
  const timeZone = process.env.TIME_ZONE ?? "America/New_York";
  const dateTime = DateTime.fromJSDate(jsDateTime).setZone(timeZone);
  return `${dateTime.toFormat("LLL d")} at ${dateTime.toFormat("h:mm a ZZZZ")}`;
};

/**
 * Renders the previous builds
 * @param previousBuilds - String of pre-rendered Markdown content for the table body
 */
const previous = (previousBuilds: BuildEntry[]): string =>
  previousBuilds.length > 0
    ? `
${HEADER_ROW}
${SEPARATOR_ROW}
${previousBuilds.map(entry).join("\n")}
      `.trim()
    : `No previous builds found`;
