"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.previous = exports.date = exports.duration = exports.entry = exports.details = exports.building = exports.successful = exports.failure = exports.getBuildEntries = exports.BuildEmoji = exports.BuildStatus = void 0;
var BuildStatus;
(function (BuildStatus) {
    BuildStatus["InProgress"] = "In&#8209;progress";
    BuildStatus["Success"] = "Success";
    BuildStatus["Failure"] = "Failure";
})(BuildStatus = exports.BuildStatus || (exports.BuildStatus = {}));
var BuildEmoji;
(function (BuildEmoji) {
    BuildEmoji["InProgress"] = "\uD83D\uDFE1";
    BuildEmoji["Success"] = "\uD83D\uDFE2";
    BuildEmoji["Failure"] = "\uD83D\uDD34";
})(BuildEmoji = exports.BuildEmoji || (exports.BuildEmoji = {}));
const BUILD_ENTRY_REGEX = /^|.*|\s*$/;
/**
 * Gets all build entries from a previous build comment
 * @param comment - Original comment markdown
 */
function getBuildEntries(comment) {
    const lines = comment.split(/\r?\n/);
    const entries = [];
    for (const line of lines) {
        if (line.match(BUILD_ENTRY_REGEX) &&
            !(line.startsWith("| | Status |") || line.startsWith("|-|-|"))) {
            entries.push(line);
        }
    }
    return entries;
}
exports.getBuildEntries = getBuildEntries;
/**
 * Renders the failure comment
 */
exports.failure = ({ buildEntry, previousBuilds, }) => `
There was an error building a deploy preview for the last commit.
For more details, check the output of the action run [here](${buildEntry.actionRunLink}).

${exports.details({ buildEntry, previousBuilds })}
`;
/**
 * Renders the building successful comment
 */
exports.successful = ({ prId, url, buildEntry, previousBuilds, }) => `
A deploy preview has been created for this Pull Request (#${prId}),
which is available at ${url}.

${exports.details({ buildEntry, previousBuilds })}
`.trim();
/**
 * Renders the building in-progress comment
 */
exports.building = ({ prId, url, buildEntry, previousBuilds, }) => `
A deploy preview is being created for this Pull Request (#${prId}),
which will be available at ${url} once completed.

${exports.details({ buildEntry, previousBuilds })}
`.trim();
/**
 * Renders the inner details section of a build comment
 */
exports.details = ({ buildEntry, previousBuilds, }) => `
#### Build details

| | Status | Url | Commit | Started at | Duration | Action run |
|-|-|-|-|-|-|-|
${exports.entry(buildEntry)}

<details><summary>Previous builds</summary>
<p>

${exports.previous(previousBuilds)}

</p>
</details>`;
/**
 * Renders a single build entry to Markdown
 */
exports.entry = ({ emoji, status, deployUrl, commitSha, commitLink, buildTime, buildDuration, actionRunLink, }) => `| ${emoji} | ${status} | [link](${deployUrl}) | [${commitSha}](${commitLink}) | ${exports.date(buildTime)} | ${exports.duration(buildDuration)} | [link](${actionRunLink}) |
`.trim();
/**
 * Renders a duration to a `4m 2s` format
 * @param totalSeconds - Total number of seconds in the duration
 */
exports.duration = (totalSeconds) => {
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
exports.date = (dateTime) => {
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
exports.previous = (previousBuilds) => previousBuilds.length > 0
    ? previousBuilds.join("\n")
    : `No previous builds found`;
