import * as core from "@actions/core";
import start from "./states/start";
import success from "./states/success";

/**
 * Executes the primary logic of the action
 */
async function run(): Promise<void> {
  try {
    const mode: string = core.getInput("mode");
    switch (mode) {
      case "start":
        await start();
        break;
      case "success":
        await success();
        break;
      default:
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
