 import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const LOG = "[generate-story]";
const FUNCTION_VERSION = "2026-06-24";
const MAX_BLUEPRINT_ATTEMPTS = 3;
const IMAGE_BATCH_SIZE = 5;
/** Chained auto-runs use one page per edge invocation to stay within wall-clock limits. */
const CHAIN_PAGE_SIZE = 1;

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
const MAX_RETRIES = 1;
const MAX_QUALITY_ATTEMPTS = 3;
const PAGE_COUNT = 20;
/** How many past stories to scan for critic lessons (Phase A feedback loop). */
const PRIOR_STORY_FEEDBACK_LIMIT = 3;
/** Stories rated below this contribute improvements to the next generation. */
const CRITIC_LESSONS_RATING_THRESHOLD = 80;

type StoryInput = { question: string; answer: string };
type StoryDraft = { title: string; pages: string[] };
type StoryContext = {
  childName: string;
  childAge: number;
  revisionFeedback?: string;
  /** Lessons distilled from this child's past story metadata (Phase A). */
  priorStoryLessons?: string;
};
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
  blueprintPassed?: boolean;
  blueprintAttempts?: number;
  blueprintRating?: number;
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

type PriorFeedbackSource = {
  storyId: string;
  title: string;
  rating: number;
  awkwardInputs: boolean;
};

/** Generalized lessons injected when this story was written (from prior stories). */
type AppliedPriorLessons = {
  lessons: string[];
  promptText: string;
  method: "gpt" | "fallback";
  sourceStories: PriorFeedbackSource[];
  createdAt: string;
};

type StoryArchitecture = {
  protagonistGoal: string;
  centralProblem: string;
  resolution: string;
  act1Summary: string;
  act2Summary: string;
  act3Summary: string;
};

type VisualBible = {
  primarySetting: string;
  settingRules: string;
  paletteNotes: string;
};

type StoryboardBeat = {
  page: number;
  beat: string;
  storyJob: string;
  inputsUsed: string[];
  charactersOnStage: string[];
  setting: string;
  sceneBrief: string;
  mood: string;
};

type InputMapEntry = {
  answer: string;
  question: string;
  narrativeJob: string;
  pages: number[];
};

type StoryBlueprint = {
  title: string;
  architecture: StoryArchitecture;
  visualBible: VisualBible;
  characters: StoryCharacter[];
  inputMap: InputMapEntry[];
  storyboard: StoryboardBeat[];
};

type BlueprintReview = {
  passes: boolean;
  rating: number;
  hasClearConflict: boolean;
  inputsDrivePlot: boolean;
  noFillerBeats: boolean;
  coherentSetting: boolean;
  feedback: string;
  missingInputs: string[];
};

type BlueprintReviewRecord = {
  passed: boolean;
  rating: number;
  attempts: number;
  feedback: string;
};

type StoryMetadata = {
  characters: StoryCharacter[];
  plotSummary: string;
  criticFeedback: CriticFeedback;
  plotPoints: StoryPlotPoint[];
  paletteNotes: string;
  userInputs: UserInput[];
  illustrationPageLimit?: number;
  appliedPriorLessons?: AppliedPriorLessons;
  architecture?: StoryArchitecture;
  visualBible?: VisualBible;
  storyboard?: StoryboardBeat[];
  inputMap?: InputMapEntry[];
  blueprintReview?: BlueprintReviewRecord;
};

type PriorStoryLessonsResult = {
  promptText: string;
  applied: AppliedPriorLessons;
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

type PriorStoryRow = {
  id: string;
  title: string | null;
  story_metadata: StoryMetadata | null;
};

async function fetchPriorStoryFeedback(
  supabase: ReturnType<typeof createClient>,
  childId: string,
  excludeStoryId?: string,
): Promise<PriorStoryRow[]> {
  const { data, error } = await supabase
    .from("stories")
    .select("id, title, story_metadata")
    .eq("child_id", childId)
    .eq("status", "ready")
    .not("story_metadata", "is", null)
    .order("created_at", { ascending: false })
    .limit(PRIOR_STORY_FEEDBACK_LIMIT + (excludeStoryId ? 1 : 0));

  if (error) {
    logError("Feedback", "Could not load prior story metadata — skipping lessons", {
      childId,
      message: error.message,
    });
    return [];
  }

  const rows = (data ?? []) as PriorStoryRow[];
  return excludeStoryId ? rows.filter((r) => r.id !== excludeStoryId).slice(0, PRIOR_STORY_FEEDBACK_LIMIT) : rows;
}

/** Raw critic notes from one past story, before generalization. */
type PriorFeedbackItem = {
  storyId: string;
  title: string;
  rating: number;
  faults: string;
  improvements: string;
  awkwardInputs: boolean;
};

function collectPriorStoryFeedback(priorStories: PriorStoryRow[]): PriorFeedbackItem[] {
  const items: PriorFeedbackItem[] = [];

  for (const row of priorStories) {
    const critic = row.story_metadata?.criticFeedback;
    if (!critic) continue;

    const weakRating = critic.rating < CRITIC_LESSONS_RATING_THRESHOLD;
    const awkwardInputs = critic.inputsFitNaturally === "items_feel_out_of_place";
    if (!weakRating && !awkwardInputs) continue;

    items.push({
      storyId: row.id,
      title: row.title?.trim() || "Untitled story",
      rating: critic.rating,
      faults: critic.faults?.trim() ?? "",
      improvements: critic.improvements?.trim() ?? "",
      awkwardInputs,
    });
  }

  return items;
}

function buildFallbackLessonList(items: PriorFeedbackItem[]): string[] {
  const lines: string[] = [];
  const combined = items.map(i => `${i.faults} ${i.improvements}`).join(" ");

  if (items.some(i => i.awkwardInputs)) {
    lines.push("Weave each child answer as a concrete scene, action, or setting — never as a bare label or pasted noun.");
  }
  if (/conflict|challenge|middle|pacing|filler|weak|disconnected|flat/i.test(combined)) {
    lines.push("Include a clear problem or challenge in the middle pages, with rising action before a satisfying ending.");
  }
  if (/input|answer|weave|natural|forced|pasted|integrat/i.test(combined) || items.some(i => i.awkwardInputs)) {
    lines.push("Every child answer must drive part of the plot as an event or detail, spread naturally across the story.");
  }
  if (!lines.length) {
    lines.push("Write a clear linear adventure with vivid scenes on every page and no filler or repetitive sentences.");
  }

  return lines;
}

/** Rule-based fallback when GPT generalization is unavailable. */
function fallbackGeneralizedLessons(items: PriorFeedbackItem[]): { lessons: string[]; promptText: string } {
  const lessons = buildFallbackLessonList(items);
  return { lessons, promptText: formatGeneralizedLessons(lessons) };
}

function formatGeneralizedLessons(lessons: string[]): string {
  return [
    "General lessons from past stories (apply to this new story only — do not reuse old plots, names, or answers):",
    ...lessons.map((lesson, i) => `${i + 1}. ${lesson}`),
  ].join("\n");
}

async function generalizePriorStoryLessons(
  items: PriorFeedbackItem[],
  context: StoryContext,
  openaiKey: string,
): Promise<string[]> {
  const rawBlock = items.map((item, i) => {
    const parts = [`Story ${i + 1} "${item.title}" (critic ${item.rating}/100)`];
    if (item.faults) parts.push(`Faults: ${item.faults}`);
    if (item.improvements) parts.push(`Improvements: ${item.improvements}`);
    if (item.awkwardInputs) parts.push("Child answers felt forced or out of place.");
    return parts.join("\n");
  }).join("\n\n");

  log("Feedback", "Generalizing prior story critic notes", { sourceStoryCount: items.length });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: `You distill children's story editor notes into general writing rules for the NEXT story for a ${context.childAge}-year-old reader.

Past notes mention specific plots, character names, story titles, and child answers — strip ALL of that out.

Return ONLY JSON: { "lessons": ["rule 1", "rule 2"] }

Output rules:
- 2 to 4 short, actionable lessons
- Each lesson must apply to ANY new story with completely different child answers
- NEVER mention character names, story titles, or specific child answers from the past
- Focus on: plot structure, weaving answers naturally, pacing, conflict, avoiding filler, read-aloud quality
- Write in imperative voice ("Include...", "Avoid...", "Weave...")`,
        },
        {
          role: "user",
          content: `Past editor notes to generalize:\n\n${rawBlock}`,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Lesson generalization API error (${response.status})`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Lesson generalization returned no content");

  const parsed = JSON.parse(content) as { lessons?: string[] };
  const lessons = (parsed.lessons ?? []).map((l) => l.trim()).filter(Boolean).slice(0, 4);
  if (!lessons.length) throw new Error("Lesson generalization returned empty lessons");

  return lessons;
}

function buildAppliedPriorLessons(
  items: PriorFeedbackItem[],
  lessons: string[],
  promptText: string,
  method: AppliedPriorLessons["method"],
): AppliedPriorLessons {
  return {
    lessons,
    promptText,
    method,
    sourceStories: items.map((item) => ({
      storyId: item.storyId,
      title: item.title,
      rating: item.rating,
      awkwardInputs: item.awkwardInputs,
    })),
    createdAt: new Date().toISOString(),
  };
}

/** Turn past criticFeedback into generalized prompt instructions for the next story. */
async function buildPriorStoryLessons(
  priorStories: PriorStoryRow[],
  context: StoryContext,
  openaiKey: string | undefined,
): Promise<PriorStoryLessonsResult | undefined> {
  const items = collectPriorStoryFeedback(priorStories);
  if (!items.length) return undefined;

  if (openaiKey) {
    try {
      const lessons = await generalizePriorStoryLessons(items, context, openaiKey);
      const promptText = formatGeneralizedLessons(lessons);
      const applied = buildAppliedPriorLessons(items, lessons, promptText, "gpt");
      log("Feedback", "Generalized prior story lessons ready", {
        sourceStoryCount: items.length,
        lessonCount: lessons.length,
        sourceStoryIds: items.map((i) => i.storyId),
        preview: promptText.slice(0, 240),
      });
      return { promptText, applied };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("Feedback", "Generalization failed — using rule-based fallback", { message });
    }
  }

  const { lessons, promptText } = fallbackGeneralizedLessons(items);
  const applied = buildAppliedPriorLessons(items, lessons, promptText, "fallback");
  log("Feedback", "Using rule-based lesson fallback", {
    sourceStoryCount: items.length,
    sourceStoryIds: items.map((i) => i.storyId),
  });
  return { promptText, applied };
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

  const priorLessons = context.priorStoryLessons
    ? `\n\nApply these lessons from ${context.childName}'s past stories:\n${context.priorStoryLessons}`
    : "";

  return `You are a children's book author writing for ${context.childName}, who is ${context.childAge} years old.
${ageWritingGuide(context.childAge)}
Rules:
- Write exactly ${PAGE_COUNT} pages (one paragraph per page)
- Each page should be 1-2 short sentences
- The full story must make sense from beginning to end — clear setup, unfolding events, and a satisfying ending
- Make it genuinely enjoyable for a ${context.childAge}-year-old: warm, playful, surprising, and fun to read aloud
- Weave each child ANSWER below into the plot as story events — the answers are ingredients, not dialogue to recite
- NEVER quote or mention the original prompt questions in the story text
- NEVER write Q&A style lines like 'They wondered: "..."' or '"pizza!" they shouted'
- The story must read like a normal published children's book — answers appear naturally (a robot in a scene, the ocean as a destination, etc.)
- NEVER write filler like "Everyone agreed that X made the day memorable" or "X turned out to be the surprise"
- Each answer should inspire a concrete scene, action, character, place, or object — not be pasted as a bare noun
- Example for answers robot, ocean, balloon: GOOD: "A friendly robot rolled across the sandy shore." BAD: "The path led toward ocean."
- Use ONLY the child's actual answers in the story — never copy animals, objects, or places from these instructions or examples
- Pages must be unique — do NOT repeat sentences across pages
- Structure: beginning (pages 1-5), middle (pages 6-15), end (pages 16-20)
- Return ONLY JSON: { "title": "Story Title", "pages": ["page 1", "page 2", ...] }
- The pages array must contain exactly ${PAGE_COUNT} strings${escalation}${priorLessons}`;
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

function buildBlueprintSystemPrompt(context: StoryContext, attempt: number): string {
  const escalation = attempt <= 1
    ? ""
    : attempt === 2
      ? "\n\nIMPORTANT — the previous blueprint failed review. Give the hero a clear WANT, a real OBSTACLE, and a satisfying PAYOFF. Every child answer must drive the plot — not appear as random objects."
      : "\n\nCRITICAL — multiple blueprint attempts failed. Keep it simple: one hero, one setting, one problem to solve. Each answer is a clue, tool, ally, or reward — never a bare noun dropped into a scene.";

  const priorLessons = context.priorStoryLessons
    ? `\n\nApply these lessons from ${context.childName}'s past stories:\n${context.priorStoryLessons}`
    : "";

  return `You are a children's book story architect planning a ${PAGE_COUNT}-page picture book for ${context.childName}, age ${context.childAge}.
${ageWritingGuide(context.childAge)}

Plan the story STRUCTURE only — not final prose. Return ONLY JSON:
{
  "title": "Story title",
  "architecture": {
    "protagonistGoal": "What the hero wants at the start",
    "centralProblem": "The obstacle or mystery blocking the goal",
    "resolution": "How the story resolves emotionally and plot-wise",
    "act1Summary": "Pages 1-5: setup and inciting incident",
    "act2Summary": "Pages 6-15: rising action, discoveries, setbacks",
    "act3Summary": "Pages 16-20: climax and satisfying ending"
  },
  "visualBible": {
    "primarySetting": "One consistent world (e.g. seaside beach and cave — NOT beach AND underwater)",
    "settingRules": "Rules illustrators must follow to keep setting consistent",
    "paletteNotes": "3-5 dominant colors and art mood"
  },
  "characters": [
    {
      "name": "character name",
      "role": "protagonist | sidekick | etc",
      "introducedOnPage": 1,
      "appearance": "Fixed visual design — exact colors, shapes, features for every illustration"
    }
  ],
  "inputMap": [
    {
      "answer": "exact child answer from list below",
      "question": "matching question from list below",
      "narrativeJob": "How this answer drives plot (clue, setting, ally, tool, reward, etc.)",
      "pages": [3, 10]
    }
  ],
  "storyboard": [
    {
      "page": 1,
      "beat": "One sentence: what happens on this page",
      "storyJob": "setup | rising_action | obstacle | discovery | climax | resolution",
      "inputsUsed": [],
      "charactersOnStage": ["Hero name"],
      "setting": "Where this page takes place",
      "sceneBrief": "What the illustration should show — composition, action, key props",
      "mood": "emotional tone"
    }
  ]
}

Rules:
- storyboard must have EXACTLY ${PAGE_COUNT} entries, pages 1 through ${PAGE_COUNT}
- Every page beat must advance plot or emotion — NO filler beats like "they were glad" or "the adventure was amazing"
- architecture must have real conflict: goal + obstacle + payoff (not just pleasant exploration)
- inputMap must include EVERY child answer listed below with narrativeJob and pages where it pays off
- inputsUsed in storyboard must only contain answers from the child answer list
- For user_input beats, weave answers as plot devices (a key unlocks a door, a number marks eleven steps, etc.) — NOT random objects appearing
- visualBible.primarySetting must be ONE coherent world — pick beach OR underwater, not both
- characters.appearance must be specific enough for illustration consistency (exact colors, never vague)
- sidekicks introduced later must have introducedOnPage matching their first storyboard appearance
- Pages 1-5 = setup, 6-15 = rising action, 16-20 = climax and resolution${escalation}${priorLessons}`;
}

function formatBlueprintForReview(blueprint: StoryBlueprint): string {
  const lines = [
    `Title: ${blueprint.title}`,
    `Goal: ${blueprint.architecture.protagonistGoal}`,
    `Problem: ${blueprint.architecture.centralProblem}`,
    `Resolution: ${blueprint.architecture.resolution}`,
    `Setting: ${blueprint.visualBible.primarySetting}`,
    `Setting rules: ${blueprint.visualBible.settingRules}`,
    "",
    "Input map:",
    ...blueprint.inputMap.map((e) =>
      `- "${e.answer}" (${e.narrativeJob}) on pages ${e.pages.join(", ")}`
    ),
    "",
    "Storyboard:",
    ...blueprint.storyboard.map((b) =>
      `Page ${b.page} [${b.storyJob}]: ${b.beat}${b.inputsUsed.length ? ` (inputs: ${b.inputsUsed.join(", ")})` : ""} | Setting: ${b.setting} | Scene: ${b.sceneBrief}`
    ),
  ];
  return lines.join("\n");
}

function normalizeStoryBlueprint(raw: StoryBlueprint, inputs: StoryInput[]): StoryBlueprint {
  const allowedAnswers = new Set(inputs.map((i) => normalizeInputToken(i.answer)));
  const questionByAnswer = new Map(inputs.map((i) => [normalizeInputToken(i.answer), i.question]));

  const storyboard = (raw.storyboard ?? [])
    .slice(0, PAGE_COUNT)
    .map((beat, i) => ({
      page: i + 1,
      beat: safeTrim(beat.beat, `Story beat for page ${i + 1}`),
      storyJob: safeTrim(beat.storyJob, "rising_action"),
      inputsUsed: safeStringArray(beat.inputsUsed).filter((a) =>
        allowedAnswers.has(normalizeInputToken(a))
      ),
      charactersOnStage: safeStringArray(beat.charactersOnStage),
      setting: safeTrim(beat.setting, safeTrim(raw.visualBible?.primarySetting, "story setting")),
      sceneBrief: safeTrim(beat.sceneBrief, safeTrim(beat.beat, "")),
      mood: safeTrim(beat.mood, "warm"),
    }));

  while (storyboard.length < PAGE_COUNT) {
    const page = storyboard.length + 1;
    storyboard.push({
      page,
      beat: `The adventure continues toward the ending.`,
      storyJob: page >= 16 ? "resolution" : "rising_action",
      inputsUsed: [],
      charactersOnStage: raw.characters?.[0]?.name
        ? [safeTrim(raw.characters[0].name)]
        : [],
      setting: safeTrim(raw.visualBible?.primarySetting, "story setting"),
      sceneBrief: "Hero continues the adventure",
      mood: "hopeful",
    });
  }

  const inputMap = (raw.inputMap ?? []).filter((e) =>
    allowedAnswers.has(normalizeInputToken(safeTrim(e.answer))),
  );
  for (const input of inputs) {
    const token = normalizeInputToken(input.answer);
    if (!inputMap.some((e) => normalizeInputToken(e.answer) === token)) {
      inputMap.push({
        answer: input.answer,
        question: input.question,
        narrativeJob: "woven into the adventure",
        pages: storyboard
          .filter((b) => b.inputsUsed.some((a) => normalizeInputToken(a) === token))
          .map((b) => b.page),
      });
    }
  }

  return {
    title: safeTrim(raw.title, "Your Story"),
    architecture: {
      protagonistGoal: safeTrim(raw.architecture?.protagonistGoal, "Go on an adventure"),
      centralProblem: safeTrim(raw.architecture?.centralProblem, "Something stands in the way"),
      resolution: safeTrim(raw.architecture?.resolution, "The hero succeeds and feels proud"),
      act1Summary: safeTrim(raw.architecture?.act1Summary, "Setup"),
      act2Summary: safeTrim(raw.architecture?.act2Summary, "Rising action"),
      act3Summary: safeTrim(raw.architecture?.act3Summary, "Resolution"),
    },
    visualBible: {
      primarySetting: safeTrim(raw.visualBible?.primarySetting, "A friendly storybook world"),
      settingRules: safeTrim(
        raw.visualBible?.settingRules,
        "Keep the setting consistent on every page",
      ),
      paletteNotes: safeTrim(
        raw.visualBible?.paletteNotes,
        "Soft muted watercolor storybook palette",
      ),
    },
    characters: (raw.characters ?? []).map((c) => ({
      name: safeTrim(c.name, "Hero"),
      role: safeTrim(c.role, "protagonist"),
      introducedOnPage: Math.min(Math.max(1, Number(c.introducedOnPage) || 1), PAGE_COUNT),
      appearance: safeTrim(c.appearance, "A friendly storybook character"),
    })),
    inputMap: inputMap.map((e) => ({
      answer: safeTrim(e.answer),
      question: questionByAnswer.get(normalizeInputToken(safeTrim(e.answer))) ?? safeTrim(e.question),
      narrativeJob: safeTrim(e.narrativeJob, "woven into the adventure"),
      pages: (Array.isArray(e.pages) ? e.pages : [])
        .map((p) => Number(p))
        .filter((p) => Number.isFinite(p) && p >= 1 && p <= PAGE_COUNT),
    })),
    storyboard,
  };
}

async function generateStoryBlueprint(
  inputs: StoryInput[],
  openaiKey: string,
  context: StoryContext,
  attempt: number,
  revisionFeedback?: string,
): Promise<StoryBlueprint> {
  const storyBrief = formatStoryBrief(inputs);
  const revisionNote = revisionFeedback
    ? `\n\nFix these issues from the previous blueprint:\n${revisionFeedback}`
    : "";

  log("Blueprint", "Requesting story architecture and storyboard", {
    attempt,
    childAge: context.childAge,
    inputCount: inputs.length,
  });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        { role: "system", content: buildBlueprintSystemPrompt(context, attempt) },
        {
          role: "user",
          content: `Child answers (EVERY answer must appear in inputMap and drive the plot):\n${storyBrief}${revisionNote}`,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Blueprint API error (${response.status})`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Blueprint API returned no content");

  const blueprint = normalizeStoryBlueprint(JSON.parse(content) as StoryBlueprint, inputs);
  log("Blueprint", "Storyboard ready", {
    title: blueprint.title,
    beatCount: blueprint.storyboard.length,
    characterCount: blueprint.characters.length,
    inputMapCount: blueprint.inputMap.length,
  });
  return blueprint;
}

async function reviewStoryBlueprint(
  blueprint: StoryBlueprint,
  inputs: StoryInput[],
  context: StoryContext,
  openaiKey: string,
): Promise<BlueprintReview> {
  const answerList = inputs.map((i) => i.answer).join(", ");

  log("Blueprint", "Reviewing storyboard structure", { title: blueprint.title });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: `You are a demanding children's book editor reviewing a STORYBOARD (structure only) for ${context.childName}, age ${context.childAge}.

Return ONLY JSON:
{
  "rating": 75,
  "hasClearConflict": true,
  "inputsDrivePlot": true,
  "noFillerBeats": true,
  "coherentSetting": true,
  "feedback": "specific structural problems to fix",
  "missingInputs": ["answers not driving plot"]
}

Scoring (use full range — most AI storyboards are 55–74):
- 85+: Strong arc, every answer has a narrative job, no filler beats, one coherent setting
- 70–84: Usable with flaws
- Below 70: Weak — checklist inputs, no real obstacle, or filler pages

Check:
1. hasClearConflict — protagonist goal, central problem, and resolution are clear and connected
2. inputsDrivePlot — EVERY answer (${answerList}) drives plot via inputMap; not bare nouns dropped in
3. noFillerBeats — pages 6–15 advance plot; no empty beats like "they were glad" or "it was amazing"
4. coherentSetting — one primary world; no contradictory settings (e.g. beach and underwater without explanation)

Fail any check if not clearly satisfied.`,
        },
        {
          role: "user",
          content: formatBlueprintForReview(blueprint),
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Blueprint review API error (${response.status})`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Blueprint review returned no content");

  const review = JSON.parse(content) as BlueprintReview;
  review.rating = Math.min(100, Math.max(0, Math.round(review.rating ?? 0)));
  review.hasClearConflict = Boolean(review.hasClearConflict);
  review.inputsDrivePlot = Boolean(review.inputsDrivePlot);
  review.noFillerBeats = Boolean(review.noFillerBeats);
  review.coherentSetting = Boolean(review.coherentSetting);
  review.missingInputs = review.missingInputs ?? [];
  review.feedback = review.feedback ?? "";
  review.passes = review.hasClearConflict
    && review.inputsDrivePlot
    && review.noFillerBeats
    && review.coherentSetting
    && review.rating >= 72;

  log("Blueprint", "Storyboard review result", {
    passes: review.passes,
    rating: review.rating,
    hasClearConflict: review.hasClearConflict,
    inputsDrivePlot: review.inputsDrivePlot,
    noFillerBeats: review.noFillerBeats,
    coherentSetting: review.coherentSetting,
    missingInputs: review.missingInputs,
  });

  return review;
}

function buildBlueprintRevisionFeedback(review: BlueprintReview, attempt: number): string {
  const parts: string[] = [];
  if (review.feedback) parts.push(review.feedback);

  if (!review.hasClearConflict) {
    parts.push(
      attempt >= 2
        ? "CRITICAL: Give the hero a clear WANT, a real OBSTACLE, and a satisfying PAYOFF by page 20."
        : "Add clear goal, obstacle, and resolution to the architecture.",
    );
  }
  if (!review.inputsDrivePlot) {
    parts.push(
      `Make every child answer drive the plot: ${review.missingInputs.join(", ") || "all answers"}. Use answers as clues, settings, allies, tools, or rewards — not random objects.`,
    );
  }
  if (!review.noFillerBeats) {
    parts.push("Remove filler beats in pages 6–15. Every page must introduce action, discovery, or emotion.");
  }
  if (!review.coherentSetting) {
    parts.push("Pick ONE primary setting and apply visualBible.settingRules consistently on every page.");
  }
  if (review.rating < 72) {
    parts.push(`Blueprint rated ${review.rating}/100 — strengthen the middle act and ending payoff.`);
  }
  return parts.filter(Boolean).join(" ");
}

async function generateBlueprintWithReview(
  inputs: StoryInput[],
  openaiKey: string,
  context: StoryContext,
): Promise<{ blueprint: StoryBlueprint; review: BlueprintReview; attempts: number }> {
  let revisionFeedback = context.revisionFeedback;
  let lastReview: BlueprintReview | null = null;

  for (let attempt = 1; attempt <= MAX_BLUEPRINT_ATTEMPTS; attempt++) {
    const blueprint = await generateStoryBlueprint(inputs, openaiKey, context, attempt, revisionFeedback);
    const review = await reviewStoryBlueprint(blueprint, inputs, context, openaiKey);
    lastReview = review;

    if (review.passes) {
      log("Blueprint", "Storyboard approved — proceeding to prose", { attempt, rating: review.rating });
      return { blueprint, review, attempts: attempt };
    }

    revisionFeedback = buildBlueprintRevisionFeedback(review, attempt);
    log("Blueprint", `Storyboard review failed — revising (${attempt}/${MAX_BLUEPRINT_ATTEMPTS})`, {
      rating: review.rating,
      revisionFeedback: revisionFeedback.slice(0, 200),
    });
  }

  throw new Error(
    `Storyboard did not pass review after ${MAX_BLUEPRINT_ATTEMPTS} attempts: ${lastReview?.feedback || "Unknown"}`,
  );
}

async function expandBlueprintToProse(
  blueprint: StoryBlueprint,
  inputs: StoryInput[],
  context: StoryContext,
  openaiKey: string,
  revisionFeedback?: string,
): Promise<StoryDraft> {
  const beatsText = blueprint.storyboard
    .map((b) => `Page ${b.page}: ${b.beat} [${b.mood}]`)
    .join("\n");
  const answerList = inputs.map((i) => i.answer).join(", ");
  const revisionNote = revisionFeedback
    ? `\n\nFix these prose issues while keeping storyboard beats unchanged:\n${revisionFeedback}`
    : "";

  log("Text", "Expanding approved storyboard to page prose", { title: blueprint.title });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
          content: `You write final picture-book page text for ${context.childName}, age ${context.childAge}.
${ageWritingGuide(context.childAge)}

Rules:
- Follow the approved storyboard EXACTLY — same events on each page, same order
- Write exactly ${PAGE_COUNT} pages, 1-2 short sentences each
- Warm, playful, fun to read aloud
- NEVER quote the original prompt questions
- NEVER add new plot events not in the storyboard
- Child answers (${answerList}) must appear naturally where the storyboard specifies
- Return ONLY JSON: { "title": "${blueprint.title}", "pages": ["...", ...] }`,
        },
        {
          role: "user",
          content: `Title: ${blueprint.title}\n\nApproved storyboard:\n${beatsText}${revisionNote}`,
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Prose expansion API error (${response.status})`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Prose expansion returned no content");

  const story = JSON.parse(content) as StoryDraft;
  if (!story.pages?.length) throw new Error("Prose expansion returned invalid format");

  while (story.pages.length < PAGE_COUNT) {
    const beat = blueprint.storyboard[story.pages.length];
    story.pages.push(beat?.beat ?? "The adventure continued.");
  }
  story.pages = story.pages.slice(0, PAGE_COUNT);
  story.title = story.title || blueprint.title;

  log("Text", "Prose expansion complete", { pageCount: story.pages.length });
  return story;
}

function blueprintToStoryMetadata(
  blueprint: StoryBlueprint,
  review: BlueprintReview,
  inputs: StoryInput[],
  attempts: number,
): StoryMetadata {
  const plotPoints: StoryPlotPoint[] = [];

  for (const beat of blueprint.storyboard) {
    plotPoints.push({
      page: beat.page,
      description: beat.beat,
      type: "plot",
    });
    for (const answer of beat.inputsUsed) {
      plotPoints.push({
        page: beat.page,
        description: beat.beat,
        type: "user_input",
        userInput: answer,
      });
    }
  }

  const metadata: StoryMetadata = {
    characters: blueprint.characters,
    plotSummary: `${blueprint.architecture.protagonistGoal} — ${blueprint.architecture.centralProblem} — ${blueprint.architecture.resolution}`,
    criticFeedback: {
      rating: review.rating,
      faults: review.passes ? "" : review.feedback,
      improvements: review.passes
        ? "Storyboard passed structural review before prose and illustrations."
        : review.feedback,
      inputsFitNaturally: review.inputsDrivePlot ? "items_make_sense" : "items_feel_out_of_place",
    },
    plotPoints,
    paletteNotes: blueprint.visualBible.paletteNotes,
    userInputs: inputs.map((i) => ({ question: i.question, answer: i.answer })),
    architecture: blueprint.architecture,
    visualBible: blueprint.visualBible,
    storyboard: blueprint.storyboard,
    inputMap: blueprint.inputMap,
    blueprintReview: {
      passed: review.passes,
      rating: review.rating,
      attempts,
      feedback: review.feedback,
    },
  };

  return sanitizeStoryMetadata(metadata, inputs);
}

async function generateStoryFromBlueprint(
  inputs: StoryInput[],
  openaiKey: string,
  context: StoryContext,
): Promise<{
  title: string;
  pages: string[];
  meta: StoryMeta;
  blueprint: StoryBlueprint;
  metadata: StoryMetadata;
}> {
  const { blueprint, review, attempts } = await generateBlueprintWithReview(inputs, openaiKey, context);
  let metadata = blueprintToStoryMetadata(blueprint, review, inputs, attempts);
  let story = await expandBlueprintToProse(blueprint, inputs, context, openaiKey);

  let proseReview = await reviewStory(story, inputs, context, openaiKey);
  if (!proseReview.passes) {
    log("Review", "Prose review failed after storyboard — regenerating prose once", {
      feedback: proseReview.feedback,
    });
    story = await expandBlueprintToProse(
      blueprint,
      inputs,
      context,
      openaiKey,
      buildRevisionFeedback(proseReview, inputs, context, 1),
    );
    proseReview = await reviewStory(story, inputs, context, openaiKey);
  }

  metadata = alignUserInputPagesToStory(story, metadata);

  return {
    title: story.title,
    pages: story.pages,
    blueprint,
    metadata,
    meta: {
      originalPageCount: story.pages.length,
      wasPadded: false,
      retried: false,
      reviewPassed: proseReview.passes,
      reviewAttempts: 1,
      blueprintPassed: review.passes,
      blueprintAttempts: attempts,
      blueprintRating: review.rating,
    },
  };
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

async function assertStoryOwner(
  req: Request,
  supabaseUrl: string,
  storyId: string,
): Promise<{ childId: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anonKey) throw new Error("Missing SUPABASE_ANON_KEY");

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) throw new Error("Unauthorized");

  const { data: story, error } = await userClient
    .from("stories")
    .select("id, child_id")
    .eq("id", storyId)
    .single();

  if (error || !story?.child_id) throw new Error("Story not found");
  return { childId: story.child_id as string };
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

/** GPT JSON fields are not always strings — coerce safely before .trim(). */
function safeTrim(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => safeTrim(item))
    .filter(Boolean);
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
          content: `You are a demanding children's book editor and art director reviewing a manuscript for ${context.childName}, age ${context.childAge}. Your job is to find weaknesses — not to encourage the author. Be blunt, specific, and tough. Most AI-generated bedtime stories are mediocre (55–72). Only rate 83+ if you would genuinely recommend this to a parent. Reserve 90+ for exceptional, publishable quality.

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

Scoring guide (use the full range — do NOT cluster at 80–90):
- 90–100: Exceptional — tight plot, every page earns its place, inputs woven brilliantly, would delight a ${context.childAge}-year-old
- 75–89: Solid but flawed — enjoyable with clear weaknesses worth fixing
- 55–74: Mediocre — filler, weak middle, disconnected beats, or forced inputs
- Below 55: Poor — incoherent, repetitive, or answers pasted unnaturally

Penalize heavily for:
- Disconnected or random scenes with no clear through-line
- Repetitive sentences or recycled phrasing across pages
- Child answers used as bare nouns ("they walked toward Mars") instead of concrete scenes
- Filler lines like "Everyone agreed that X made the day memorable"
- Weak or rushed ending; no satisfying payoff
- Flat middle (pages 6–15) with no rising tension or surprises
- Answers introduced too late or only mentioned once without driving the plot

Rules:
- List ALL characters with the exact page they first appear (introducedOnPage)
- plotPoints must include major plot beats AND one user_input entry per child answer listed below
- For user_input plotPoints, userInput MUST be copied exactly from the child answers list — never invent answers
- Each plotPoint page must be the FIRST page where that beat, activity, or concept appears in the story text
- Plot beats that introduce a new activity (e.g. doing dishes, visiting a place) must have the page where that activity first happens
- criticFeedback.rating is 0-100 — err toward lower scores when in doubt
- criticFeedback.faults must cite 2–4 specific problems (reference page numbers when possible)
- criticFeedback.improvements must be concrete rewrites or structural fixes, not vague praise
- inputsFitNaturally must be exactly "items_make_sense" or "items_feel_out_of_place"
- Mark items_feel_out_of_place if ANY answer feels quoted, pasted, or barely integrated into the plot`,
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

  const boardBeat = metadata.storyboard?.find((b) => b.page === pageNumber);
  if (boardBeat) {
    lines.push(`Storyboard scene brief (illustrate this): ${boardBeat.sceneBrief}`);
    lines.push(`Setting for this page: ${boardBeat.setting}`);
    lines.push(`Mood: ${boardBeat.mood}`);
    if (boardBeat.charactersOnStage.length) {
      lines.push(`Characters on stage: ${boardBeat.charactersOnStage.join(", ")}`);
    }
  }

  if (metadata.visualBible?.settingRules) {
    lines.push(`Setting consistency: ${metadata.visualBible.settingRules}`);
  }
  if (metadata.visualBible?.primarySetting) {
    lines.push(`Primary world: ${metadata.visualBible.primarySetting}`);
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

async function callImageGenerate(prompt: string, openaiKey: string, quality = "medium"): Promise<string> {
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
      quality,
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
  quality = "medium",
): Promise<string> {
  const form = new FormData();
  form.append("model", IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("image", new Blob([anchorBytes], { type: "image/png" }), "character-anchor.png");
  form.append("input_fidelity", inputFidelity);
  form.append("quality", quality);
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
  fastMode = false,
): Promise<{ publicUrl: string; anchorBytes: Uint8Array }> {
  const imageQuality = fastMode ? "low" : "medium";
  const isAnchor = pageNumber === 1 || anchorBytes === null;
  // Page 2 uses a fresh generate so it doesn't clone page 1's composition via edit.
  const useFreshGenerate = pageNumber === 2;
  const prompt = isAnchor
    ? buildAnchorImagePrompt(metadata, pageText, pageNumber)
    : useFreshGenerate
      ? buildFreshScenePrompt(metadata, pageText, pageNumber)
      : buildContinuationImagePrompt(metadata, pageText, pageNumber);

  const generateFreshFallback = async (): Promise<string> => {
    log("Images", `Page ${pageNumber} using fresh-generate fallback`, { storyId });
    return await callImageGenerate(
      buildFreshScenePrompt(metadata, pageText, pageNumber),
      openaiKey,
      imageQuality,
    );
  };

  try {
    log("Images", `Generating image for page ${pageNumber}`, {
      attempt: retries + 1,
      model: IMAGE_MODEL,
      mode: isAnchor ? "anchor" : useFreshGenerate ? "fresh-scene" : "edit-character-ref",
      quality: imageQuality,
      fastMode,
    });

    const b64 = isAnchor || useFreshGenerate
      ? await callImageGenerate(prompt, openaiKey, imageQuality)
      : await callImageEdit(anchorBytes!, prompt, openaiKey, "low", imageQuality);

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
        supabase, storyId, pageNumber, pageText, openaiKey, metadata, anchorBytes, retries + 1, fastMode,
      );
    }
    if (!isAnchor && !useFreshGenerate) {
      try {
        const b64 = await generateFreshFallback();
        const bytes = base64ToBytes(b64);
        const publicUrl = await uploadStoryImage(supabase, storyId, pageNumber, b64);
        log("Images", `Page ${pageNumber} ready via fresh-generate fallback`);
        return { publicUrl, anchorBytes: anchorBytes! };
      } catch (fallbackErr) {
        const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        logError("Images", `Page ${pageNumber} fresh-generate fallback failed`, { message: fallbackMessage });
      }
    }
    logError("Images", `Page ${pageNumber} failed after ${MAX_RETRIES} retries`, { message });
    throw new Error(`Page ${pageNumber}: ${message}`);
  }
}

async function setStoryError(
  supabase: ReturnType<typeof createClient>,
  storyId: string,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  logError("Run", "Story marked as error", { storyId, message, ...context });

  let fullMessage = message;
  if (context?.stage) {
    fullMessage = `[${context.stage}] ${message}`;
  }
  if (context?.continueFromPage != null) {
    fullMessage += ` (next page: ${context.continueFromPage})`;
  } else if (context?.page != null) {
    fullMessage += ` (page ${context.page})`;
  }
  if (context?.httpStatus != null) {
    fullMessage += ` [HTTP ${context.httpStatus}]`;
  }

  const trimmed = fullMessage.slice(0, 500);
  const { error } = await supabase
    .from("stories")
    .update({ status: "error", error_message: trimmed })
    .eq("id", storyId);

  if (error) {
    logError("Run", "Failed to save error_message — saving status only", { storyId, dbError: error.message, message: trimmed });
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

async function chainNextIllustrationBatch(
  supabaseUrl: string,
  serviceKey: string,
  storyId: string,
  childId: string,
  continueFromPage: number,
  illustrationTarget: number,
): Promise<void> {
  log("Images", "Chaining next illustration batch", { storyId, continueFromPage, illustrationTarget });
  const response = await fetch(`${supabaseUrl}/functions/v1/generate-story`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceKey}`,
      "apikey": serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "continue_illustrations",
      storyId,
      childId,
      continueFromPage,
      illustrationTarget,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      body = { raw: bodyText.slice(0, 300) };
    }
    const apiMessage =
      (typeof body.error === "string" && body.error) ||
      (typeof body.message === "string" && body.message) ||
      (typeof body.msg === "string" && body.msg) ||
      bodyText.slice(0, 200) ||
      "unknown error";

    logError("Images", "Chain request failed", {
      storyId,
      continueFromPage,
      illustrationTarget,
      httpStatus: response.status,
      apiMessage,
      body,
    });

    throw new Error(`Chain to page ${continueFromPage} failed: ${apiMessage}`);
  }
}

async function runIllustrationBatch(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  storyId: string,
  childId: string,
  pageTexts: string[],
  metadata: StoryMetadata,
  openaiKey: string,
  startPage: number,
  illustrationTarget: number,
  chainBatches = true,
): Promise<{ startPage: number; endPage: number }> {
  const pagesThisRun = chainBatches ? CHAIN_PAGE_SIZE : IMAGE_BATCH_SIZE;
  const batchEnd = Math.min(startPage + pagesThisRun - 1, pageTexts.length, illustrationTarget);
  const batchNum = Math.ceil(startPage / CHAIN_PAGE_SIZE);
  const totalPages = Math.min(illustrationTarget, pageTexts.length);

  log("Images", `Illustrating page${batchEnd > startPage ? "s" : ""} ${startPage}${batchEnd > startPage ? `-${batchEnd}` : ""} (${batchNum}/${totalPages} chained)`, {
    storyId, illustrationTarget, chainBatches, pagesThisRun,
  });

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
      0,
      chainBatches,
    );
    await updatePageImage(supabase, storyId, pageNumber, result.publicUrl);
    await updatePagesCompleted(supabase, storyId, pageNumber);
    anchorBytes = result.anchorBytes;
    log("Run", "Page illustrated", { storyId, pageNumber, batch: batchNum });

    if (pageNumber < batchEnd) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  log("Images", `Page run complete`, { storyId, pages: `${startPage}-${batchEnd}` });

  const nextPage = batchEnd + 1;
  if (chainBatches && nextPage <= illustrationTarget && nextPage <= pageTexts.length) {
    await chainNextIllustrationBatch(supabaseUrl, serviceKey, storyId, childId, nextPage, illustrationTarget);
    return { startPage, endPage: batchEnd };
  }

  const { error: readyError } = await supabase.from("stories").update({ status: "ready" }).eq("id", storyId);
  if (readyError) throw new Error(readyError.message);
  log("Run", "Illustration complete — story ready", { storyId, pages: `${startPage}-${batchEnd}`, illustrationTarget });
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

  await runIllustrationBatch(
    supabase,
    supabaseUrl,
    serviceKey,
    storyId,
    childId,
    pageTexts,
    metadata,
    openaiKey,
    1,
    dallePageLimit,
    true,
  );
}

async function continueIllustrationRun(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  storyId: string,
  childId: string,
  continueFromPage: number,
  illustrationTarget: number,
  openaiKey: string,
): Promise<void> {
  const { pageTexts, metadata } = await loadStoryForIllustration(supabase, storyId);
  log("Images", "Continuing illustration batches", { storyId, continueFromPage, illustrationTarget });

  await runIllustrationBatch(
    supabase,
    supabaseUrl,
    serviceKey,
    storyId,
    childId,
    pageTexts,
    metadata,
    openaiKey,
    continueFromPage,
    illustrationTarget,
    true,
  );
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
  supabaseUrl: string,
  serviceKey: string,
  storyId: string,
  openaiKey: string,
): Promise<{ startPage: number; endPage: number } | null> {
  const startPage = await findNextPlaceholderStart(supabase, storyId);
  if (!startPage) {
    log("Images", "No placeholder pages remaining", { storyId });
    return null;
  }

  const { pageTexts, metadata } = await loadStoryForIllustration(supabase, storyId);

  const { data: storyRow, error: storyError } = await supabase
    .from("stories")
    .select("child_id")
    .eq("id", storyId)
    .single();

  if (storyError || !storyRow?.child_id) {
    throw new Error(storyError?.message ?? "Story child_id not found — cannot chain illustrations");
  }

  log("Images", "Manual next batch (single page + chain)", { storyId, startPage });

  return await runIllustrationBatch(
    supabase,
    supabaseUrl,
    serviceKey,
    storyId,
    storyRow.child_id,
    pageTexts,
    metadata,
    openaiKey,
    startPage,
    PAGE_COUNT,
    true,
  );
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
  if (metadata.appliedPriorLessons) {
    console.log(`${LOG} [Metadata] Applied prior lessons (${metadata.appliedPriorLessons.method}):`);
    for (const source of metadata.appliedPriorLessons.sourceStories) {
      console.log(`${LOG} [Metadata]   from "${source.title}" (${source.rating}/100) [${source.storyId}]`);
    }
    metadata.appliedPriorLessons.lessons.forEach((lesson, i) => {
      console.log(`${LOG} [Metadata]   ${i + 1}. ${lesson}`);
    });
  }
  for (const p of metadata.plotPoints) {
    const tag = p.type === "user_input" ? `input "${p.userInput}"` : "plot";
    console.log(`${LOG} [Metadata] Page ${p.page} (${tag}): ${p.description}`);
  }
  if (metadata.blueprintReview) {
    console.log(`${LOG} [Metadata] Blueprint review: ${metadata.blueprintReview.rating}/100 after ${metadata.blueprintReview.attempts} attempt(s)`);
  }
  if (metadata.architecture) {
    console.log(`${LOG} [Metadata] Goal: ${metadata.architecture.protagonistGoal}`);
    console.log(`${LOG} [Metadata] Problem: ${metadata.architecture.centralProblem}`);
    console.log(`${LOG} [Metadata] Resolution: ${metadata.architecture.resolution}`);
  }
  if (metadata.storyboard?.length) {
    console.log(`${LOG} [Metadata] Storyboard pages: ${metadata.storyboard.length}`);
    for (const beat of metadata.storyboard.slice(0, 3)) {
      console.log(`${LOG} [Metadata]   p${beat.page}: ${beat.beat.slice(0, 80)}`);
    }
    console.log(`${LOG} [Metadata]   ... (${metadata.storyboard.length} total)`);
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
  const priorStories = await fetchPriorStoryFeedback(supabase, childId, storyId);
  const priorLessonsResult = await buildPriorStoryLessons(priorStories, childContext, openaiKey);
  let appliedPriorLessons: AppliedPriorLessons | undefined;
  if (priorLessonsResult) {
    log("Feedback", "Injecting lessons from prior stories", {
      childId,
      priorStoryCount: priorStories.length,
      sourceStoryIds: priorLessonsResult.applied.sourceStories.map((s) => s.storyId),
      preview: priorLessonsResult.promptText.slice(0, 200),
    });
    childContext.priorStoryLessons = priorLessonsResult.promptText;
    appliedPriorLessons = priorLessonsResult.applied;
  }

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
      const needsKeyHint = /OPENAI_API_KEY|not set on edge function/i.test(reason);
      throw new Error(
        needsKeyHint
          ? `${reason} — Set OPENAI_API_KEY in Supabase Edge Function secrets and redeploy generate-story.`
          : reason,
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
      const result = await generateStoryFromBlueprint(inputs, openaiKey, childContext);
      story = { title: result.title, pages: result.pages };
      storyMeta = result.meta;
      architectureMetadata = result.metadata;
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
  if (appliedPriorLessons) {
    architectureMetadata.appliedPriorLessons = appliedPriorLessons;
  }

  await saveStoryMetadata(supabase, storyId, architectureMetadata);
  logStoryMetadataDebug(storyId, architectureMetadata);

  // TEMP: remove before production
  logFullStoryText(storyId, story, storyMeta);

  const { error: titleError } = await supabase.from("stories").update({ title: story.title }).eq("id", storyId);
  if (titleError) logError("Run", "Failed to save title", { storyId, message: titleError.message });

  if (devMode) {
    log("Run", "Dev mode: using placeholder images", { pageCount: story.pages.length });
  } else {
    log("Run", "Generating illustrations in batches until target", {
      pageCount: story.pages.length,
      illustrationTarget: dallePageLimit,
      batchSize: IMAGE_BATCH_SIZE,
      batches: Math.ceil(dallePageLimit / IMAGE_BATCH_SIZE),
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

  // Real illustrations mark ready after the final batch; dev/placeholder mode finishes here
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
      illustrationTarget: requestedTarget,
      mode,
      continueFromPage,
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

    if (mode === "version") {
      return new Response(
        JSON.stringify({
          functionVersion: FUNCTION_VERSION,
          hasOpenAiKey: !!openaiKey,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "resume_illustrations") {
      if (!storyId || !openaiKey) {
        return new Response(JSON.stringify({ error: "Missing storyId or OPENAI_API_KEY" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let ownerChildId: string;
      try {
        ({ childId: ownerChildId } = await assertStoryOwner(req, supabaseUrl, storyId));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message === "Unauthorized" ? 401 : message === "Story not found" ? 404 : 403;
        return new Response(JSON.stringify({ error: message }), {
          status, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const illustrationTarget = resolveDallePageLimit(
        requestedTarget ?? requestedLimit,
        PAGE_COUNT,
      );
      const startPage = await findNextPlaceholderStart(supabase, storyId);

      if (!startPage) {
        await supabase.from("stories").update({ status: "ready", error_message: null }).eq("id", storyId);
        return new Response(
          JSON.stringify({ message: "All pages illustrated — story marked ready", storyId, functionVersion: FUNCTION_VERSION }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      log("Request", "Resuming illustrations from placeholder", { storyId, startPage, illustrationTarget });

      await supabase.from("stories").update({ status: "generating", error_message: null }).eq("id", storyId);

      const resumeRun = async () => {
        try {
          await continueIllustrationRun(
            supabase, supabaseUrl, supabaseServiceKey, storyId, ownerChildId,
            startPage, illustrationTarget, openaiKey,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logError("Run", "Resume illustration failed", { storyId, startPage, message });
          await setStoryError(supabase, storyId, message, { stage: "resume", continueFromPage: startPage });
        }
      };

      EdgeRuntime.waitUntil(resumeRun());
      return new Response(
        JSON.stringify({
          message: "Illustration resume started",
          storyId,
          startPage,
          illustrationTarget,
          functionVersion: FUNCTION_VERSION,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "continue_illustrations") {
      const illustrationTarget = resolveDallePageLimit(
        requestedTarget ?? requestedLimit,
        PAGE_COUNT,
      );

      if (!storyId || !childId || !continueFromPage || !openaiKey) {
        return new Response(JSON.stringify({ error: "Missing continue_illustrations params" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const authHeader = req.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");
      if (token !== supabaseServiceKey) {
        logError("Request", "continue_illustrations rejected — service role required", { storyId });
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      log("Request", "Continuing illustration batch (chained)", {
        storyId, continueFromPage, illustrationTarget,
      });

      const continueRun = async () => {
        try {
          await continueIllustrationRun(
            supabase, supabaseUrl, supabaseServiceKey, storyId, childId,
            continueFromPage, illustrationTarget, openaiKey,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logError("Run", "Illustration batch failed", { storyId, continueFromPage, message });
          await setStoryError(supabase, storyId, message, { stage: "chain", continueFromPage });
        }
      };

      EdgeRuntime.waitUntil(continueRun());
      return new Response(
        JSON.stringify({
          message: "Illustration batch started",
          storyId,
          continueFromPage,
          illustrationTarget,
          functionVersion: FUNCTION_VERSION,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
          await illustrateNextBatchRun(supabase, supabaseUrl, supabaseServiceKey, storyId, openaiKey);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logError("Run", "Manual illustration batch failed", { storyId, message });
          await setStoryError(supabase, storyId, message, { stage: "manual_batch" });
        }
      };

      EdgeRuntime.waitUntil(batchRun());
      return new Response(
        JSON.stringify({ message: "Next illustration batch started", storyId, functionVersion: FUNCTION_VERSION }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const illustrationTarget = devMode
      ? 0
      : resolveDallePageLimit(requestedTarget ?? requestedLimit, PAGE_COUNT);
    const dallePageLimit = illustrationTarget;

    log("Request", "Received", {
      storyId, childId, devMode, allowTemplate, illustrationTarget, inputCount: inputs?.length,
    });

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
        await setStoryError(supabase, storyId, message, { stage: "generation" });
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
        await setStoryError(supabase, storyId, generationError, { stage: "generation" });
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
