import type { ProviderId } from '../domain/types';

/** The cheap, priced model each provider's starter flow runs on. */
export const STARTER_MODELS: Record<ProviderId, string> = {
  openai: 'gpt-6-luna',
  anthropic: 'claude-haiku-5-5',
  google: 'gemini-2.5-flash',
  openrouter: 'google/gemini-3.8-flash',
};

const FIND_PROMPT = `The run input is a research question. Turn it into an arXiv search of two to five keywords, each written all:<word> and joined with +AND+ (for "how well do small language models reason about code?" use all:small+AND+all:language+AND+all:models+AND+all:code). If the question asks for recent work, change sortBy=relevance to sortBy=submittedDate; otherwise change nothing else.

Run exactly this command with run_bash, replacing only QUERY. It saves each of up to eight papers to its own file, paper-1.txt to paper-8.txt, holding the arXiv id, the title, the complete abstract and the publication date, and prints only each file name with its title:

curl -sS --max-time 25 'https://export.arxiv.org/api/query?search_query=QUERY&sortBy=relevance&max_results=8' | tr '\\n' ' ' | grep -oE '<(id|title|published|summary)>[^<]*' | tail -n +3 | awk '/^<id>/ { n++; f = "paper-" n ".txt"; sub(/^<id>[^<]*abs\\//, "arXiv "); print > f; next } /^<title>/ { sub(/^<title>/, ""); print > f; print f ": " $0; next } /^<published>/ { print "published " substr($0, 12, 10) > f; next } { sub(/^<summary> */, ""); print > f }'

If it prints no papers, run it once more with fewer, broader keywords. Do not run it a third time: report what happened instead.

Next, read the file of every paper whose title could bear on the question, calling read_file for all of them in a single turn. Read each abstract to the end: the results are usually in its last sentences.

Then call complete_task with one short paragraph per paper that bears on the question: its title, arXiv id and date, then what the abstract reports — the method, the data, and every result and number it states, exactly as written. If an abstract states no result, say so. Leave out papers that do not bear on the question and say how many you left out. Never invent a paper, a number or a finding that is not in the abstracts.`;

const BRIEF_PROMPT = `You write for the person who asked the research question in the run input. They are curious and technical but have not read these papers, and they want to know in two or three minutes what the literature says and which paper to open first. A paper that directly answers their question, or contradicts what they seem to assume, is what matters most to them.

The notes you receive summarise the abstracts of the papers an arXiv search found, not the full papers, so report findings as what the authors report, and say so when an abstract gives no result. Write the way a well-read colleague would answer over coffee: plain prose, warm but not chatty, no headings and no bullet lists. Open with a direct answer to the question, as far as these papers support one. Then walk through the papers that matter, most useful first, giving each its title, year and the specific claim or number that makes it worth reading. Close with the questions the papers themselves raise or leave open, without adding your own, and the one paper to read first.

Be exact: use only what the notes say, and if they say the search failed or found nothing relevant, tell the reader that plainly and suggest a better way to phrase the question.`;

/** A two-node research flow that runs on one provider; `init` writes it to `flow.json`. */
export function starterFlow(provider: ProviderId) {
  const model = STARTER_MODELS[provider];
  return {
    name: 'Research starter',
    nodes: [
      {
        id: 'find',
        label: 'Find papers',
        provider,
        model,
        prompt: FIND_PROMPT,
        permissions: { read: true, bash: true },
        outputSchema: { minLines: 1 },
      },
      {
        id: 'brief',
        label: 'Answer the question',
        provider,
        model,
        audience: 'person',
        inputs: ['find', '$input'],
        prompt: BRIEF_PROMPT,
        permissions: {},
      },
    ],
    edges: [{ id: 'e1', source: 'find', target: 'brief', condition: 'notes written for the papers found' }],
  };
}
