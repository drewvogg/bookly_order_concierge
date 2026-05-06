import type { AgentInput, ResponseRenderInput, WorkflowExtraction } from "./types";
import type { ModelClient } from "./modelClient";
import { extractDeterministicWorkflowUpdate } from "./workflowPlanner";

export class DemoModelClient implements ModelClient {
  async extractWorkflowUpdate(input: AgentInput): Promise<WorkflowExtraction> {
    return extractDeterministicWorkflowUpdate(input);
  }

  async renderResponse(input: ResponseRenderInput): Promise<string> {
    return input.defaultMessage;
  }
}
