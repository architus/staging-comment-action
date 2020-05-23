export enum BuildStatus {
  InProgress = "In&#8209;progress",
  Success = "Success",
  Failure = "Failure",
}

export enum BuildEmoji {
  InProgress = "🟡",
  Success = "🟢",
  Failure = "🔴",
}

export interface BuildEntry {
  emoji: BuildEmoji;
  status: BuildStatus;
  deployUrl: string;
  commitSha: string;
  commitLink: string;
  buildTime: Date;
  buildDuration: number;
  actionRunLink: string;
}

export interface CommentArgs {
  prId: string;
  url: string;
  buildEntry: BuildEntry;
  previousBuilds: string[];
}

const BUILD_ENTRY_REGEX = /^|.*|\s*$/;

/**
 * Gets all build entries from a previous build comment
 * @param comment - Original comment markdown
 */
export function getBuildEntries(comment: string): string[] {
  const lines = comment.split(/\r?\n/);
  const entries: string[] = [];
  for (const line of lines) {
    if (
      line.match(BUILD_ENTRY_REGEX) &&
      !(line.startsWith("| | Status |") || line.startsWith("|-|-|"))
    ) {
      entries.push(line);
    }
  }
  return entries;
}

/**
 * Renders the failure comment
 */
export const failure = ({
  buildEntry,
  previousBuilds,
}: CommentArgs): string => `
There was an error building a deploy preview for the last commit.
For more details, check the output of the action run [here](${
  buildEntry.actionRunLink
}).

${details({ buildEntry, previousBuilds })}
`;

/**
 * Renders the building successful comment
 */
export const successful = ({
  prId,
  url,
  buildEntry,
  previousBuilds,
}: CommentArgs): string =>
  `
A deploy preview has been created for this Pull Request (#${prId}),
which is available at ${url}.

${details({ buildEntry, previousBuilds })}
`.trim();

/**
 * Renders the building in-progress comment
 */
export const building = ({
  prId,
  url,
  buildEntry,
  previousBuilds,
}: CommentArgs): string =>
  `
A deploy preview is being created for this Pull Request (#${prId}),
which will be available at ${url} once completed.

${details({ buildEntry, previousBuilds })}
`.trim();

/**
 * Renders the inner details section of a build comment
 */
export const details = ({
  buildEntry,
  previousBuilds,
}: Pick<CommentArgs, "buildEntry" | "previousBuilds">): string => `
#### Build details

| | Status | Url | Commit | Started at | Duration | Action run |
|-|-|-|-|-|-|-|
${entry(buildEntry)}

<details><summary>Previous builds</summary>
<p>

${previous(previousBuilds)}

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
  actionRunLink,
}: BuildEntry): string =>
  `| ${emoji} | ${status} | [link](${deployUrl}) | [${commitSha}](${commitLink}) | ${date(
    buildTime,
  )} | ${duration(buildDuration)} | [link](${actionRunLink}) |
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
export const previous = (previousBuilds: string[]): string =>
  previousBuilds.length > 0
    ? previousBuilds.join("\n")
    : `No previous builds found`;
