import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const LOG = "[validate-inputs]";

function log(stage: string, message: string, data?: Record<string, unknown>) {
  if (data) console.log(`${LOG} [${stage}] ${message}`, data);
  else console.log(`${LOG} [${stage}] ${message}`);
}

function logError(stage: string, message: string, data?: Record<string, unknown>) {
  if (data) console.error(`${LOG} [${stage}] ${message}`, data);
  else console.error(`${LOG} [${stage}] ${message}`);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type StoryInput = { question: string; answer: string };

async function checkAnswer(input: StoryInput, index: number): Promise<{ safe: boolean; reason?: string }> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    throw new Error("Content validation is not configured. Please try again later.");
  }

  log("Check", `Validating answer ${index}`, { question: input.question });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 100,
      messages: [
        {
          role: "system",
          content: `You are a content moderator for a children's book app.
Review the answer a child gave to a story prompt.
Respond with JSON only: { "safe": true } if the answer is appropriate for children,
or { "safe": false, "reason": "brief user-friendly reason" } if it contains explicit, sexual, violent, or otherwise inappropriate content.
Be lenient — mild silliness, gross-out humour (e.g. boogers, farts), and imaginative answers are fine.
Only flag genuinely inappropriate content.`,
        },
        {
          role: "user",
          content: `Q: ${input.question}\nA: ${input.answer}`,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    logError("Check", `Answer ${index} OpenAI error`, { status: response.status, error: data?.error?.message });
    throw new Error(data?.error?.message || `Validation service error (${response.status})`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    logError("Check", `Answer ${index} missing choices in response`);
    throw new Error("Unexpected response from validation service");
  }

  const result = JSON.parse(content);
  log("Check", `Answer ${index} result`, { safe: result.safe, reason: result.reason });
  return result;
}

function formatQuestionList(indexes: number[]): string {
  if (indexes.length === 1) return String(indexes[0]);
  if (indexes.length === 2) return `${indexes[0]} and ${indexes[1]}`;
  return `${indexes.slice(0, -1).join(", ")}, and ${indexes[indexes.length - 1]}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { inputs } = await req.json();
    log("Request", "Received", { inputCount: inputs?.length, hasOpenAiKey: Boolean(Deno.env.get("OPENAI_API_KEY")) });

    if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
      logError("Request", "No inputs provided");
      return new Response(
        JSON.stringify({ error: "No inputs provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = await Promise.all(
      inputs.map(async (input: StoryInput, index: number) => {
        try {
          const result = await checkAnswer(input, index + 1);
          return {
            index: index + 1,
            safe: result.safe !== false,
            reason: result.reason,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Validation failed";
          logError("Check", `Answer ${index + 1} service error`, { message });
          return {
            index: index + 1,
            safe: false,
            reason: message,
            serviceError: true,
          };
        }
      })
    );

    const serviceErrors = results.filter((r) => r.serviceError);
    if (serviceErrors.length > 0) {
      logError("Request", "Validation aborted due to service error", { error: serviceErrors[0].reason });
      return new Response(
        JSON.stringify({
          safe: false,
          error: serviceErrors[0].reason,
          failedIndexes: [],
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const failed = results.filter((r) => !r.safe);
    if (failed.length === 0) {
      log("Request", "All answers passed");
      return new Response(
        JSON.stringify({ safe: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const failedIndexes = failed.map((r) => r.index);
    const failedReasons: Record<number, string> = {};
    failed.forEach((r) => {
      failedReasons[r.index] = r.reason || "Please try a different answer";
    });

    const reason = failed.length === 1
      ? failedReasons[failedIndexes[0]]
      : `Questions ${formatQuestionList(failedIndexes)} need different answers.`;

    log("Request", "Answers flagged", { failedIndexes, failedReasons });

    return new Response(
      JSON.stringify({ safe: false, reason, failedIndexes, failedReasons }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Validation failed";
    logError("Request", "Unhandled error", { message });
    return new Response(
      JSON.stringify({
        safe: false,
        error: message,
        failedIndexes: [],
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
