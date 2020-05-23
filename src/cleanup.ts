import * as core from "@actions/core";
import failure from "./states/failure";

/**
 * Runs the cleanup script, in which we detect whether the build succeeded or not, and
 * update the comment accordingly
 */
async function cleanup(): Promise<void> {
  try {
    const isSuccess = core.getState("stagingSuccess") === "true";
    if (!isSuccess) {
      await failure();
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

cleanup();
