import * as core from "@actions/core";
import { run } from "./main";

/**
 * Executes the primary logic of the action
 */
export async function bootstrap(): Promise<void> {
  try {
    const mode: string = core.getInput("mode");
    if (mode === "pre" || mode === "post" || mode === "failure")
      await run(mode);
  } catch (error) {
    core.setFailed(error.message);
  }
}

bootstrap();
