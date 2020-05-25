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
  state: BuildState;
}

/**
 * Current state of the build CI
 */
export interface BuildState {
  latest: BuildEntry;
  previous: BuildEntry[];
}

const COMMENT_TAG = "<!-- ci/staging-comment-action -->";
const HEADER_ROW = "| | Status | Url | Commit | Started at | Duration | Job |";
const SEPARATOR_ROW = "|-|-|-|-|-|-|-|";
const NULL = "~";

/**
 * Determines if the given comment comes from this action, where it should include a
 * hidden HTML comment at the beginning (see `COMMENT_TAG`)
 * @param body - Comment body
 */
export function isStagingComment(body: string): boolean {
  return body.trim().startsWith(COMMENT_TAG);
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
  const strippedLine = line
    .trim()
    .replace(/^(|)/, "")
    .replace(/(|)$/, "");
  const cells = strippedLine.split("|").map((cell) => cell.trim());
  if (cells.length !== 8)
    throw new Error(
      `Incorrect number of cells in build entry: ${JSON.stringify(cells)}`,
    );
  const [commitSha, commitLink] = parseLink(cells[3]);
  return {
    emoji: cells[0] as BuildEmoji,
    status: cells[1] as BuildStatus,
    deployUrl: cells[2] === NULL ? null : cells[2],
    commitSha,
    commitLink,
    buildTime: cells[4],
    buildDuration: cells[5] === NULL ? null : cells[5],
    runLink: parseLink(cells[6])[1],
  };
}

const MARKDOWN_LINK_REGEX = /^\((.*)\[(.*)\]\)$/;

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

/**
 * Renders the failure comment
 */
export const failed = ({ state }: CommentArgs): string => `
${COMMENT_TAG}
There was an error building a deploy preview for the last commit.
For more details, check the output of the action run [here](${
  state.latest.runLink
}).

${details(state)}
`;

/**
 * Renders the building successful comment
 */
export const successful = ({ prId, url, state }: CommentArgs): string =>
  `
${COMMENT_TAG}
A deploy preview has been created for this Pull Request (#${prId}),
which is available at ${url}.

${details(state)}
`.trim();

/**
 * Renders the building in-progress comment
 */
export const building = ({ prId, url, state }: CommentArgs): string =>
  `
${COMMENT_TAG}
A deploy preview is being created for this Pull Request (#${prId}),
which will be available at ${url} once completed.

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
  } | [${commitSha}](${commitLink}) | ${buildTime} | ${
    buildDuration != null ? buildDuration : NULL
  } | ${link("link", runLink)} |
`.trim();

/**
 * Renders a duration to a `4m 2s` format
 * @param totalSeconds - Total number of seconds in the duration
 */
export const duration = (totalSeconds: number): string => {
  const minutes = totalSeconds % 60;
  const seconds = Math.floor(totalSeconds / 60);
  return `${minutes}m ${seconds}s`;
};

/**
 * Constructs a link using Markdown syntax
 * @param text - Link text
 * @param url - Link href
 */
const link = (text: string, url: string): string => `[${text}](${url})`;

const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Formats a date object into a markdown string
 * @param dateTime - JavaScript date object
 */
export const date = (dateTime: Date): string => {
  const month = months[dateTime.getMonth()];
  const day = dateTime.getDate();
  const hours = dateTime.getHours();
  const hoursTrimmed = hours % 12;
  const amPm = hours >= 12 ? "PM" : "AM";
  const minutes = dateTime.getMinutes();
  const seconds = dateTime.getSeconds();
  return `${month} ${day} at ${hoursTrimmed}:${minutes}:${seconds} ${amPm}`;
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
