import * as core from "@actions/core";
import pre from "./states/pre";
import post from "./states/post";

/**
 * Executes the primary logic of the action
 */
async function run(): Promise<void> {
  try {
    const mode: string = core.getInput("mode");
    switch (mode) {
      case "pre":
        await pre();
        break;
      case "post":
        await post();
        break;
      default:
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
