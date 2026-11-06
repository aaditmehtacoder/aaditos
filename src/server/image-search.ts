/**
 * Real pictures of real things.
 *
 * "Show me a Komodo dragon" wants a photo, not a painting, and it should work
 * on an account with no image credit. This looks the subject up on Wikipedia
 * and returns the lead image of each matching article: free, keyless,
 * encyclopedic (so age-appropriate in practice), and every result carries the
 * article it came from, so the answer can say where a picture is from.
 *
 * The model receives the results and puts the ones that fit into its answer
 * as markdown images; the page renders those inline.
 */

const ENDPOINT = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "study-assistant/1.0 (image lookup for a personal planner)";
const TIMEOUT_MS = 8000;

export interface FoundImage {
  title: string;
  description?: string | undefined;
  image: string;
  width: number;
  height: number;
  page: string;
}

export const FIND_IMAGES_TOOL = {
  type: "function",
  name: "find_images",
  description:
    "Find real photos or diagrams of a real-world subject (an animal, place, person in history, artwork, organ, machine, landmark, chemical structure…) from Wikipedia. Use it whenever the user asks to see what something looks like, or a picture would genuinely help an explanation. Returns image URLs to embed in your answer with markdown.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description: "The subject, as it would be titled on Wikipedia, e.g. 'Komodo dragon'.",
      },
      limit: { type: "integer", minimum: 1, maximum: 6, description: "How many to return." },
    },
    required: ["query", "limit"],
  },
} as const;

/** Thumbnail links arrive with tracking parameters the model would only mangle. */
function cleanUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

export async function findImages(
  query: string,
  limit = 4,
  fetcher: typeof fetch = fetch,
): Promise<{ query: string; images: FoundImage[]; note?: string }> {
  const q = query.trim().slice(0, 200);
  if (!q) return { query: q, images: [], note: "Empty query." };
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: q,
    gsrlimit: String(Math.min(10, Math.max(1, limit) + 4)),
    gsrnamespace: "0",
    prop: "pageimages|description|info",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: "800",
    pilicense: "any",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(`${ENDPOINT}?${params}`, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { query: q, images: [], note: `Wikipedia answered ${response.status}.` };
    }
    const body = (await response.json()) as {
      query?: {
        pages?: Array<{
          title?: string;
          index?: number;
          description?: string;
          fullurl?: string;
          thumbnail?: { source?: string; width?: number; height?: number };
        }>;
      };
    };
    const images = (body.query?.pages ?? [])
      .filter((p) => p.thumbnail?.source && p.title && p.fullurl)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .slice(0, Math.max(1, Math.min(6, limit)))
      .map((p) => ({
        title: p.title ?? "",
        description: p.description,
        image: cleanUrl(p.thumbnail?.source ?? ""),
        width: p.thumbnail?.width ?? 0,
        height: p.thumbnail?.height ?? 0,
        page: p.fullurl ?? "",
      }));
    return images.length > 0
      ? { query: q, images }
      : { query: q, images, note: "No pictures found for that. Try the subject's proper name." };
  } catch (error) {
    return {
      query: q,
      images: [],
      note: error instanceof Error && error.name === "AbortError" ? "Timed out." : "Lookup failed.",
    };
  } finally {
    clearTimeout(timer);
  }
}
