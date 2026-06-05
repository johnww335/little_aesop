import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const LOG = "[generate-story]";
const FUNCTION_VERSION = "2025-06-13";

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

const STYLE_PROMPT = "bold and playful children's book illustration, bright vivid colours, cartoon style, clean outlines, friendly characters, flat design, no text, no words";
const IMAGE_MODEL = Deno.env.get("IMAGE_MODEL") ?? "gpt-image-1.5";
const IMAGE_BUCKET = "story-images";
const MAX_RETRIES = 2;
const MAX_QUALITY_ATTEMPTS = 3;
const PAGE_COUNT = 20;

type StoryInput = { question: string; answer: string };
type StoryDraft = { title: string; pages: string[] };
type StoryContext = { childName: string; childAge: number; revisionFeedback?: string };
type StoryReview = {
  passes: boolean;
  hasPlot: boolean;
  isFunForAge: boolean;
  usesInputsInPlot: boolean;
  feelsNatural: boolean;
  feedback: string;
  missingInputs: string[];
};

function formatStoryBrief(inputs: StoryInput[]): string {
  return inputs
    .map((i, n) => `${n + 1}. "${i.answer}" (child was thinking about: ${i.question})`)
    .join("\n");
}
type StoryMeta = {
  originalPageCount: number;
  wasPadded: boolean;
  retried: boolean;
  usedFallback?: boolean;
  fallbackReason?: string;
  reviewPassed?: boolean;
  reviewAttempts?: number;
  reviewSkipped?: boolean;
  reviewFeedback?: string;
};

function calculateAge(birthday: string): number {
  const today = new Date();
  const birth = new Date(birthday);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
  return Math.max(0, age);
}

async function fetchChild(
  supabase: ReturnType<typeof createClient>,
  childId: string,
): Promise<StoryContext> {
  const { data, error } = await supabase
    .from("children")
    .select("name, birthday")
    .eq("id", childId)
    .single();

  if (error || !data) {
    logError("Child", "Could not load child profile — using defaults", { childId, message: error?.message });
    return { childName: "the child", childAge: 5 };
  }

  const context = { childName: data.name, childAge: calculateAge(data.birthday) };
  log("Child", "Loaded reader profile", context);
  return context;
}

function ageWritingGuide(age: number): string {
  if (age <= 3) return "Use very simple words, short sentences, and gentle repetition.";
  if (age <= 6) return "Use simple sentences, playful tone, and concrete imagery.";
  if (age <= 9) return "Use clear plots, light humour, and slightly richer vocabulary.";
  return "Use engaging plots with warmth and humour appropriate for a pre-teen.";
}

function resolveDallePageLimit(requested: unknown, pageCount: number): number {
  const envDefault = Deno.env.get("DALLE_PAGE_LIMIT");
  let limit = pageCount;
  if (typeof requested === "number" && Number.isFinite(requested)) {
    limit = requested;
  } else if (envDefault) {
    const parsed = parseInt(envDefault, 10);
    if (Number.isFinite(parsed)) limit = parsed;
  }
  return Math.min(Math.max(0, Math.floor(limit)), pageCount);
}

function placeholderImage(pageNumber: number): string {
  return `https://placehold.co/1024x1024/E8D5A3/2C1A0E/png?text=Page+${pageNumber}`;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function uploadStoryImage(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  pageNumber: number,
  b64: string,
): Promise<string> {
  const path = `${storyId}/page-${pageNumber}.png`;
  const bytes = base64ToBytes(b64);

  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, bytes, {
    contentType: "image/png",
    upsert: true,
  });

  if (error) {
    throw new Error(
      `Storage upload failed (${error.message}). Run migration_phase4.sql to create the story-images bucket.`
    );
  }

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function buildScenePrompt(pageText: string): string {
  const cleaned = pageText.replace(/\s+/g, " ").trim();
  return cleaned.length > 400 ? `${cleaned.slice(0, 397)}…` : cleaned;
}

async function generateImage(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  pageNumber: number,
  prompt: string,
  openaiKey: string,
  pageIndex: number,
  retries = 0,
): Promise<string> {
  const scene = buildScenePrompt(prompt);
  const fullPrompt = `${STYLE_PROMPT}. Scene: ${scene}`;

  try {
    log("Images", `Generating image for page ${pageNumber}`, {
      attempt: retries + 1, model: IMAGE_MODEL, sceneLength: scene.length,
    });
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: fullPrompt,
        n: 1,
        size: "1024x1024",
        quality: "medium",
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || `Image API error (${response.status})`);
    }

    const b64 = data.data?.[0]?.b64_json as string | undefined;
    const url = data.data?.[0]?.url as string | undefined;

    if (b64) {
      const publicUrl = await uploadStoryImage(supabase, storyId, pageNumber, b64);
      log("Images", `Page ${pageNumber} image ready (uploaded to storage)`);
      return publicUrl;
    }
    if (url) {
      log("Images", `Page ${pageNumber} image ready (URL)`);
      return url;
    }
    throw new Error("OpenAI returned no image data");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (retries < MAX_RETRIES) {
      log("Images", `Page ${pageNumber} failed, retrying`, { message, attempt: retries + 1 });
      await new Promise(r => setTimeout(r, 1000 * (retries + 1)));
      return generateImage(supabase, storyId, pageNumber, prompt, openaiKey, pageIndex, retries + 1);
    }
    logError("Images", `Page ${pageNumber} failed after ${MAX_RETRIES} retries`, { message, scene });
    throw new Error(`Page ${pageNumber}: ${message}`);
  }
}

async function setStoryError(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  message: string,
): Promise<void> {
  const trimmed = message.slice(0, 500);
  const { error } = await supabase
    .from("stories")
    .update({ status: "error", error_message: trimmed })
    .eq("id", storyId);

  if (error) {
    logError("Run", "Failed to save error_message — saving status only", { storyId, message: error.message });
    await supabase.from("stories").update({ status: "error" }).eq("id", storyId);
  }
}

async function updatePagesCompleted(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  pagesCompleted: number,
): Promise<void> {
  const { error } = await supabase
    .from("stories")
    .update({ pages_completed: pagesCompleted })
    .eq("id", storyId);

  if (error) {
    logError("Run", "Failed to update pages_completed (run migration_phase3.sql?)", {
      storyId, pagesCompleted, message: error.message,
    });
  }
}

async function savePage(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  pageNumber: number,
  text: string,
  imageUrl: string,
  total: number,
): Promise<void> {
  const { error: insertError } = await supabase.from("pages").insert({
    story_id: storyId,
    page_number: pageNumber,
    text_content: text,
    image_url: imageUrl,
  });

  if (insertError) {
    logError("Run", "Failed to insert page", { storyId, pageNumber, message: insertError.message });
    throw new Error(insertError.message);
  }

  await updatePagesCompleted(supabase, storyId, pageNumber);
  log("Run", "Page saved", { storyId, pageNumber, total });
}

async function generateAndSavePages(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  pageTexts: string[],
  openaiKey: string,
  devMode: boolean,
  dallePageLimit: number,
): Promise<void> {
  log("Images", "Generating and saving pages", {
    storyId, pageCount: pageTexts.length, devMode, dallePageLimit,
  });
  await updatePagesCompleted(supabase, storyId, 0);

  for (let idx = 0; idx < pageTexts.length; idx++) {
    const pageNumber = idx + 1;
    const text = pageTexts[idx];
    const useDalle = !devMode && pageNumber <= dallePageLimit;

    const imageUrl = useDalle
      ? await generateImage(supabase, storyId, pageNumber, text, openaiKey, idx)
      : placeholderImage(pageNumber);

    await savePage(
      supabase,
      storyId,
      pageNumber,
      text,
      imageUrl,
      pageTexts.length,
    );

    if (useDalle && pageNumber < pageTexts.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  log("Images", "All pages saved", { storyId, total: pageTexts.length, dallePages: Math.min(dallePageLimit, pageTexts.length) });
}

async function generateStoryText(
  inputs: StoryInput[],
  openaiKey: string,
  context: StoryContext,
): Promise<{ title: string; pages: string[]; meta: StoryMeta }> {
  const storyBrief = formatStoryBrief(inputs);
  const fillers = [
    "They kept exploring, finding something new and wonderful.",
    "A friendly surprise appeared, making everyone smile.",
    "The adventure grew more exciting with every step.",
    "They worked together and figured out what to do next.",
    "Something sparkly caught their eye in the distance.",
  ];

  let retried = false;
  const revisionNote = context.revisionFeedback
    ? `\n\nFix these issues from the previous draft:\n${context.revisionFeedback}`
    : "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) retried = true;
    log("Text", "Requesting story text from OpenAI", { attempt, childAge: context.childAge });
    const started = Date.now();

    const storyResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 4096,
        messages: [
          {
            role: "system",
            content: `You are a children's book author writing for ${context.childName}, who is ${context.childAge} years old.
${ageWritingGuide(context.childAge)}
Rules:
- Write exactly ${PAGE_COUNT} pages (one paragraph per page)
- Each page should be 1-2 short sentences
- Create a coherent PLOT: a beginning that sets up a goal or problem, a middle where events unfold, and a satisfying ending
- Weave each child ANSWER below into the plot as story events — the answers are ingredients, not dialogue to recite
- NEVER quote or mention the original prompt questions in the story text
- NEVER write Q&A style lines like 'They wondered: "..."' or '"mouse!" they shouted'
- The story must read like a normal published children's book — answers appear naturally (a mouse in a scene, Mars as a destination, etc.)
- NEVER write filler like "Everyone agreed that X made the day memorable" or "X turned out to be the surprise"
- Each answer should inspire a concrete scene, action, character, place, or object — not be pasted as a bare noun
- Example for answers mouse, Mars, trumpet: GOOD: "A tiny mouse scampered over the giant's boot." BAD: "The path led toward mouse."
- Pages must be unique — do NOT repeat sentences across pages
- Make it fun, warm, and engaging for a ${context.childAge}-year-old
- Structure: beginning (pages 1-5), middle (pages 6-15), end (pages 16-20)
- Return ONLY JSON: { "title": "Story Title", "pages": ["page 1", "page 2", ...] }
- The pages array must contain exactly ${PAGE_COUNT} strings`,
          },
          {
            role: "user",
            content: attempt === 1
              ? `Write a children's story weaving ALL of these answers into the plot naturally. Use only the answers in the story — never the questions:\n${storyBrief}${revisionNote}`
              : `Write again with exactly ${PAGE_COUNT} unique pages. Weave ALL answers naturally — do not quote the questions:\n${storyBrief}${revisionNote}`,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    const storyData = await storyResponse.json();
    if (!storyResponse.ok) {
      logError("Text", "OpenAI request failed", {
        attempt,
        status: storyResponse.status,
        error: storyData?.error?.message,
      });
      throw new Error(storyData?.error?.message || `Story text API error (${storyResponse.status})`);
    }

    const content = storyData?.choices?.[0]?.message?.content;
    if (!content) {
      logError("Text", "Missing choices in OpenAI response", { attempt, responseKeys: Object.keys(storyData ?? {}) });
      throw new Error("Unexpected response from story text API");
    }

    const story = JSON.parse(content);
    if (!story.pages || !Array.isArray(story.pages)) {
      logError("Text", "Invalid story format", { attempt, keys: Object.keys(story ?? {}) });
      throw new Error("Story generation returned invalid format");
    }

    const originalPageCount = story.pages.length;

    log("Text", "OpenAI response parsed", {
      attempt,
      title: story.title,
      originalPageCount,
      durationMs: Date.now() - started,
    });

    if (originalPageCount >= PAGE_COUNT) {
      story.pages = story.pages.slice(0, PAGE_COUNT);
      return {
        title: story.title || "Your Story",
        pages: story.pages,
        meta: { originalPageCount, wasPadded: false, retried },
      };
    }

    if (attempt === 1) {
      log("Text", "Retrying because page count was too low", { originalPageCount, target: PAGE_COUNT });
      continue;
    }

    logError("Text", "Still too few pages after retry — padding remaining pages", {
      originalPageCount,
      target: PAGE_COUNT,
    });
    let fillerIdx = 0;
    while (story.pages.length < PAGE_COUNT) {
      story.pages.push(fillers[fillerIdx % fillers.length]);
      fillerIdx++;
    }
    story.pages = story.pages.slice(0, PAGE_COUNT);

    return {
      title: story.title || "Your Story",
      pages: story.pages,
      meta: { originalPageCount, wasPadded: true, retried },
    };
  }

  throw new Error("Story generation failed after retries");
}

async function reviewStory(
  story: StoryDraft,
  inputs: StoryInput[],
  context: StoryContext,
  openaiKey: string,
): Promise<StoryReview> {
  const storyText = story.pages.map((page, i) => `Page ${i + 1}: ${page}`).join("\n");
  const answerList = inputs.map((i) => i.answer).join(", ");
  const questionSnippets = inputs.map((i) => i.question);

  log("Review", "Checking story quality", { childAge: context.childAge, title: story.title });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: `You are a children's book editor reviewing a story for a ${context.childAge}-year-old reader named ${context.childName}.
Evaluate the draft against these three criteria:
1. hasPlot — the story has a clear narrative arc (setup, events, resolution), not just a list of mentions
2. isFunForAge — the tone, vocabulary, and humour are engaging and appropriate for age ${context.childAge}
3. usesInputsInPlot — each child answer (${answerList}) appears in the story AND drives part of the plot
4. feelsNatural — reads like a real picture book; prompt questions are NOT quoted; no forced Q&A recitation of answers

Return ONLY JSON:
{
  "passes": true,
  "hasPlot": true,
  "isFunForAge": true,
  "usesInputsInPlot": true,
  "feelsNatural": true,
  "feedback": "brief editor notes if anything needs fixing",
  "missingInputs": ["answers that are missing or not part of the plot"]
}
Set passes to true only if ALL four criteria are met. Fail feelsNatural if any prompt question appears in the story or answers feel pasted in. Be constructive but firm in feedback when passes is false.`,
        },
        {
          role: "user",
          content: `Answers that must appear naturally in the plot: ${answerList}\nPrompt questions (must NOT appear in story text): ${questionSnippets.join(" | ")}\n\nStory draft:\nTitle: ${story.title}\n${storyText}`,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Story review API error (${response.status})`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Unexpected response from story review API");

  const review = JSON.parse(content) as StoryReview;
  review.passes = Boolean(review.hasPlot && review.isFunForAge && review.usesInputsInPlot && review.feelsNatural);
  review.missingInputs = review.missingInputs ?? [];
  review.feedback = review.feedback ?? "";

  log("Review", "Quality check result", {
    passes: review.passes,
    hasPlot: review.hasPlot,
    isFunForAge: review.isFunForAge,
    usesInputsInPlot: review.usesInputsInPlot,
    feelsNatural: review.feelsNatural,
    missingInputs: review.missingInputs,
    feedback: review.feedback,
  });

  return review;
}

async function generateStoryWithReview(
  inputs: StoryInput[],
  openaiKey: string,
  context: StoryContext,
): Promise<{ title: string; pages: string[]; meta: StoryMeta }> {
  let revisionFeedback = context.revisionFeedback;
  let lastReview: StoryReview | null = null;

  for (let qualityAttempt = 1; qualityAttempt <= MAX_QUALITY_ATTEMPTS; qualityAttempt++) {
    const result = await generateStoryText(inputs, openaiKey, { ...context, revisionFeedback });
    const review = await reviewStory(result, inputs, context, openaiKey);
    lastReview = review;

    if (review.passes) {
      return {
        title: result.title,
        pages: result.pages,
        meta: {
          ...result.meta,
          reviewPassed: true,
          reviewAttempts: qualityAttempt,
        },
      };
    }

    revisionFeedback = [
      review.feedback,
      !review.hasPlot ? "Add a clearer plot with a beginning, middle, and end." : "",
      !review.isFunForAge ? `Make it more fun and age-appropriate for a ${context.childAge}-year-old.` : "",
      !review.usesInputsInPlot
        ? `Weave these answers into the plot as events: ${review.missingInputs.join(", ") || inputs.map(i => i.answer).join(", ")}.`
        : "",
      !review.feelsNatural
        ? "Rewrite so answers appear naturally in the narrative. Do not quote the original questions or recite answers in a Q&A style."
        : "",
    ].filter(Boolean).join(" ");

    log("Review", `Quality check failed — regenerating (${qualityAttempt}/${MAX_QUALITY_ATTEMPTS})`, {
      revisionFeedback,
    });
  }

  throw new Error(
    `Story did not pass quality review after ${MAX_QUALITY_ATTEMPTS} attempts: ${lastReview?.feedback || "Unknown"}`
  );
}

function buildDevStory(inputs: StoryInput[]): StoryDraft {
  const lead = inputs[0]?.answer ?? "the hero";
  const title = `The Adventure of ${lead.charAt(0).toUpperCase()}${lead.slice(1)}`;
  const pages: string[] = [
    `Once upon a time, a brave explorer set off toward the ${lead}.`,
    "The morning air was bright, and every step felt like the start of something wonderful.",
  ];

  const scenes = [
    (a: string) => `The path led them straight toward ${a}, and their heart beat faster with excitement.`,
    (a: string) => `${a.charAt(0).toUpperCase() + a.slice(1)} turned out to be the surprise that changed everything.`,
    (a: string) => `Without ${a}, the adventure might never have happened — lucky it was there!`,
    (a: string) => `They found ${a} waiting at just the right moment, as if the story had planned it all along.`,
  ];

  inputs.forEach(({ answer }, i) => {
    pages.push(scenes[i % scenes.length](answer));
    pages.push(`Everyone agreed that ${answer} made the day even more memorable.`);
  });

  const bridges = [
    "New friends appeared, laughing at every surprising twist along the way.",
    "The path wound through meadows painted gold by the afternoon sun.",
    "A cheerful tune drifted on the breeze, making everyone want to dance.",
    "They paused to watch the sky turn pink and orange as evening arrived.",
    "Fireflies blinked on one by one, like tiny lanterns guiding them home.",
  ];

  while (pages.length < PAGE_COUNT - 1) {
    pages.push(bridges[(pages.length - 2) % bridges.length]);
  }

  pages.push("And they all lived happily ever after, already dreaming of their next adventure together.");
  return { title, pages: pages.slice(0, PAGE_COUNT) };
}

/** TEMP: remove before production — dumps full story text for manual QA */
function logFullStoryText(
  storyId: string,
  story: { title: string; pages: string[] },
  meta?: StoryMeta,
) {
  console.log(`${LOG} [Debug] ========== FULL STORY TEXT ==========`);
  console.log(`${LOG} [Debug] Story ID: ${storyId}`);
  if (meta?.usedFallback) {
    console.warn(`${LOG} [Debug] ⚠️  TEMPLATE STORY — OpenAI failed: ${meta.fallbackReason}`);
  } else if (meta) {
    console.log(`${LOG} [Debug] Pages from OpenAI: ${meta.originalPageCount} / ${PAGE_COUNT}`);
    if (meta.reviewPassed) console.log(`${LOG} [Debug] ✓ Passed quality review (attempt ${meta.reviewAttempts})`);
    if (meta.reviewSkipped) console.warn(`${LOG} [Debug] ⚠️  Quality review skipped`);
    if (meta.reviewFeedback) console.warn(`${LOG} [Debug] Review notes: ${meta.reviewFeedback}`);
    if (meta.wasPadded) console.warn(`${LOG} [Debug] ⚠️  Pages were padded — story may feel repetitive at the end`);
    if (meta.retried) console.warn(`${LOG} [Debug] ⚠️  Generation was retried due to low page count`);
  }
  console.log(`${LOG} [Debug] Title: ${story.title}`);
  story.pages.forEach((page, i) => {
    console.log(`${LOG} [Debug] Page ${i + 1}: ${page}`);
  });
  console.log(`${LOG} [Debug] =====================================`);
}

async function runGeneration(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  childId: string,
  inputs: StoryInput[],
  openaiKey: string,
  devMode: boolean,
  allowTemplate: boolean,
  dallePageLimit: number,
): Promise<{ title: string; pages: string[]; meta?: StoryMeta }> {
  const started = Date.now();
  log("Run", "Generation started", {
    storyId, childId, devMode, allowTemplate, dallePageLimit,
    inputCount: inputs.length, hasOpenAiKey: Boolean(openaiKey),
  });

  const childContext = await fetchChild(supabase, childId);

  const { error: statusError } = await supabase.from("stories").update({ status: "generating" }).eq("id", storyId);
  if (statusError) {
    logError("Run", "Failed to set status=generating", { storyId, message: statusError.message });
    throw new Error(statusError.message);
  }
  log("Run", "Status set to generating", { storyId });

  let story: StoryDraft;
  let storyMeta: StoryMeta | undefined;

  const useTemplateFallback = (reason: string) => {
    if (!allowTemplate) {
      throw new Error(
        reason + " — Set OPENAI_API_KEY in Supabase Edge Function secrets and redeploy generate-story."
      );
    }
    logError("Run", "Using template story (allowTemplate=true)", { reason });
    story = buildDevStory(inputs);
    storyMeta = {
      originalPageCount: story.pages.length,
      wasPadded: false,
      retried: false,
      usedFallback: true,
      fallbackReason: reason,
      reviewSkipped: true,
    };
  };

  if (!openaiKey) {
    useTemplateFallback("OPENAI_API_KEY not set on edge function");
  } else {
    try {
      const result = await generateStoryWithReview(inputs, openaiKey, childContext);
      story = { title: result.title, pages: result.pages };
      storyMeta = result.meta;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      useTemplateFallback(reason);
    }
  }

  // TEMP: remove before production
  logFullStoryText(storyId, story, storyMeta);

  const { error: titleError } = await supabase.from("stories").update({ title: story.title }).eq("id", storyId);
  if (titleError) logError("Run", "Failed to save title", { storyId, message: titleError.message });

  if (devMode) {
    log("Run", "Dev mode: using placeholder images", { pageCount: story.pages.length });
  } else if (dallePageLimit < story.pages.length) {
    log("Run", "Partial illustrations: real images for first pages only", {
      dallePageLimit, placeholdersAfter: story.pages.length - dallePageLimit,
    });
  } else {
    log("Run", "Generating GPT Image illustrations for all pages", { pageCount: story.pages.length });
  }

  await generateAndSavePages(supabase, storyId, story.pages, openaiKey, devMode, dallePageLimit);

  const { error: readyError } = await supabase.from("stories").update({ status: "ready" }).eq("id", storyId);
  if (readyError) {
    logError("Run", "Failed to set status=ready", { storyId, message: readyError.message });
    throw new Error(readyError.message);
  }

  log("Run", "Generation complete", { storyId, title: story.title, durationMs: Date.now() - started });
  return { title: story.title, pages: story.pages, meta: storyMeta };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { storyId, childId, inputs, devMode = false, allowTemplate = false, dallePageLimit: requestedLimit } = await req.json();
    const dallePageLimit = devMode ? 0 : resolveDallePageLimit(requestedLimit, PAGE_COUNT);
    log("Request", "Received", { storyId, childId, devMode, allowTemplate, dallePageLimit, inputCount: inputs?.length });

    if (!storyId || !childId || !inputs) {
      logError("Request", "Missing storyId, childId, or inputs");
      return new Response(JSON.stringify({ error: "Missing storyId, childId, or inputs" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    log("Request", "Environment check", {
      hasOpenAiKey: Boolean(openaiKey),
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceKey: Boolean(supabaseServiceKey),
      devMode,
    });

    if (!supabaseUrl || !supabaseServiceKey) {
      logError("Request", "Missing Supabase environment variables");
      return new Response(JSON.stringify({ error: "Missing Supabase environment variables" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!openaiKey && !devMode) {
      logError("Request", "OPENAI_API_KEY not set and devMode is false");
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let debugStory: { title: string; pages: string[]; meta?: StoryMeta } | undefined;

    const generate = async () => {
      try {
        debugStory = await runGeneration(supabase, storyId, childId, inputs, openaiKey ?? "", devMode, allowTemplate, dallePageLimit);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError("Run", "Generation failed — setting status=error", { storyId, message });
        await setStoryError(supabase, storyId, message);
      }
    };

    if (devMode) {
      log("Request", "Running inline (dev mode)");
      let generationError: string | undefined;
      try {
        debugStory = await runGeneration(supabase, storyId, childId, inputs, openaiKey ?? "", devMode, allowTemplate, dallePageLimit);
      } catch (err) {
        generationError = err instanceof Error ? err.message : String(err);
        logError("Run", "Generation failed — setting status=error", { storyId, message: generationError });
        await setStoryError(supabase, storyId, generationError);
      }
      return new Response(
        JSON.stringify({
          message: generationError ? "Generation failed" : "Generation complete",
          success: !generationError,
          error: generationError,
          storyId,
          devMode: true,
          functionVersion: FUNCTION_VERSION,
          hasOpenAiKey: Boolean(openaiKey),
          debugStory,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    log("Request", "Starting background generation");
    EdgeRuntime.waitUntil(generate());

    return new Response(
      JSON.stringify({ message: "Generation started", storyId, functionVersion: FUNCTION_VERSION, dallePageLimit }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    logError("Request", "Unhandled error", { message });
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
