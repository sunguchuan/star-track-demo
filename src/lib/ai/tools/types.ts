/** Tool-calling contracts shared by FAB tools and the agent loop. */

export type ToolParameterSchema = {
  type: "object";
  properties: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "object" | "array";
      description?: string;
      enum?: string[];
    }
  >;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
};

/** OpenAI-compatible tool list item */
export type OpenAiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
};

export type ChatCompletionMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    /** Gemini OpenAI-compat may require this on follow-up turns. */
    thought_signature?: string;
  }>;
  tool_call_id?: string;
  name?: string;
};

export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: string;
  /** Pass-through for providers that echo opaque tool-call metadata. */
  thoughtSignature?: string;
};

export type ChatCompletionResult = {
  content: string | null;
  toolCalls: ToolCallRequest[];
  finishReason?: string;
};
