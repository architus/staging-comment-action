import * as core from "@actions/core";
import { run } from "./main";

/**
 * Runs the cleanup script, in which we detect whether the build succeeded or not, and
 * update the comment accordingly
 */
async function cleanup(): Promise<void> {
  try {
    const isSuccess = core.getState("stagingSuccess") === "true";
    const shouldRun = core.getInput("mode") === "post";

    if (!isSuccess && shouldRun) {
      await run("failure");
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

cleanup();
