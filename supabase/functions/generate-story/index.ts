 import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const LOG = "[generate-story]";
const FUNCTION_VERSION = "2025-06-17";
const IMAGE_BATCH_SIZE = 5;

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

const STYLE_PROMPT = "minimal hand-drawn cartoon illustration, loose sketchy pencil and ink linework, simple shapes, soft muted colors, gentle watercolor wash, uncluttered composition with plenty of empty space, friendly expressive characters, warm children's storybook aesthetic, no text, no words, no letters";
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
  makesSense: boolean;
  enjoyableForChild: boolean;
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

type StoryCharacter = {
  name: string;
  role: string;
  introducedOnPage: number;
  appearance: string;
};

type StoryPlotPoint = {
  page: number;
  description: string;
  type: "plot" | "user_input";
  userInput?: string;
};

type CriticFeedback = {
  rating: number;
  faults: string;
  improvements: string;
  inputsFitNaturally: "items_make_sense" | "items_feel_out_of_place";
};

type UserInput = { question: string; answer: string };

type StoryMetadata = {
  characters: StoryCharacter[];
  plotSummary: string;
  criticFeedback: CriticFeedback;
  plotPoints: StoryPlotPoint[];
  paletteNotes: string;
  userInputs: UserInput[];
  illustrationPageLimit?: number;
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

function buildStorySystemPrompt(context: StoryContext, qualityAttempt: number): string {
  const escalation = qualityAttempt <= 1
    ? ""
    : qualityAttempt === 2
      ? "\n\nIMPORTANT — the previous draft failed review. Write one clear linear adventure: setup (pages 1-5), rising action (6-15), satisfying ending (16-20). Every page must follow logically from the last and feel fun to read aloud."
      : "\n\nCRITICAL — multiple drafts failed review. Keep the plot simple: one hero, one journey, one problem to solve. Use vivid concrete scenes on every page. No filler or repetitive sentences. Make each page something a child would love.";

  return `You are a children's book author writing for ${context.childName}, who is ${context.childAge} years old.
${ageWritingGuide(context.childAge)}
Rules:
- Write exactly ${PAGE_COUNT} pages (one paragraph per page)
- Each page should be 1-2 short sentences
- The full story must make sense from beginning to end — clear setup, unfolding events, and a satisfying ending
- Make it genuinely enjoyable for a ${context.childAge}-year-old: warm, playful, surprising, and fun to read aloud
- Weave each child ANSWER below into the plot as story events — the answers are ingredients, not dialogue to recite
- NEVER quote or mention the original prompt questions in the story text
- NEVER write Q&A style lines like 'They wondered: "..."' or '"mouse!" they shouted'
- The story must read like a normal published children's book — answers appear naturally (a mouse in a scene, Mars as a destination, etc.)
- NEVER write filler like "Everyone agreed that X made the day memorable" or "X turned out to be the surprise"
- Each answer should inspire a concrete scene, action, character, place, or object — not be pasted as a bare noun
- Example for answers mouse, Mars, trumpet: GOOD: "A tiny mouse scampered over the giant's boot." BAD: "The path led toward mouse."
- Pages must be unique — do NOT repeat sentences across pages
- Structure: beginning (pages 1-5), middle (pages 6-15), end (pages 16-20)
- Return ONLY JSON: { "title": "Story Title", "pages": ["page 1", "page 2", ...] }
- The pages array must contain exactly ${PAGE_COUNT} strings${escalation}`;
}

function buildRevisionFeedback(
  review: StoryReview,
  inputs: StoryInput[],
  context: StoryContext,
  attempt: number,
): string {
  const parts: string[] = [];
  if (review.feedback) parts.push(review.feedback);

  if (!review.makesSense) {
    parts.push(
      attempt >= 2
        ? "CRITICAL: The story must make sense from beginning to end. Each page should follow logically from the previous one — clear opening goal, developing middle, happy resolution."
        : "The story must read coherently from page 1 to page 20 with a clear beginning, middle, and end.",
    );
  }
  if (!review.enjoyableForChild) {
    parts.push(
      attempt >= 2
        ? `Make this genuinely fun for a ${context.childAge}-year-old: add humor, wonder, surprises, and warmth on every page.`
        : `Make it more enjoyable for a ${context.childAge}-year-old — playful, engaging, and delightful to read aloud.`,
    );
  }
  if (!review.usesInputsInPlot) {
    parts.push(
      `Weave these answers into the plot as events: ${review.missingInputs.join(", ") || inputs.map(i => i.answer).join(", ")}.`,
    );
  }
  if (!review.feelsNatural) {
    parts.push(
      "Rewrite so answers appear naturally in scenes. Do not quote the original questions or paste answers as bare nouns.",
    );
  }
  return parts.filter(Boolean).join(" ");
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

function isPlaceholderImage(url: string | null | undefined): boolean {
  return !url || url.includes("placehold.co");
}

async function assertDevAdmin(
  req: Request,
  supabaseUrl: string,
): Promise<void> {
  const adminEmail = Deno.env.get("DEV_ADMIN_EMAIL");
  if (!adminEmail) {
    throw new Error("Manual illustration is not configured (DEV_ADMIN_EMAIL)");
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) throw new Error("Missing SUPABASE_ANON_KEY");

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user?.email) throw new Error("Unauthorized");
  if (user.email.toLowerCase() !== adminEmail.toLowerCase()) {
    throw new Error("Forbidden");
  }
}

async function findNextPlaceholderStart(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
): Promise<number | null> {
  const { data: pages, error } = await supabase
    .from("pages")
    .select("page_number, image_url")
    .eq("story_id", storyId)
    .order("page_number");

  if (error || !pages?.length) return null;

  for (const page of pages) {
    if (isPlaceholderImage(page.image_url)) return page.page_number;
  }
  return null;
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

function formatInputsForMetadata(inputs: StoryInput[]): string {
  return inputs
    .map((i, n) => `${n + 1}. answer: "${i.answer}" (prompt: ${i.question})`)
    .join("\n");
}

function normalizeInputToken(value: string): string {
  return value.toLowerCase().trim();
}

function sanitizeStoryMetadata(metadata: StoryMetadata, inputs: StoryInput[]): StoryMetadata {
  const allowedAnswers = new Set(inputs.map(i => normalizeInputToken(i.answer)));

  metadata.plotPoints = (metadata.plotPoints ?? []).filter((p) => {
    if (p.type !== "user_input") return true;
    if (!p.userInput) return false;
    const ok = allowedAnswers.has(normalizeInputToken(p.userInput));
    if (!ok) {
      log("Metadata", "Removed hallucinated user_input from plotPoints", { userInput: p.userInput });
    }
    return ok;
  });

  metadata.userInputs = inputs.map(i => ({ question: i.question, answer: i.answer }));
  return metadata;
}

async function buildStoryMetadata(
  story: StoryDraft,
  inputs: StoryInput[],
  context: StoryContext,
  openaiKey: string,
): Promise<StoryMetadata> {
  const storyText = story.pages.map((page, i) => `Page ${i + 1}: ${page}`).join("\n");
  const inputsBlock = formatInputsForMetadata(inputs);

  log("Metadata", "Building story architecture and critic feedback", {
    inputAnswers: inputs.map(i => i.answer),
  });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 1500,
      messages: [
        {
          role: "system",
          content: `You are a professional children's book critic and art director analyzing a story for ${context.childName}, age ${context.childAge}.

Return ONLY JSON with this exact structure:
{
  "characters": [
    {
      "name": "character name",
      "role": "protagonist | sidekick | etc",
      "introducedOnPage": 1,
      "appearance": "Fixed visual design for illustrations"
    }
  ],
  "plotSummary": "1-2 sentence summary of the full story arc",
  "criticFeedback": {
    "rating": 85,
    "faults": "Short paragraph on weaknesses",
    "improvements": "Simple actionable improvements",
    "inputsFitNaturally": "items_make_sense"
  },
  "plotPoints": [
    { "page": 1, "description": "Setup beat", "type": "plot" },
    { "page": 8, "description": "How a specific child answer enters the plot", "type": "user_input", "userInput": "exact answer text from the list below" }
  ],
  "paletteNotes": "3-5 dominant colors and art mood"
}

Rules:
- List ALL characters with the exact page they first appear (introducedOnPage)
- plotPoints must include major plot beats AND one user_input entry per child answer listed below
- For user_input plotPoints, userInput MUST be copied exactly from the child answers list — never invent answers
- Each plotPoint page must be the FIRST page where that beat, activity, or concept appears in the story text
- Plot beats that introduce a new activity (e.g. doing dishes, visiting a place) must have the page where that activity first happens
- criticFeedback.rating is 0-100 for a ${context.childAge}-year-old
- inputsFitNaturally must be exactly "items_make_sense" or "items_feel_out_of_place"`,
        },
        {
          role: "user",
          content: `Child answers (ONLY these may be used as userInput values):\n${inputsBlock}\n\nTitle: ${story.title}\n\n${storyText}`,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Story metadata API error (${response.status})`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Story metadata returned no content");

  let metadata = JSON.parse(content) as StoryMetadata;
  metadata.characters = metadata.characters ?? [];
  metadata.plotPoints = metadata.plotPoints ?? [];
  metadata.criticFeedback = metadata.criticFeedback ?? {
    rating: 0, faults: "", improvements: "", inputsFitNaturally: "items_feel_out_of_place",
  };
  metadata.criticFeedback.rating = Math.min(100, Math.max(0, Math.round(metadata.criticFeedback.rating ?? 0)));
  metadata = sanitizeStoryMetadata(metadata, inputs);
  metadata = alignUserInputPagesToStory(story, metadata);

  log("Metadata", "Story metadata ready", {
    characterCount: metadata.characters.length,
    plotPointCount: metadata.plotPoints.length,
    userInputPlotPoints: metadata.plotPoints.filter(p => p.type === "user_input").length,
    criticRating: metadata.criticFeedback.rating,
    inputsFit: metadata.criticFeedback.inputsFitNaturally,
  });
  return metadata;
}

async function saveStoryMetadata(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  metadata: StoryMetadata,
): Promise<void> {
  const { error } = await supabase
    .from("stories")
    .update({ story_metadata: metadata })
    .eq("id", storyId);

  if (error) {
    logError("Metadata", "Failed to save story_metadata (run migration_phase6.sql?)", {
      storyId, message: error.message,
    });
    throw new Error(`Could not save story metadata: ${error.message}`);
  }
  log("Metadata", "Saved story_metadata", { storyId });
}

function getProtagonist(metadata: StoryMetadata): StoryCharacter | undefined {
  return metadata.characters.find(c => c.role.toLowerCase().includes("protagonist"))
    ?? metadata.characters[0];
}

function formatPlotPointLabel(p: StoryPlotPoint): string {
  if (p.type === "user_input" && p.userInput) {
    return `"${p.userInput}" — ${p.description}`;
  }
  return p.description;
}

/** Re-sync user_input plot point pages to the first page they appear in story text. */
function alignUserInputPagesToStory(story: StoryDraft, metadata: StoryMetadata): StoryMetadata {
  for (const point of metadata.plotPoints) {
    if (point.type !== "user_input" || !point.userInput) continue;

    const needle = normalizeInputToken(point.userInput);
    let firstPage = point.page;

    for (let i = 0; i < story.pages.length; i++) {
      const pageText = normalizeInputToken(story.pages[i]);
      if (pageText.includes(needle)) {
        firstPage = i + 1;
        break;
      }
    }

    if (firstPage !== point.page) {
      log("Metadata", "Adjusted user_input page from story text", {
        userInput: point.userInput,
        was: point.page,
        now: firstPage,
      });
      point.page = firstPage;
    }
  }
  return metadata;
}

function buildPageIllustrationRules(metadata: StoryMetadata, pageNumber: number): string {
  const allowedChars = metadata.characters.filter(c => c.introducedOnPage <= pageNumber);
  const forbiddenChars = metadata.characters.filter(c => c.introducedOnPage > pageNumber);
  const pastPlotPoints = metadata.plotPoints
    .filter(p => p.page < pageNumber)
    .sort((a, b) => a.page - b.page);
  const currentPlotPoints = metadata.plotPoints.filter(p => p.page === pageNumber);
  const futurePlotPoints = metadata.plotPoints
    .filter(p => p.page > pageNumber)
    .sort((a, b) => a.page - b.page);

  const lines: string[] = [
    `Illustration rules for page ${pageNumber}:`,
    "CRITICAL: Illustrate ONLY what the scene text describes for this page.",
    "Do NOT preview, hint at, or include activities, objects, or settings from later pages.",
  ];

  if (allowedChars.length) {
    lines.push("Characters allowed in this scene:");
    for (const c of allowedChars) {
      lines.push(`- ${c.name} (introduced page ${c.introducedOnPage}): ${c.appearance}`);
    }
  }
  if (forbiddenChars.length) {
    lines.push(`Do NOT show yet (introduced later): ${forbiddenChars.map(c => `${c.name} (page ${c.introducedOnPage})`).join(", ")}`);
  }
  if (pastPlotPoints.length) {
    lines.push("Story context so far (background only — do not redraw past scenes):");
    for (const p of pastPlotPoints) {
      lines.push(`- Page ${p.page}: ${formatPlotPointLabel(p)}`);
    }
  }
  if (currentPlotPoints.length) {
    lines.push("This page's story beats — focus the illustration on:");
    for (const p of currentPlotPoints) {
      lines.push(`- ${formatPlotPointLabel(p)}`);
    }
  }
  if (futurePlotPoints.length) {
    lines.push("Do NOT show or hint at these future story beats:");
    for (const p of futurePlotPoints) {
      lines.push(`- Page ${p.page}: ${formatPlotPointLabel(p)}`);
    }
  }

  return lines.join("\n");
}

async function loadAnchorFromStorage(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .download(`${storyId}/page-1.png`);

  if (error || !data) {
    throw new Error(`Could not load character anchor from storage: ${error?.message ?? "missing page-1 image"}`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

function buildAnchorImagePrompt(metadata: StoryMetadata, pageText: string, pageNumber: number): string {
  const scene = buildScenePrompt(pageText);
  const protagonist = getProtagonist(metadata);
  const rules = buildPageIllustrationRules(metadata, pageNumber);

  return `${STYLE_PROMPT}

Character anchor illustration for a children's book. Establish the main character clearly.

Color palette: ${metadata.paletteNotes}
${protagonist ? `Main character — ${protagonist.name}:\n${protagonist.appearance}` : ""}

${rules}

Scene text (illustrate ONLY this): ${scene}

The main character must be clearly visible and recognizable. Simple uncluttered background.
Constraints: original characters only, no text, no words, no watermarks, no future plot spoilers`;
}

function buildFreshScenePrompt(
  metadata: StoryMetadata,
  pageText: string,
  pageNumber: number,
): string {
  const scene = buildScenePrompt(pageText);
  const protagonist = getProtagonist(metadata);
  const rules = buildPageIllustrationRules(metadata, pageNumber);

  return `${STYLE_PROMPT}

Children's book illustration for page ${pageNumber}.
This must be a clearly new scene — different setting, background, layout, and character pose from page 1.

Color palette: ${metadata.paletteNotes}
${protagonist ? `Main character (keep this design consistent):\n${protagonist.name}: ${protagonist.appearance}` : ""}

${rules}

Scene text (illustrate ONLY this): ${scene}

Use a fresh composition: new environment, new framing, new action. Do not repeat page 1's layout.
Constraints: original characters only, no text, no words, no watermarks, no future plot spoilers`;
}

function buildContinuationImagePrompt(
  metadata: StoryMetadata,
  pageText: string,
  pageNumber: number,
): string {
  const scene = buildScenePrompt(pageText);
  const protagonist = getProtagonist(metadata);
  const rules = buildPageIllustrationRules(metadata, pageNumber);

  return `Create a NEW children's book illustration for page ${pageNumber}.
Image 1 is a CHARACTER REFERENCE ONLY — do NOT copy its composition, background, or layout.

${rules}

Scene text (illustrate ONLY this): ${scene}

Character consistency — preserve ONLY the character design from Image 1:
${protagonist?.appearance ?? "Match the main character's face, hair, outfit, and proportions from Image 1"}

Scene variation — REQUIRED (must differ clearly from Image 1 and prior pages):
- New background and setting that matches the scene text
- Different camera angle and framing (wide, medium, or close-up as fits the action)
- Different character pose, expression, and body language
- Different props and environment details
- Do NOT reuse the same layout, pose, or backdrop as Image 1

Style: ${STYLE_PROMPT}
Palette: ${metadata.paletteNotes}

Constraints:
- Illustrate ONLY the scene text above — nothing from later pages
- Same character design, but a visibly different illustration — not a duplicate
- Keep the hand-drawn minimal watercolor look
- No text, no words, no watermarks`;
}

function extractImageB64(data: Record<string, unknown>): string {
  const items = data.data as Array<{ b64_json?: string; url?: string }> | undefined;
  const b64 = items?.[0]?.b64_json;
  if (b64) return b64;
  throw new Error("OpenAI returned no image data");
}

async function callImageGenerate(prompt: string, openaiKey: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "medium",
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Image API error (${response.status})`);
  }
  return extractImageB64(data);
}

async function callImageEdit(
  anchorBytes: Uint8Array,
  prompt: string,
  openaiKey: string,
  inputFidelity: "low" | "high" = "low",
): Promise<string> {
  const form = new FormData();
  form.append("model", IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("image", new Blob([anchorBytes], { type: "image/png" }), "character-anchor.png");
  form.append("input_fidelity", inputFidelity);
  form.append("quality", "medium");
  form.append("size", "1024x1024");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { "Authorization": `Bearer ${openaiKey}` },
    body: form,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Image edit API error (${response.status})`);
  }
  return extractImageB64(data);
}

async function generatePageIllustration(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  pageNumber: number,
  pageText: string,
  openaiKey: string,
  metadata: StoryMetadata,
  anchorBytes: Uint8Array | null,
  retries = 0,
): Promise<{ publicUrl: string; anchorBytes: Uint8Array }> {
  const isAnchor = pageNumber === 1 || anchorBytes === null;
  // Page 2 uses a fresh generate so it doesn't clone page 1's composition via edit.
  const useFreshGenerate = pageNumber === 2;
  const prompt = isAnchor
    ? buildAnchorImagePrompt(metadata, pageText, pageNumber)
    : useFreshGenerate
      ? buildFreshScenePrompt(metadata, pageText, pageNumber)
      : buildContinuationImagePrompt(metadata, pageText, pageNumber);

  try {
    log("Images", `Generating image for page ${pageNumber}`, {
      attempt: retries + 1,
      model: IMAGE_MODEL,
      mode: isAnchor ? "anchor" : useFreshGenerate ? "fresh-scene" : "edit-character-ref",
    });

    const b64 = isAnchor || useFreshGenerate
      ? await callImageGenerate(prompt, openaiKey)
      : await callImageEdit(anchorBytes!, prompt, openaiKey, "low");

    const bytes = base64ToBytes(b64);
    const publicUrl = await uploadStoryImage(supabase, storyId, pageNumber, b64);
    log("Images", `Page ${pageNumber} image ready (uploaded to storage)`);

    // Keep the page-1 anchor for all subsequent edit requests
    const newAnchor = isAnchor ? bytes : anchorBytes!;
    return { publicUrl, anchorBytes: newAnchor };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (retries < MAX_RETRIES) {
      log("Images", `Page ${pageNumber} failed, retrying`, { message, attempt: retries + 1 });
      await new Promise(r => setTimeout(r, 1000 * (retries + 1)));
      return generatePageIllustration(
        supabase, storyId, pageNumber, pageText, openaiKey, metadata, anchorBytes, retries + 1,
      );
    }
    logError("Images", `Page ${pageNumber} failed after ${MAX_RETRIES} retries`, { message });
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

async function updatePageImage(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  pageNumber: number,
  imageUrl: string,
): Promise<void> {
  const { error } = await supabase
    .from("pages")
    .update({ image_url: imageUrl })
    .eq("story_id", storyId)
    .eq("page_number", pageNumber);

  if (error) {
    throw new Error(`Failed to update page ${pageNumber} image: ${error.message}`);
  }
}

async function seedAllPagesWithPlaceholders(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  pageTexts: string[],
): Promise<void> {
  for (let idx = 0; idx < pageTexts.length; idx++) {
    const pageNumber = idx + 1;
    const { error } = await supabase.from("pages").upsert({
      story_id: storyId,
      page_number: pageNumber,
      text_content: pageTexts[idx],
      image_url: placeholderImage(pageNumber),
    }, { onConflict: "story_id,page_number" });

    if (error) {
      throw new Error(`Failed to seed page ${pageNumber}: ${error.message}`);
    }
  }
  await updatePagesCompleted(supabase, storyId, 0);
  log("Run", "Seeded all pages with text and placeholders", { storyId, count: pageTexts.length });
}

async function runIllustrationBatch(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  pageTexts: string[],
  metadata: StoryMetadata,
  openaiKey: string,
  startPage: number,
): Promise<{ startPage: number; endPage: number }> {
  const batchEnd = Math.min(startPage + IMAGE_BATCH_SIZE - 1, pageTexts.length);
  const batchNum = Math.ceil(startPage / IMAGE_BATCH_SIZE);

  log("Images", `Starting batch ${batchNum} (pages ${startPage}-${batchEnd})`, { storyId });

  const { error: statusError } = await supabase.from("stories").update({ status: "generating" }).eq("id", storyId);
  if (statusError) throw new Error(statusError.message);

  let anchorBytes: Uint8Array | null = startPage === 1 ? null : await loadAnchorFromStorage(supabase, storyId);

  for (let pageNumber = startPage; pageNumber <= batchEnd; pageNumber++) {
    const pageText = pageTexts[pageNumber - 1];
    const result = await generatePageIllustration(
      supabase,
      storyId,
      pageNumber,
      pageText,
      openaiKey,
      metadata,
      anchorBytes,
    );
    await updatePageImage(supabase, storyId, pageNumber, result.publicUrl);
    await updatePagesCompleted(supabase, storyId, pageNumber);
    anchorBytes = result.anchorBytes;
    log("Run", "Page illustrated", { storyId, pageNumber, batch: batchNum });

    if (pageNumber < batchEnd) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  log("Images", `Batch ${batchNum} complete`, { storyId, pages: `${startPage}-${batchEnd}` });

  const { error: readyError } = await supabase.from("stories").update({ status: "ready" }).eq("id", storyId);
  if (readyError) throw new Error(readyError.message);
  log("Run", "Illustration batch complete — story ready", { storyId, pages: `${startPage}-${batchEnd}` });
  return { startPage, endPage: batchEnd };
}

async function generateAndSavePages(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  storyId: string,
  childId: string,
  story: StoryDraft,
  metadata: StoryMetadata,
  openaiKey: string,
  devMode: boolean,
  dallePageLimit: number,
): Promise<void> {
  const pageTexts = story.pages;
  log("Images", "Preparing pages for illustration", {
    storyId, pageCount: pageTexts.length, devMode, dallePageLimit, batchSize: IMAGE_BATCH_SIZE,
  });

  await seedAllPagesWithPlaceholders(supabase, storyId, pageTexts);

  if (devMode || !openaiKey) {
    await updatePagesCompleted(supabase, storyId, pageTexts.length);
    log("Images", "Skipping real illustrations (dev mode or no API key)", { storyId });
    return;
  }

  await runIllustrationBatch(supabase, storyId, pageTexts, metadata, openaiKey, 1);
}

async function loadStoryForIllustration(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
): Promise<{ pageTexts: string[]; metadata: StoryMetadata }> {
  const { data: storyRow, error: storyError } = await supabase
    .from("stories")
    .select("title, story_metadata")
    .eq("id", storyId)
    .single();

  if (storyError || !storyRow?.story_metadata) {
    throw new Error(storyError?.message ?? "Story metadata not found — cannot continue illustrations");
  }

  const { data: pages, error: pagesError } = await supabase
    .from("pages")
    .select("page_number, text_content")
    .eq("story_id", storyId)
    .order("page_number");

  if (pagesError || !pages?.length) {
    throw new Error(pagesError?.message ?? "Story pages not found");
  }

  return {
    pageTexts: pages.map(p => p.text_content ?? ""),
    metadata: storyRow.story_metadata as StoryMetadata,
  };
}

async function illustrateNextBatchRun(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  openaiKey: string,
): Promise<{ startPage: number; endPage: number } | null> {
  const startPage = await findNextPlaceholderStart(supabase, storyId);
  if (!startPage) {
    log("Images", "No placeholder pages remaining", { storyId });
    return null;
  }

  const { pageTexts, metadata } = await loadStoryForIllustration(supabase, storyId);
  log("Images", "Manual next batch", { storyId, startPage, batchSize: IMAGE_BATCH_SIZE });

  return await runIllustrationBatch(supabase, storyId, pageTexts, metadata, openaiKey, startPage);
}

async function generateStoryText(
  inputs: StoryInput[],
  openaiKey: string,
  context: StoryContext,
  qualityAttempt = 1,
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
    log("Text", "Requesting story text from OpenAI", { attempt, qualityAttempt, childAge: context.childAge });
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
            content: buildStorySystemPrompt(context, qualityAttempt),
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

  log("Review", "Checking story before illustrations", { childAge: context.childAge, title: story.title });

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

Answer these essential questions:
1. makesSense — Does the story make sense from beginning to end? Is there a coherent narrative with logical flow page to page (not random disconnected scenes)?
2. enjoyableForChild — Is this a good story that a child would genuinely enjoy? Is it fun, warm, engaging, and appropriate for age ${context.childAge}?

Also verify (required for pass):
3. usesInputsInPlot — each child answer (${answerList}) appears in the story AND drives part of the plot
4. feelsNatural — reads like a real picture book; prompt questions are NOT quoted; no forced Q&A recitation of answers

Return ONLY JSON:
{
  "makesSense": true,
  "enjoyableForChild": true,
  "usesInputsInPlot": true,
  "feelsNatural": true,
  "feedback": "brief editor notes explaining any failures",
  "missingInputs": ["answers that are missing or not part of the plot"]
}
Be constructive but firm. Fail makesSense if the arc is unclear or pages feel disconnected. Fail enjoyableForChild if it would bore or confuse a young reader.`,
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
  review.makesSense = Boolean(review.makesSense);
  review.enjoyableForChild = Boolean(review.enjoyableForChild);
  review.usesInputsInPlot = Boolean(review.usesInputsInPlot);
  review.feelsNatural = Boolean(review.feelsNatural);
  review.passes = review.makesSense && review.enjoyableForChild && review.usesInputsInPlot && review.feelsNatural;
  review.missingInputs = review.missingInputs ?? [];
  review.feedback = review.feedback ?? "";

  log("Review", "Pre-illustration check result", {
    passes: review.passes,
    makesSense: review.makesSense,
    enjoyableForChild: review.enjoyableForChild,
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
    const result = await generateStoryText(inputs, openaiKey, { ...context, revisionFeedback }, qualityAttempt);
    const review = await reviewStory(result, inputs, context, openaiKey);
    lastReview = review;

    if (review.passes) {
      log("Review", "Story approved — proceeding to illustrations", { qualityAttempt });
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

    revisionFeedback = buildRevisionFeedback(review, inputs, context, qualityAttempt);

    log("Review", `Pre-illustration check failed — regenerating (${qualityAttempt}/${MAX_QUALITY_ATTEMPTS})`, {
      makesSense: review.makesSense,
      enjoyableForChild: review.enjoyableForChild,
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

/** TEMP: remove before production — dumps metadata for manual QA */
function logStoryMetadataDebug(storyId: string, metadata: StoryMetadata) {
  console.log(`${LOG} [Metadata] ========== STORY METADATA ==========`);
  console.log(`${LOG} [Metadata] Story ID: ${storyId}`);
  console.log(`${LOG} [Metadata] Plot: ${metadata.plotSummary}`);
  console.log(`${LOG} [Metadata] Palette: ${metadata.paletteNotes}`);
  if (metadata.userInputs?.length) {
    console.log(`${LOG} [Metadata] User inputs:`);
    for (const input of metadata.userInputs) {
      console.log(`${LOG} [Metadata]   • "${input.answer}" (${input.question})`);
    }
  }
  for (const c of metadata.characters) {
    console.log(`${LOG} [Metadata] Character: ${c.name} (${c.role}) — page ${c.introducedOnPage}`);
    console.log(`${LOG} [Metadata]   ${c.appearance}`);
  }
  console.log(`${LOG} [Metadata] Critic: ${metadata.criticFeedback.rating}/100 — ${metadata.criticFeedback.inputsFitNaturally}`);
  console.log(`${LOG} [Metadata] Faults: ${metadata.criticFeedback.faults}`);
  console.log(`${LOG} [Metadata] Improvements: ${metadata.criticFeedback.improvements}`);
  for (const p of metadata.plotPoints) {
    const tag = p.type === "user_input" ? `input "${p.userInput}"` : "plot";
    console.log(`${LOG} [Metadata] Page ${p.page} (${tag}): ${p.description}`);
  }
  console.log(`${LOG} [Metadata] ====================================`);
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
  supabaseUrl: string,
  serviceKey: string,
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
  let architectureMetadata: StoryMetadata;

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
    architectureMetadata = sanitizeStoryMetadata({
      characters: [{ name: "Hero", role: "protagonist", introducedOnPage: 1, appearance: "A friendly young explorer in simple adventure clothes" }],
      plotSummary: story.title,
      criticFeedback: {
        rating: 0,
        faults: "Template fallback story — not GPT-generated.",
        improvements: "Set OPENAI_API_KEY and redeploy for real stories.",
        inputsFitNaturally: "items_make_sense",
      },
      plotPoints: inputs.map((input, i) => ({
        page: Math.min(i * 3 + 1, PAGE_COUNT),
        description: `Story weaves in "${input.answer}"`,
        type: "user_input" as const,
        userInput: input.answer,
      })),
      paletteNotes: "Soft muted watercolor storybook palette",
      userInputs: [],
    }, inputs);
  };

  if (!openaiKey) {
    useTemplateFallback("OPENAI_API_KEY not set on edge function");
  } else {
    try {
      const result = await generateStoryWithReview(inputs, openaiKey, childContext);
      story = { title: result.title, pages: result.pages };
      storyMeta = result.meta;
      architectureMetadata = await buildStoryMetadata(story, inputs, childContext, openaiKey);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      useTemplateFallback(reason);
    }
  }

  log("Metadata", "Critic review", {
    rating: architectureMetadata.criticFeedback.rating,
    inputsFit: architectureMetadata.criticFeedback.inputsFitNaturally,
    faults: architectureMetadata.criticFeedback.faults.slice(0, 120),
  });

  architectureMetadata.illustrationPageLimit = PAGE_COUNT;

  await saveStoryMetadata(supabase, storyId, architectureMetadata);
  logStoryMetadataDebug(storyId, architectureMetadata);

  // TEMP: remove before production
  logFullStoryText(storyId, story, storyMeta);

  const { error: titleError } = await supabase.from("stories").update({ title: story.title }).eq("id", storyId);
  if (titleError) logError("Run", "Failed to save title", { storyId, message: titleError.message });

  if (devMode) {
    log("Run", "Dev mode: using placeholder images", { pageCount: story.pages.length });
  } else {
    log("Run", "Generating first illustration batch only (use manual batch for more)", {
      pageCount: story.pages.length,
      batchSize: IMAGE_BATCH_SIZE,
    });
  }

  await generateAndSavePages(
    supabase,
    supabaseUrl,
    serviceKey,
    storyId,
    childId,
    story,
    architectureMetadata,
    openaiKey ?? "",
    devMode,
    dallePageLimit,
  );

  // Real illustrations mark ready after the first batch; dev/placeholder mode finishes here
  if (devMode || !openaiKey) {
    const { error: readyError } = await supabase.from("stories").update({ status: "ready" }).eq("id", storyId);
    if (readyError) throw new Error(readyError.message);
  }

  log("Run", "Generation complete", { storyId, title: story.title, durationMs: Date.now() - started });
  return { title: story.title, pages: story.pages, meta: storyMeta, storyMetadata: architectureMetadata };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      storyId,
      childId,
      inputs,
      devMode = false,
      allowTemplate = false,
      dallePageLimit: requestedLimit,
      mode,
    } = body;

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      logError("Request", "Missing Supabase environment variables");
      return new Response(JSON.stringify({ error: "Missing Supabase environment variables" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (mode === "illustrate_next_batch") {
      if (!storyId || !openaiKey) {
        return new Response(JSON.stringify({ error: "Missing storyId or OPENAI_API_KEY" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        await assertDevAdmin(req, supabaseUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400;
        logError("Request", "Manual illustration denied", { storyId, message });
        return new Response(JSON.stringify({ error: message }), {
          status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      log("Request", "Manual next illustration batch", { storyId });

      const batchRun = async () => {
        try {
          await illustrateNextBatchRun(supabase, storyId, openaiKey);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logError("Run", "Manual illustration batch failed", { storyId, message });
          await setStoryError(supabase, storyId, message);
        }
      };

      EdgeRuntime.waitUntil(batchRun());
      return new Response(
        JSON.stringify({ message: "Next illustration batch started", storyId, functionVersion: FUNCTION_VERSION }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const dallePageLimit = devMode ? 0 : resolveDallePageLimit(requestedLimit, PAGE_COUNT);

    log("Request", "Received", { storyId, childId, devMode, allowTemplate, dallePageLimit, inputCount: inputs?.length });

    if (!storyId || !childId || !inputs) {
      logError("Request", "Missing storyId, childId, or inputs");
      return new Response(JSON.stringify({ error: "Missing storyId, childId, or inputs" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!openaiKey && !devMode) {
      logError("Request", "OPENAI_API_KEY not set and devMode is false");
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log("Request", "Environment check", {
      hasOpenAiKey: Boolean(openaiKey),
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceKey: Boolean(supabaseServiceKey),
      devMode,
    });

    let debugStory: { title: string; pages: string[]; meta?: StoryMeta } | undefined;

    const generate = async () => {
      try {
        debugStory = await runGeneration(
          supabase, supabaseUrl, supabaseServiceKey, storyId, childId, inputs,
          openaiKey ?? "", devMode, allowTemplate, dallePageLimit,
        );
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
        debugStory = await runGeneration(
          supabase, supabaseUrl, supabaseServiceKey, storyId, childId, inputs,
          openaiKey ?? "", devMode, allowTemplate, dallePageLimit,
        );
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
