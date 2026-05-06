import type { AgentInput, ResponseRenderInput, WorkflowExtraction } from "./types";

export interface ModelClient {
  extractWorkflowUpdate(input: AgentInput): Promise<WorkflowExtraction>;
  renderResponse(input: ResponseRenderInput): Promise<string>;
}
